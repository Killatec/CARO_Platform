import { describe, it, expect, vi } from 'vitest';
import { CmdController } from '../cmd-controller.js';
import type { MqttBridge, CmdAck } from '../mqtt-bridge.js';
import type { HmiTagSource } from '../hmi-tag-source.js';
import type { TagDef } from '@caro/hmi-context';

// ── Fixture data ──────────────────────────────────────────────────────────────

const MQTT_MODULE = 'mqttMod';
const HMI_MODULE  = 'hmiMod';
const MQTT_TAG    = 1;
const HMI_TAG     = 2;

function makeTagDef(tag_id: number, module_id: string, module_type: string): TagDef {
  return {
    tag_id,
    tag_path:    `${module_id}.tag${tag_id}`,
    data_type:   'f32',
    is_setpoint: true,
    module_id,
    module_type,
    eng_min:     null,
    eng_max:     null,
    unit:        null,
    meta:        [],
  };
}

const tagMap = new Map<number, TagDef>([
  [MQTT_TAG, makeTagDef(MQTT_TAG, MQTT_MODULE, 'MQTT')],
  [HMI_TAG,  makeTagDef(HMI_TAG,  HMI_MODULE,  'HMI')],
]);

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
