import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HandshakeController, MAX_PUSH_RETRIES } from '../handshake-controller.js';
import type { MqttBridge } from '../mqtt-bridge.js';
import type { CmdController, ModuleSetpoint, SetpointPushResult } from '../cmd-controller.js';
import type { TagDef, MetaLevel } from '@caro/hmi-context';
import { HandshakeStatus } from '@caro/tag-registry-shared';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const lvl = (type: string, name: string, inTagName: boolean): MetaLevel => ({ type, name, fields: { In_Tag_Name: inTagName } });

function tag(tag_id: number, module_id: string, leaf: string, is_setpoint: boolean, module_type = 'MQTT'): TagDef {
  const meta = [lvl('system', 'Sys', false), lvl('module', module_id, true), lvl('tag', leaf, true)];
  return {
    tag_id, tag_path: `Sys.${module_id}.${leaf}`, tag_name: null, data_type: 'f32', is_setpoint, trendable: false,
    module_id, module_type, eng_min: null, eng_max: null, unit: null, format: null, meta,
  };
}

const tagMap = new Map<number, TagDef>([
  [1001, tag(1001, 'RF1', 'Freq_Set', true)],
  [1002, tag(1002, 'RF1', 'Freq_Mon', false)],
  [2001, tag(2001, 'HMI', 'Tag_Count', false, 'HMI')],
]);

const SETPOINTS: ModuleSetpoint[] = [{ tag_id: 1001, value: 915.5, ack_status: 'accepted', set_by: null }];

function request(moduleId = 'RF1') {
  return {
    message_type: 'HANDSHAKE_REQUEST',
    ts_utc_ms: 1,
    payload: { module_id: moduleId, instance_id: 'aa', ip: '10.0.0.1', fw_hash: 'sha256:x', tag_registry_template: 'T', tag_registry_rev: 3 },
  };
}
const confirm = (payload: object = { missing_ids: [], unknown_tags: [] }) => ({ message_type: 'CONFIRM', ts_utc_ms: 2, payload });

function setup(push: SetpointPushResult = { outcome: 'acked', results: [{ tag_id: 1001, accepted: true }] }) {
  let handler: ((moduleId: string, message: unknown) => void) | undefined;
  const order: string[] = [];
  const mqttBridge = {
    onHandshake:      vi.fn((h: typeof handler) => { handler = h; }),
    publishHandshake: vi.fn((_m: string, msg: { message_type: string }) => { order.push(msg.message_type); }),
    sendRehandshake:  vi.fn(() => { order.push('REHANDSHAKE'); }),
  } as unknown as MqttBridge;
  const cmdController = {
    getModuleSetpoints: vi.fn(() => Promise.resolve(SETPOINTS)),
    pushSetpoints:      vi.fn(() => { order.push('SET_VALUES'); return Promise.resolve(push); }),
    requestSnapshot:    vi.fn(() => { order.push('REQUEST_SNAPSHOT'); }),
  } as unknown as CmdController;

  const controller = new HandshakeController({ mqttBridge, cmdController, tagMap });
  const send = (moduleId: string, message: unknown) => handler!(moduleId, message);
  const flush = () => new Promise(r => setTimeout(r, 0));
  return { controller, mqttBridge, cmdController, send, flush, order };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ── HANDSHAKE_REQUEST ─────────────────────────────────────────────────────────

describe('HandshakeController — HANDSHAKE_REQUEST', () => {
  it('answers with a TAG_LIST of the module (module-relative names, is_setpoint)', () => {
    const { mqttBridge, send } = setup();

    send('RF1', request());

    expect(mqttBridge.publishHandshake).toHaveBeenCalledOnce();
    const [moduleId, msg] = vi.mocked(mqttBridge.publishHandshake).mock.calls[0] as [string, { message_type: string; ts_utc_ms: number; payload: { tags: unknown[] } }];
    expect(moduleId).toBe('RF1');
    expect(msg.message_type).toBe('TAG_LIST');
    expect(typeof msg.ts_utc_ms).toBe('number');
    expect(msg.payload.tags).toEqual([
      { tag_id: 1001, tag_name: 'Freq_Set', is_setpoint: true },
      { tag_id: 1002, tag_name: 'Freq_Mon', is_setpoint: false },
    ]);
  });

  it('answers every repeated request', () => {
    const { mqttBridge, send } = setup();

    send('RF1', request());
    send('RF1', request());

    expect(mqttBridge.publishHandshake).toHaveBeenCalledTimes(2);
  });

  it('ignores a request whose payload module_id differs from the topic', () => {
    const { mqttBridge, send } = setup();
    send('RF1', request('RF2'));
    expect(mqttBridge.publishHandshake).not.toHaveBeenCalled();
  });

  it('ignores a module that is not an MQTT module in the registry', () => {
    const { mqttBridge, send } = setup();
    send('HMI', request('HMI'));
    send('Ghost', request('Ghost'));
    expect(mqttBridge.publishHandshake).not.toHaveBeenCalled();
  });

  it('ignores malformed messages and unknown message types', () => {
    const { mqttBridge, cmdController, send } = setup();
    send('RF1', 'garbage');
    send('RF1', { payload: {} });
    send('RF1', { message_type: 'HELLO', ts_utc_ms: 1 });
    send('RF1', { message_type: 'HANDSHAKE_REQUEST', ts_utc_ms: 1 });
    expect(mqttBridge.publishHandshake).not.toHaveBeenCalled();
    expect(cmdController.getModuleSetpoints).not.toHaveBeenCalled();
  });
});

// ── CONFIRM ───────────────────────────────────────────────────────────────────

describe('HandshakeController — CONFIRM', () => {
  it('ignores a CONFIRM with no TAG_LIST sent', async () => {
    const { cmdController, send, flush } = setup();
    send('RF1', confirm());
    await flush();
    expect(cmdController.getModuleSetpoints).not.toHaveBeenCalled();
    expect(cmdController.requestSnapshot).not.toHaveBeenCalled();
  });

  it('pushes the module Sets from the store, then sends REQUEST_SNAPSHOT', async () => {
    const { cmdController, send, flush, order } = setup();

    send('RF1', request());
    send('RF1', confirm({ missing_ids: ['Phase.Step_Mask'], unknown_tags: ['Legacy.X'], truncated: true }));
    await flush();

    expect(cmdController.getModuleSetpoints).toHaveBeenCalledWith('RF1');
    expect(cmdController.pushSetpoints).toHaveBeenCalledWith('RF1', SETPOINTS);
    expect(order).toEqual(['TAG_LIST', 'SET_VALUES', 'REQUEST_SNAPSHOT']);
  });

  it('answers one CONFIRM per TAG_LIST; a second CONFIRM without a new request is ignored', async () => {
    const { cmdController, send, flush } = setup();

    send('RF1', request());
    send('RF1', confirm());
    send('RF1', confirm());
    await flush();

    expect(cmdController.pushSetpoints).toHaveBeenCalledOnce();
  });

  it('still sends REQUEST_SNAPSHOT when the setpoint store cannot be read', async () => {
    const { cmdController, send, flush } = setup();
    vi.mocked(cmdController.getModuleSetpoints).mockRejectedValueOnce(new Error('db down'));

    send('RF1', request());
    send('RF1', confirm());
    await flush();

    expect(cmdController.pushSetpoints).not.toHaveBeenCalled();
    expect(cmdController.requestSnapshot).toHaveBeenCalledWith('RF1');
  });

  it('a push timeout sends REHANDSHAKE, at most MAX_PUSH_RETRIES times in a row', async () => {
    const { mqttBridge, send, flush } = setup({ outcome: 'timeout' });

    for (let i = 0; i < MAX_PUSH_RETRIES + 2; i++) {
      send('RF1', request());
      send('RF1', confirm());
      await flush();
    }

    expect(mqttBridge.sendRehandshake).toHaveBeenCalledTimes(MAX_PUSH_RETRIES);
  });

  it('an acknowledged push resets the retry count', async () => {
    const { mqttBridge, cmdController, send, flush } = setup({ outcome: 'timeout' });

    for (let i = 0; i < MAX_PUSH_RETRIES; i++) {
      send('RF1', request());
      send('RF1', confirm());
      await flush();
    }
    vi.mocked(cmdController.pushSetpoints).mockResolvedValueOnce({ outcome: 'acked', results: [] });
    send('RF1', request());
    send('RF1', confirm());
    await flush();
    send('RF1', request());
    send('RF1', confirm());
    await flush();

    expect(mqttBridge.sendRehandshake).toHaveBeenCalledTimes(MAX_PUSH_RETRIES + 1);
  });
});

// ── Status and details ────────────────────────────────────────────────────────

describe('HandshakeController — status and details', () => {
  it('N/A for a non-MQTT module, NONE before any request; details null only for non-MQTT', () => {
    const { controller } = setup();
    expect(controller.getStatus('HMI')).toBe(HandshakeStatus.NA);
    expect(controller.getStatus('Ghost')).toBe(HandshakeStatus.NA);
    expect(controller.getStatus('RF1')).toBe(HandshakeStatus.NONE);
    expect(controller.getDetails('HMI')).toBeNull();
    expect(controller.getDetails('RF1')).toEqual({
      module_id: 'RF1', status: HandshakeStatus.NONE, request: null, tag_list: null, confirm: null, push: null,
    });
  });

  it('REQUESTED after a request, with the identity and TAG_LIST recorded', () => {
    const { controller, send } = setup();
    send('RF1', request());

    const d = controller.getDetails('RF1')!;
    expect(d.status).toBe(HandshakeStatus.REQUESTED);
    expect(d.request).toMatchObject({ ts_utc_ms: 1, ip: '10.0.0.1', instance_id: 'aa', fw_hash: 'sha256:x', tag_registry_template: 'T', tag_registry_rev: 3 });
    expect(d.tag_list).toMatchObject({ tags: 2 });
    expect(d.tag_list!.bytes).toBeGreaterThan(0);
  });

  it('PUSHING while the Set push is unacknowledged, BOUND once acked', async () => {
    const { controller, cmdController, send, flush } = setup();
    let ack!: (r: { outcome: 'acked'; results: [] }) => void;
    vi.mocked(cmdController.pushSetpoints).mockReturnValueOnce(new Promise(r => { ack = r; }));

    send('RF1', request());
    send('RF1', confirm());
    await flush();
    expect(controller.getStatus('RF1')).toBe(HandshakeStatus.PUSHING);

    ack({ outcome: 'acked', results: [] });
    await flush();
    expect(controller.getStatus('RF1')).toBe(HandshakeStatus.BOUND);
    expect(controller.getDetails('RF1')!.push).toMatchObject({ outcome: 'acked', sets: 1, unpopulated: 0, rejected: [] });
  });

  it('MISSING_IDS when CONFIRM reported missing_ids, with the lists recorded', async () => {
    const { controller, send, flush } = setup();
    send('RF1', request());
    send('RF1', confirm({ missing_ids: ['Phase.Step_Mask'], unknown_tags: ['Legacy.X'], truncated: true }));
    await flush();

    expect(controller.getStatus('RF1')).toBe(HandshakeStatus.MISSING_IDS);
    expect(controller.getDetails('RF1')!.confirm).toMatchObject({ missing_ids: ['Phase.Step_Mask'], unknown_tags: ['Legacy.X'], truncated: true });
  });

  it('PUSH_FAILED on a push timeout or an unreadable setpoint store', async () => {
    const timeout = setup({ outcome: 'timeout' });
    timeout.send('RF1', request());
    timeout.send('RF1', confirm());
    await timeout.flush();
    expect(timeout.controller.getStatus('RF1')).toBe(HandshakeStatus.PUSH_FAILED);
    expect(timeout.controller.getDetails('RF1')!.push).toMatchObject({ outcome: 'timeout', consecutive_timeouts: 1 });

    const store = setup();
    vi.mocked(store.cmdController.getModuleSetpoints).mockRejectedValueOnce(new Error('db down'));
    store.send('RF1', request());
    store.send('RF1', confirm());
    await store.flush();
    expect(store.controller.getStatus('RF1')).toBe(HandshakeStatus.PUSH_FAILED);
  });

  it('BOUND with no Sets to push', async () => {
    const { controller, cmdController, send, flush } = setup();
    vi.mocked(cmdController.getModuleSetpoints).mockResolvedValueOnce([]);
    send('RF1', request());
    send('RF1', confirm());
    await flush();
    expect(controller.getStatus('RF1')).toBe(HandshakeStatus.BOUND);
    expect(controller.getDetails('RF1')!.push).toMatchObject({ outcome: 'no_sets' });
  });

  it('a request during an in-flight push keeps REQUESTED when the push settles', async () => {
    const { controller, cmdController, send, flush } = setup();
    let ack!: (r: { outcome: 'acked'; results: [] }) => void;
    vi.mocked(cmdController.pushSetpoints).mockReturnValueOnce(new Promise(r => { ack = r; }));

    send('RF1', request());
    send('RF1', confirm());
    await flush();
    send('RF1', request());
    ack({ outcome: 'acked', results: [] });
    await flush();

    expect(controller.getStatus('RF1')).toBe(HandshakeStatus.REQUESTED);
  });
});
