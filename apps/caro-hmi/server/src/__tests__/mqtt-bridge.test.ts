import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { MqttBridge } from '../mqtt-bridge.js';
import { TelemetryIntake } from '../telemetry-intake.js';
import { LkvCache } from '../lkv.js';
import { DbPipeline } from '../db-pipeline.js';
import { DutyTracker } from '../duty-tracker.js';
import type { TagDef } from '@caro/hmi-context';

// Module-level variable — reassigned in beforeEach so the factory closure
// always returns the current mock client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockClient: EventEmitter & { subscribe: any; publish: any; end: any };

vi.mock('mqtt', () => ({
  default: { connect: vi.fn(() => mockClient) },
}));

// ── Fixture data ──────────────────────────────────────────────────────────────

const MODULE_ID   = 'mod1';
const TAG_MONITOR = 1;
const TAG_TREND   = 2;

function makeTagDef(tag_id: number): TagDef {
  return {
    tag_id,
    tag_path:    `${MODULE_ID}.tag${tag_id}`,
    tag_name:    null,
    data_type:   'f32',
    is_setpoint: false,
    trendable:   true,
    module_id:   MODULE_ID,
    module_type: 'MQTT',
    eng_min:     null,
    eng_max:     null,
    unit:        null,
    format:      null,
    meta:        [],
  };
}

const tagMap          = new Map<number, TagDef>([[TAG_MONITOR, makeTagDef(TAG_MONITOR)], [TAG_TREND, makeTagDef(TAG_TREND)]]);
const moduleTagIds    = new Map<string, number[]>([[MODULE_ID, [TAG_MONITOR, TAG_TREND]]]);
const trendableTagIds = new Set<number>([TAG_TREND]);
const bridgeConfig    = { mqttUrl: 'mqtt://localhost:1883', heartbeatIntervalMs: 500 };

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeIntake() {
  return new TelemetryIntake({
    lkv: new LkvCache(),
    tagMap,
    moduleTagIds,
    trendableTagIds,
    dbPipeline: new DbPipeline(),
    watchdogTimeoutMs: 1000,
    dutyTracker: new DutyTracker(),
  });
}

function makeBridge(intake = makeIntake()) {
  return new MqttBridge({
    intake,
    moduleIds: [...moduleTagIds.keys()],
    config: bridgeConfig,
    dutyTracker: new DutyTracker(),
  });
}

async function startBridge(bridge: MqttBridge): Promise<void> {
  const p = bridge.start();
  mockClient.emit('connect');
  await p;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  const emitter = new EventEmitter();
  mockClient = Object.assign(emitter, {
    subscribe: vi.fn((_topic: string, cb?: (err: Error | null) => void) => { cb?.(null); return emitter; }),
    publish:   vi.fn((_topic: string, _payload: string, _opts?: unknown, cb?: () => void) => { cb?.(); return emitter; }),
    end:       vi.fn((_force?: boolean, cb?: () => void) => { cb?.(); return emitter; }),
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MqttBridge', () => {
  it('heartbeat publishes to correct topic for each module', async () => {
    const bridge = makeBridge();
    await startBridge(bridge);
    mockClient.publish.mockClear();

    bridge.heartbeatTick();

    const topics = mockClient.publish.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(topics).toContain(`caro/${MODULE_ID}/beat`);
    const beatPayload = JSON.parse(mockClient.publish.mock.calls[0][1] as string) as { ts_utc_ms: number };
    expect(typeof beatPayload.ts_utc_ms).toBe('number');
    await bridge.stop();
  });

  it('sends no command on connect — the snapshot follows the bind', async () => {
    const bridge = makeBridge();
    await startBridge(bridge);

    const cmdTopics = (mockClient.publish.mock.calls as unknown[][]).filter(c => c[0] === `caro/${MODULE_ID}/cmd`);
    expect(cmdTopics).toEqual([]);
    await bridge.stop();
  });

  it('publishCommand sends to correct topic with QoS 1', async () => {
    const bridge = makeBridge();
    await startBridge(bridge);
    mockClient.publish.mockClear();

    bridge.publishCommand(MODULE_ID, { command_type: 'SET_VALUES', tags: [] });

    expect(mockClient.publish).toHaveBeenCalledOnce();
    const [topic, , opts] = mockClient.publish.mock.calls[0] as [string, string, { qos: number }];
    expect(topic).toBe(`caro/${MODULE_ID}/cmd`);
    expect(opts).toMatchObject({ qos: 1 });
    await bridge.stop();
  });

  it('telemetry message calls intake.ingest with parsed moduleId and message', async () => {
    const lkv = new LkvCache();
    const intake = new TelemetryIntake({
      lkv, tagMap, moduleTagIds, trendableTagIds,
      dbPipeline: new DbPipeline(),
      watchdogTimeoutMs: 1000,
      dutyTracker: new DutyTracker(),
    });
    const bridge = makeBridge(intake);
    await startBridge(bridge);

    const payload = Buffer.from(JSON.stringify({
      timestamp: 1000,
      status: 'OK',
      tags: [{ tag_id: TAG_MONITOR, value: 42.0 }],
    }));
    mockClient.emit('message', `caro/${MODULE_ID}/telemetry`, payload);

    expect(lkv.getValue(TAG_MONITOR)).toBe(42.0);
    await bridge.stop();
  });
});

describe('MqttBridge — handshake', () => {
  it('subscribes to caro/+/handshake_module on connect', async () => {
    const bridge = makeBridge();
    await startBridge(bridge);
    const topics = (mockClient.subscribe.mock.calls as unknown[][]).map(c => c[0]);
    expect(topics).toContain('caro/+/handshake_module');
    await bridge.stop();
  });

  it('sends REHANDSHAKE on handshake_backend to each module on every connect', async () => {
    const bridge = makeBridge();
    await startBridge(bridge);

    const calls = mockClient.publish.mock.calls as unknown[][];
    const rehandshake = calls.findIndex(c => c[0] === `caro/${MODULE_ID}/handshake_backend`);
    expect(rehandshake).toBeGreaterThanOrEqual(0);
    expect(JSON.parse(calls[rehandshake][1] as string)).toMatchObject({ message_type: 'REHANDSHAKE', ts_utc_ms: expect.any(Number) });
    expect(calls[rehandshake][2]).toMatchObject({ qos: 1 });

    mockClient.publish.mockClear();
    mockClient.emit('connect');   // automatic reconnect
    expect((mockClient.publish.mock.calls as unknown[][]).some(c => c[0] === `caro/${MODULE_ID}/handshake_backend`)).toBe(true);
    await bridge.stop();
  });

  it('publishHandshake sends to caro/{module_id}/handshake_backend with QoS 1', async () => {
    const bridge = makeBridge();
    await startBridge(bridge);
    mockClient.publish.mockClear();

    bridge.publishHandshake(MODULE_ID, { message_type: 'TAG_LIST', ts_utc_ms: 1, payload: { tags: [] } });

    const [topic, payload, opts] = mockClient.publish.mock.calls[0] as [string, string, { qos: number }];
    expect(topic).toBe(`caro/${MODULE_ID}/handshake_backend`);
    expect(JSON.parse(payload)).toEqual({ message_type: 'TAG_LIST', ts_utc_ms: 1, payload: { tags: [] } });
    expect(opts).toMatchObject({ qos: 1 });
    await bridge.stop();
  });

  it('routes parsed handshake_module messages to the handler and drops unparseable ones', async () => {
    const bridge = makeBridge();
    const handler = vi.fn();
    bridge.onHandshake(handler);
    await startBridge(bridge);

    mockClient.emit('message', `caro/${MODULE_ID}/handshake_module`, Buffer.from('{"message_type":"CONFIRM"}'));
    mockClient.emit('message', `caro/${MODULE_ID}/handshake_module`, Buffer.from('not json'));

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(MODULE_ID, { message_type: 'CONFIRM' });
    await bridge.stop();
  });
});

describe('MqttBridge — malformed payloads', () => {
  function emit(channel: string, body: string) {
    mockClient.emit('message', `caro/${MODULE_ID}/${channel}`, Buffer.from(body));
  }

  it('drops telemetry that parses but is not a valid frame, without throwing', async () => {
    const intake = makeIntake();
    const ingest = vi.spyOn(intake, 'ingest');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bridge = makeBridge(intake);
    await startBridge(bridge);

    for (const body of ['{}', 'null', '[]', '{"timestamp":1,"status":"ONLINE"}', '{"timestamp":1,"status":"ONLINE","tags":5}']) {
      expect(() => emit('telemetry', body)).not.toThrow();
    }

    expect(ingest).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    await bridge.stop();
  });

  it('ingests the valid entries of a frame and skips the bad ones', async () => {
    const lkv = new LkvCache();
    const intake = new TelemetryIntake({
      lkv, tagMap, moduleTagIds, trendableTagIds,
      dbPipeline: new DbPipeline(),
      watchdogTimeoutMs: 1000,
      dutyTracker: new DutyTracker(),
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const bridge = makeBridge(intake);
    await startBridge(bridge);

    emit('telemetry', JSON.stringify({
      timestamp: 1, status: 'ONLINE',
      tags: [{ tag_id: TAG_MONITOR, value: 7 }, { tag_id: 'x', value: 1 }, null],
    }));

    expect(lkv.getValue(TAG_MONITOR)).toBe(7);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('skipped'));
    warn.mockRestore();
    await bridge.stop();
  });

  it('drops a malformed CMD_ACK without throwing or calling the handler', async () => {
    const bridge = makeBridge();
    const handler = vi.fn();
    bridge.onCmdAck(handler);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await startBridge(bridge);

    for (const body of ['null', '{}', '{"command_id":"c","results":[{"tag_id":1}]}']) {
      expect(() => emit('cmd_ack', body)).not.toThrow();
    }
    emit('cmd_ack', '{"command_id":"c","results":[{"tag_id":1,"accepted":true}]}');

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(MODULE_ID, expect.objectContaining({ command_id: 'c' }));
    warn.mockRestore();
    await bridge.stop();
  });
});

describe('MqttBridge — heartbeat timer', () => {
  const beats = () => (mockClient.publish.mock.calls as unknown[][]).filter(c => c[0] === `caro/${MODULE_ID}/beat`).length;

  it('beats once per interval after any number of reconnects', async () => {
    vi.useFakeTimers();
    try {
      const bridge = makeBridge();
      await startBridge(bridge);
      mockClient.emit('connect');   // automatic reconnects
      mockClient.emit('connect');
      mockClient.publish.mockClear();

      vi.advanceTimersByTime(bridgeConfig.heartbeatIntervalMs * 3);

      expect(beats()).toBe(3);
      await bridge.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops beating while disconnected and resumes on reconnect', async () => {
    vi.useFakeTimers();
    try {
      const bridge = makeBridge();
      await startBridge(bridge);
      mockClient.emit('close');
      mockClient.publish.mockClear();

      vi.advanceTimersByTime(bridgeConfig.heartbeatIntervalMs * 3);
      expect(beats()).toBe(0);

      mockClient.emit('connect');
      vi.advanceTimersByTime(bridgeConfig.heartbeatIntervalMs);
      expect(beats()).toBe(1);
      await bridge.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop() leaves no timer running after reconnects', async () => {
    vi.useFakeTimers();
    try {
      const bridge = makeBridge();
      await startBridge(bridge);
      mockClient.emit('connect');
      await bridge.stop();
      mockClient.publish.mockClear();

      vi.advanceTimersByTime(bridgeConfig.heartbeatIntervalMs * 3);

      expect(beats()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
