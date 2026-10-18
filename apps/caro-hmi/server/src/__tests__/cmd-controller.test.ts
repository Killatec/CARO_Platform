import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@caro/db', () => ({
  upsertPendingSetpoints:        vi.fn(() => Promise.resolve()),
  upsertCommandedSetpoints:      vi.fn(() => Promise.resolve()),
  getCommandedSetpointsByTagIds: vi.fn(() => Promise.resolve([])),
}));

import { upsertPendingSetpoints, upsertCommandedSetpoints, getCommandedSetpointsByTagIds } from '@caro/db';
import { CmdController } from '../cmd-controller.js';
import type { MqttBridge, CmdAck } from '../mqtt-bridge.js';
import type { HmiTagSource } from '../hmi-tag-source.js';
import type { TagDef } from '@caro/hmi-context';

// ── Fixture data ──────────────────────────────────────────────────────────────

const MQTT_MODULE = 'mqttMod';
const HMI_MODULE  = 'hmiMod';
const MQTT_TAG    = 1;
const HMI_TAG     = 2;
const MQTT_TAG_2  = 4;

function makeTagDef(tag_id: number, module_id: string, module_type: string): TagDef {
  return {
    tag_id,
    tag_path:    `${module_id}.tag${tag_id}`,
    tag_name:    null,
    data_type:   'f32',
    is_setpoint: true,
    trendable:   true,
    module_id,
    module_type,
    eng_min:     null,
    eng_max:     null,
    unit:        null,
    format:      null,
    meta:        [],
  };
}

const tagMap = new Map<number, TagDef>([
  [MQTT_TAG, makeTagDef(MQTT_TAG, MQTT_MODULE, 'MQTT')],
  [HMI_TAG,  makeTagDef(HMI_TAG,  HMI_MODULE,  'HMI')],
  [MQTT_TAG_2, makeTagDef(MQTT_TAG_2, MQTT_MODULE, 'MQTT')],
]);

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMocks() {
  let capturedAckHandler: ((moduleId: string, ack: CmdAck) => void) | undefined;

  const mqttBridge = {
    publishCommand:      vi.fn(),
    sendRequestSnapshot: vi.fn(),
    onCmdAck: vi.fn((handler: (moduleId: string, ack: CmdAck) => void) => {
      capturedAckHandler = handler;
    }),
  } as unknown as MqttBridge;

  const hmiTagSource = {
    setValue:   vi.fn(),
    publishNow: vi.fn(),
    reset:      vi.fn(),
  } as unknown as HmiTagSource;

  const ctrl = new CmdController({ mqttBridge, hmiTagSource, tagMap, ackTimeoutMs: 100 });

  return {
    ctrl,
    mqttBridge,
    hmiTagSource,
    triggerAck: (ack: CmdAck) => capturedAckHandler?.(MQTT_MODULE, ack),
  };
}

function lastCommandId(mqttBridge: MqttBridge): string {
  const calls = (mqttBridge.publishCommand as ReturnType<typeof vi.fn>).mock.calls;
  return (calls[calls.length - 1][1] as { command_id: string }).command_id;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CmdController', () => {
  it('routes SET_VALUES for MQTT module via mqttBridge', async () => {
    const { ctrl, mqttBridge, triggerAck } = makeMocks();

    const writePromise = ctrl.writeValues([{ tag_id: MQTT_TAG, value: 42 }]);

    // Extract commandId from the published command and simulate ACK
    const publishedCmd = (mqttBridge.publishCommand as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as { command_id: string };
    triggerAck({
      command_id:   publishedCmd.command_id,
      command_type: 'SET_VALUES',
      ts_utc_ms:    Date.now(),
      results:      [{ tag_id: MQTT_TAG, accepted: true }],
    });

    const result = await writePromise;
    expect(mqttBridge.publishCommand).toHaveBeenCalledOnce();
    const [calledModuleId] = (mqttBridge.publishCommand as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(calledModuleId).toBe(MQTT_MODULE);
    expect(result.devices[0].results[0]).toMatchObject({ tag_id: MQTT_TAG, accepted: true });
  });

  it('routes SET_VALUES for HMI module via hmiTagSource (immediate success)', async () => {
    const { ctrl, hmiTagSource } = makeMocks();

    const result = await ctrl.writeValues([{ tag_id: HMI_TAG, value: 99 }]);

    expect(hmiTagSource.setValue).toHaveBeenCalledWith(HMI_TAG, 99);
    expect(result.devices[0].results[0]).toMatchObject({ tag_id: HMI_TAG, accepted: true });
  });

  it('requestSnapshot for MQTT module calls mqttBridge.sendRequestSnapshot', () => {
    const { ctrl, mqttBridge } = makeMocks();

    ctrl.requestSnapshot(MQTT_MODULE);

    expect(mqttBridge.sendRequestSnapshot).toHaveBeenCalledWith(MQTT_MODULE);
  });

  it('requestSnapshot for HMI module calls hmiTagSource.publishNow', () => {
    const { ctrl, hmiTagSource } = makeMocks();

    ctrl.requestSnapshot(HMI_MODULE);

    expect(hmiTagSource.publishNow).toHaveBeenCalled();
  });

  it('sendReset publishes RESET command for MQTT module', () => {
    const { ctrl, mqttBridge } = makeMocks();

    ctrl.sendReset(MQTT_MODULE);

    expect(mqttBridge.publishCommand).toHaveBeenCalledOnce();
    const [calledModuleId, command] = (mqttBridge.publishCommand as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { command_type: string }];
    expect(calledModuleId).toBe(MQTT_MODULE);
    expect(command.command_type).toBe('RESET');
  });

  it('sendReset calls hmiTagSource.reset() for HMI module', () => {
    const { ctrl, hmiTagSource } = makeMocks();

    ctrl.sendReset(HMI_MODULE);

    expect(hmiTagSource.reset).toHaveBeenCalledOnce();
  });

  it('sendResetAll sends reset to all modules regardless of type', () => {
    const { ctrl, mqttBridge, hmiTagSource } = makeMocks();

    ctrl.sendResetAll();

    expect(mqttBridge.publishCommand).toHaveBeenCalledOnce();
    expect(hmiTagSource.reset).toHaveBeenCalledOnce();
  });

  it('returns not-accepted for unknown module_type', async () => {
    const SERIAL_MODULE = 'serialMod';
    const SERIAL_TAG    = 3;

    const tagMapWithSerial = new Map<number, TagDef>([
      ...tagMap,
      [SERIAL_TAG, makeTagDef(SERIAL_TAG, SERIAL_MODULE, 'SERIAL')],
    ]);

    const { mqttBridge, hmiTagSource } = makeMocks();
    const ctrl = new CmdController({ mqttBridge, hmiTagSource, tagMap: tagMapWithSerial, ackTimeoutMs: 100 });

    const result = await ctrl.writeValues([{ tag_id: SERIAL_TAG, value: 1 }]);

    expect(result.devices[0].results[0]).toMatchObject({
      tag_id:         SERIAL_TAG,
      accepted:       false,
      rejection_code: 'MODULE_TYPE_NOT_SUPPORTED',
    });
  });
});

describe('CmdController — setpoint stores', () => {
  it('accepted ACK: stores accepted values in both pending and commanded stores', async () => {
    const { ctrl, mqttBridge, triggerAck } = makeMocks();

    const writePromise = ctrl.writeValues([{ tag_id: MQTT_TAG, value: 42 }]);
    triggerAck({
      command_id:   lastCommandId(mqttBridge),
      command_type: 'SET_VALUES',
      ts_utc_ms:    Date.now(),
      results:      [{ tag_id: MQTT_TAG, accepted: true }],
    });
    await writePromise;

    expect(upsertPendingSetpoints).toHaveBeenCalledWith([{ tag_id: MQTT_TAG, value: 42 }]);
    expect(upsertCommandedSetpoints).toHaveBeenCalledWith([
      { tag_id: MQTT_TAG, value: 42, ack_status: 'accepted' },
    ]);
  });

  it('partial rejection: only the accepted tag is stored; the rejected row is left unchanged', async () => {
    const { ctrl, mqttBridge, triggerAck } = makeMocks();

    const writePromise = ctrl.writeValues([
      { tag_id: MQTT_TAG,   value: 1 },
      { tag_id: MQTT_TAG_2, value: 2 },
    ]);
    triggerAck({
      command_id:   lastCommandId(mqttBridge),
      command_type: 'SET_VALUES',
      ts_utc_ms:    Date.now(),
      results: [
        { tag_id: MQTT_TAG,   accepted: true },
        { tag_id: MQTT_TAG_2, accepted: false, rejection_code: 'OUT_OF_RANGE' },
      ],
    });
    await writePromise;

    expect(upsertPendingSetpoints).toHaveBeenCalledWith([{ tag_id: MQTT_TAG, value: 1 }]);
    expect(upsertCommandedSetpoints).toHaveBeenCalledOnce();
    expect(upsertCommandedSetpoints).toHaveBeenCalledWith([
      { tag_id: MQTT_TAG, value: 1, ack_status: 'accepted' },
    ]);
  });

  it('all rejected: neither store is written', async () => {
    const { ctrl, mqttBridge, triggerAck } = makeMocks();

    const writePromise = ctrl.writeValues([{ tag_id: MQTT_TAG, value: 1 }]);
    triggerAck({
      command_id:   lastCommandId(mqttBridge),
      command_type: 'SET_VALUES',
      ts_utc_ms:    Date.now(),
      results:      [{ tag_id: MQTT_TAG, accepted: false, rejection_code: 'MODULE_FAULT' }],
    });
    await writePromise;

    expect(upsertPendingSetpoints).not.toHaveBeenCalled();
    expect(upsertCommandedSetpoints).not.toHaveBeenCalled();
  });

  it('timeout: stores every value as timeout in the commanded store only', async () => {
    const { ctrl } = makeMocks();

    const result = await ctrl.writeValues([
      { tag_id: MQTT_TAG,   value: 7 },
      { tag_id: MQTT_TAG_2, value: true },
    ]);

    expect(result.devices[0].results.every(r => r.rejection_code === 'TIMEOUT')).toBe(true);
    expect(upsertPendingSetpoints).not.toHaveBeenCalled();
    expect(upsertCommandedSetpoints).toHaveBeenCalledWith([
      { tag_id: MQTT_TAG,   value: 7,    ack_status: 'timeout' },
      { tag_id: MQTT_TAG_2, value: true, ack_status: 'timeout' },
    ]);
  });

  it('late ACK after timeout is ignored: the row stays timeout', async () => {
    const { ctrl, mqttBridge, triggerAck } = makeMocks();

    await ctrl.writeValues([{ tag_id: MQTT_TAG, value: 7 }]);
    triggerAck({
      command_id:   lastCommandId(mqttBridge),
      command_type: 'SET_VALUES',
      ts_utc_ms:    Date.now(),
      results:      [{ tag_id: MQTT_TAG, accepted: true }],
    });

    expect(upsertCommandedSetpoints).toHaveBeenCalledOnce();
    expect(upsertCommandedSetpoints).toHaveBeenCalledWith([
      { tag_id: MQTT_TAG, value: 7, ack_status: 'timeout' },
    ]);
  });

  it('HMI-module writes are not stored', async () => {
    const { ctrl } = makeMocks();

    await ctrl.writeValues([{ tag_id: HMI_TAG, value: 99 }]);

    expect(upsertPendingSetpoints).not.toHaveBeenCalled();
    expect(upsertCommandedSetpoints).not.toHaveBeenCalled();
  });

  it('restorePendingSetpoints re-sends the populated commanded values of the module, skipping nulls', async () => {
    const { ctrl, mqttBridge } = makeMocks();
    vi.mocked(getCommandedSetpointsByTagIds).mockResolvedValueOnce([
      { tag_id: MQTT_TAG,   value: 3.5,  ack_status: 'timeout',  set_by: null, set_at: new Date() },
      { tag_id: MQTT_TAG_2, value: null, ack_status: 'accepted', set_by: null, set_at: new Date() },
    ]);

    await ctrl.restorePendingSetpoints(MQTT_MODULE);

    expect(getCommandedSetpointsByTagIds).toHaveBeenCalledWith([MQTT_TAG, MQTT_TAG_2]);
    expect(mqttBridge.publishCommand).toHaveBeenCalledOnce();
    const [moduleId, command] = (mqttBridge.publishCommand as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { command_type: string; payload: { values: unknown[] } },
    ];
    expect(moduleId).toBe(MQTT_MODULE);
    expect(command.command_type).toBe('SET_VALUES');
    expect(command.payload.values).toEqual([{ tag_id: MQTT_TAG, value: 3.5 }]);
  });

  it('restorePendingSetpoints publishes nothing when every stored value is null', async () => {
    const { ctrl, mqttBridge } = makeMocks();
    vi.mocked(getCommandedSetpointsByTagIds).mockResolvedValueOnce([
      { tag_id: MQTT_TAG, value: null, ack_status: 'accepted', set_by: null, set_at: new Date() },
    ]);

    await ctrl.restorePendingSetpoints(MQTT_MODULE);

    expect(mqttBridge.publishCommand).not.toHaveBeenCalled();
  });

  it('restorePendingSetpoints is a no-op for an HMI module', async () => {
    const { ctrl, mqttBridge } = makeMocks();

    await ctrl.restorePendingSetpoints(HMI_MODULE);

    expect(getCommandedSetpointsByTagIds).not.toHaveBeenCalled();
    expect(mqttBridge.publishCommand).not.toHaveBeenCalled();
  });
});

describe('CmdController — handshake Set push', () => {
  it('getModuleSetpoints returns every Set of the module, null-filled, ordered by tag_id', async () => {
    const { ctrl } = makeMocks();
    vi.mocked(getCommandedSetpointsByTagIds).mockResolvedValueOnce([
      { tag_id: MQTT_TAG_2, value: true, ack_status: 'timeout', set_by: 'import:x', set_at: new Date() },
    ]);

    const result = await ctrl.getModuleSetpoints(MQTT_MODULE);

    expect(getCommandedSetpointsByTagIds).toHaveBeenCalledWith([MQTT_TAG, MQTT_TAG_2]);
    expect(result).toEqual([
      { tag_id: MQTT_TAG,   value: null, ack_status: null,      set_by: null },
      { tag_id: MQTT_TAG_2, value: true, ack_status: 'timeout', set_by: 'import:x' },
    ]);
  });

  it('pushSetpoints publishes every value, nulls included, before returning', () => {
    const { ctrl, mqttBridge } = makeMocks();

    void ctrl.pushSetpoints(MQTT_MODULE, [
      { tag_id: MQTT_TAG,   value: null, ack_status: null,       set_by: null },
      { tag_id: MQTT_TAG_2, value: 5,    ack_status: 'accepted', set_by: null },
    ]);

    const [moduleId, command] = (mqttBridge.publishCommand as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string, { command_type: string; payload: { values: unknown[] } },
    ];
    expect(moduleId).toBe(MQTT_MODULE);
    expect(command.command_type).toBe('SET_VALUES');
    expect(command.payload.values).toEqual([{ tag_id: MQTT_TAG, value: null }, { tag_id: MQTT_TAG_2, value: 5 }]);
  });

  it('pushSetpoints ACK upgrades only accepted timeout rows, keeping set_by; nulls and pending are not written', async () => {
    const { ctrl, mqttBridge, triggerAck } = makeMocks();

    const push = ctrl.pushSetpoints(MQTT_MODULE, [
      { tag_id: MQTT_TAG,   value: 7,    ack_status: 'timeout',  set_by: 'import:x' },
      { tag_id: MQTT_TAG_2, value: null, ack_status: null,       set_by: null },
    ]);
    triggerAck({
      command_id:   lastCommandId(mqttBridge),
      command_type: 'SET_VALUES',
      ts_utc_ms:    Date.now(),
      results: [{ tag_id: MQTT_TAG, accepted: true }, { tag_id: MQTT_TAG_2, accepted: true }],
    });

    await expect(push).resolves.toMatchObject({ outcome: 'acked' });
    expect(upsertCommandedSetpoints).toHaveBeenCalledWith([
      { tag_id: MQTT_TAG, value: 7, ack_status: 'accepted', set_by: 'import:x' },
    ]);
    expect(upsertPendingSetpoints).not.toHaveBeenCalled();
  });

  it('pushSetpoints ACK on already-accepted rows writes nothing', async () => {
    const { ctrl, mqttBridge, triggerAck } = makeMocks();

    const push = ctrl.pushSetpoints(MQTT_MODULE, [{ tag_id: MQTT_TAG, value: 7, ack_status: 'accepted', set_by: 'import:x' }]);
    triggerAck({ command_id: lastCommandId(mqttBridge), command_type: 'SET_VALUES', ts_utc_ms: Date.now(), results: [{ tag_id: MQTT_TAG, accepted: true }] });

    await push;
    expect(upsertCommandedSetpoints).not.toHaveBeenCalled();
  });

  it('pushSetpoints without an ACK resolves timeout and writes nothing', async () => {
    const { ctrl } = makeMocks();

    await expect(
      ctrl.pushSetpoints(MQTT_MODULE, [{ tag_id: MQTT_TAG, value: 7, ack_status: 'timeout', set_by: null }]),
    ).resolves.toEqual({ outcome: 'timeout' });
    expect(upsertCommandedSetpoints).not.toHaveBeenCalled();
  });
});

