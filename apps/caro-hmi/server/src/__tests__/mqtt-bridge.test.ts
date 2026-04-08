import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import { MqttBridge } from '../mqtt-bridge.js';
import { LkvCache } from '../lkv.js';
import { DbPipeline } from '../db-pipeline.js';
import type { TagDef } from '@caro/hmi-context';

// Module-level variable — reassigned in beforeEach so the factory closure
// always returns the current mock client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockClient: EventEmitter & { subscribe: any; publish: any; end: any };

vi.mock('mqtt', () => ({
  default: { connect: vi.fn(() => mockClient) },
}));

// ── Fixture data ──────────────────────────────────────────────────────────────

const MODULE_ID = 'mod1';
const TAG_MONITOR = 1; // non-trendable
const TAG_TREND   = 2; // trendable
const TAG_UNKNOWN = 999;

function makeTagDef(tag_id: number): TagDef {
  return {
    tag_id,
    tag_path:    `${MODULE_ID}.tag${tag_id}`,
    data_type:   'f64',
    is_setpoint: false,
    module_id:   MODULE_ID,
    eng_min:     null,
    eng_max:     null,
    unit:        null,
    meta:        [],
  };
}

const tagMap        = new Map<number, TagDef>([[TAG_MONITOR, makeTagDef(TAG_MONITOR)], [TAG_TREND, makeTagDef(TAG_TREND)]]);
const moduleTagIds  = new Map<string, number[]>([[MODULE_ID, [TAG_MONITOR, TAG_TREND]]]);
const trendableTagIds = new Set<number>([TAG_TREND]);
const bridgeConfig  = { mqttUrl: 'mqtt://localhost:1883', watchdogTimeoutMs: 1000, heartbeatIntervalMs: 500 };

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeBridge(lkv = new LkvCache(), dbPipeline = new DbPipeline()) {
  return new MqttBridge({ lkv, tagMap, moduleTagIds, trendableTagIds, dbPipeline, config: bridgeConfig });
}

async function startBridge(bridge: MqttBridge): Promise<void> {
  const p = bridge.start();
  mockClient.emit('connect');
  await p;
}

function telemetryPayload(
  tags: { tag_id: number; value: number | boolean | string | null }[],
  status = 'OK',
  timestamp = 1000
): Buffer {
  return Buffer.from(JSON.stringify({ timestamp, status, tags }));
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
  it('telemetry message updates LKV values', async () => {
    const lkv = new LkvCache();
    const bridge = makeBridge(lkv);
    await startBridge(bridge);

    mockClient.emit('message', `caro/${MODULE_ID}/telemetry`,
      telemetryPayload([{ tag_id: TAG_MONITOR, value: 42.0 }]));

    expect(lkv.getValue(TAG_MONITOR)).toBe(42.0);
    await bridge.stop();
  });

  it('telemetry message skips unknown tag_ids', async () => {
    const lkv = new LkvCache();
    const bridge = makeBridge(lkv);
    await startBridge(bridge);

    mockClient.emit('message', `caro/${MODULE_ID}/telemetry`,
      telemetryPayload([{ tag_id: TAG_UNKNOWN, value: 99 }]));

    expect(lkv.has(TAG_UNKNOWN)).toBe(false);
    await bridge.stop();
  });

  it('only trendable tags are enqueued to DB pipeline', async () => {
    const lkv = new LkvCache();
    const dbPipeline = new DbPipeline();
    const bridge = makeBridge(lkv, dbPipeline);
    await startBridge(bridge);

    mockClient.emit('message', `caro/${MODULE_ID}/telemetry`,
      telemetryPayload([
        { tag_id: TAG_MONITOR, value: 10 },
        { tag_id: TAG_TREND,   value: 20 },
      ]));

    expect(dbPipeline.queueSize).toBe(1);
    const [entry] = dbPipeline.flush();
    expect(entry.tags).toHaveLength(1);
    expect(entry.tags[0].tagId).toBe(TAG_TREND);
    await bridge.stop();
  });

  it('same value does not enqueue to DB pipeline', async () => {
    const lkv = new LkvCache();
    const dbPipeline = new DbPipeline();
    const bridge = makeBridge(lkv, dbPipeline);
    await startBridge(bridge);

    const payload = telemetryPayload([{ tag_id: TAG_TREND, value: 50 }]);
    mockClient.emit('message', `caro/${MODULE_ID}/telemetry`, payload);
    dbPipeline.flush(); // clear first enqueue

    mockClient.emit('message', `caro/${MODULE_ID}/telemetry`, payload); // same value
    expect(dbPipeline.queueSize).toBe(0);
    await bridge.stop();
  });

  it('module FAULT status writes null to all module tags', async () => {
    const lkv = new LkvCache();
    lkv.set(TAG_MONITOR, 100);
    lkv.set(TAG_TREND, 200);
    const bridge = makeBridge(lkv);
    await startBridge(bridge);

    mockClient.emit('message', `caro/${MODULE_ID}/telemetry`,
      telemetryPayload([], 'FAULT'));

    expect(lkv.getValue(TAG_MONITOR)).toBeNull();
    expect(lkv.getValue(TAG_TREND)).toBeNull();
    await bridge.stop();
  });

  it('watchdog writes null to all module tags on timeout', async () => {
    const lkv = new LkvCache();
    lkv.set(TAG_MONITOR, 100);
    lkv.set(TAG_TREND, 200);
    // Use timeout=0 so any call to watchdogTick() after start triggers the timeout
    const bridge = new MqttBridge({
      lkv, tagMap, moduleTagIds, trendableTagIds, dbPipeline: new DbPipeline(),
      config: { ...bridgeConfig, watchdogTimeoutMs: 0 },
    });
    await startBridge(bridge);

    bridge.watchdogTick();

    expect(lkv.getValue(TAG_MONITOR)).toBeNull();
    expect(lkv.getValue(TAG_TREND)).toBeNull();
    await bridge.stop();
  });

  it('watchdog does not fire for modules with recent telemetry', async () => {
    const lkv = new LkvCache();
    lkv.set(TAG_MONITOR, 100);
    const bridge = makeBridge(lkv);
    await startBridge(bridge);

    // Send telemetry to mark module as recently active
    mockClient.emit('message', `caro/${MODULE_ID}/telemetry`,
      telemetryPayload([{ tag_id: TAG_MONITOR, value: 100 }]));

    // watchdogTimeoutMs=1000 — lastSeen just set, so now - lastSeen ≈ 0 < 1000
    bridge.watchdogTick();

    expect(lkv.getValue(TAG_MONITOR)).toBe(100);
    await bridge.stop();
  });

  it('watchdog does not re-null already-timed-out modules (no extra generation bumps)', async () => {
    const lkv = new LkvCache();
    lkv.set(TAG_MONITOR, 100);
    const bridge = new MqttBridge({
      lkv, tagMap, moduleTagIds, trendableTagIds, dbPipeline: new DbPipeline(),
      config: { ...bridgeConfig, watchdogTimeoutMs: 0 },
    });
    await startBridge(bridge);

    bridge.watchdogTick(); // first tick: nulls tags, generation bumps to 2
    const genAfterFirst = lkv.getGeneration(TAG_MONITOR);

    bridge.watchdogTick(); // second tick: module already in timedOutModules, skip
    expect(lkv.getGeneration(TAG_MONITOR)).toBe(genAfterFirst);
    await bridge.stop();
  });

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

  it('REQUEST_SNAPSHOT is sent on start for each module', async () => {
    const bridge = makeBridge();
    await startBridge(bridge);

    const cmdTopics = (mockClient.publish.mock.calls as unknown[][])
      .map(c => c[0] as string)
      .filter(t => t === `caro/${MODULE_ID}/cmd`);
    expect(cmdTopics.length).toBeGreaterThanOrEqual(1);

    const snapshotCall = (mockClient.publish.mock.calls as unknown[][]).find(
      c => (c[0] as string) === `caro/${MODULE_ID}/cmd`
    )!;
    const body = JSON.parse(snapshotCall[1] as string) as { command_type: string };
    expect(body.command_type).toBe('REQUEST_SNAPSHOT');
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
});
