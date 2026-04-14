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
    data_type:   'f32',
    is_setpoint: false,
    module_id:   MODULE_ID,
    module_type: 'MQTT',
    eng_min:     null,
    eng_max:     null,
    unit:        null,
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
