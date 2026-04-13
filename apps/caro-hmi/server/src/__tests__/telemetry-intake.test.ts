import { describe, it, expect } from 'vitest';
import { TelemetryIntake } from '../telemetry-intake.js';
import type { TelemetryMessage } from '../telemetry-intake.js';
import { LkvCache } from '../lkv.js';
import { DbPipeline } from '../db-pipeline.js';
import type { TagDef } from '@caro/hmi-context';

// ── Fixture data ──────────────────────────────────────────────────────────────

const MODULE_ID   = 'mod1';
const TAG_MONITOR = 1;  // non-trendable
const TAG_TREND   = 2;  // trendable
const TAG_UNKNOWN = 999;

function makeTagDef(tag_id: number): TagDef {
  return {
    tag_id,
    tag_path:    `${MODULE_ID}.tag${tag_id}`,
    data_type:   'f32',
    is_setpoint: false,
    module_id:   MODULE_ID,
    eng_min:     null,
    eng_max:     null,
    unit:        null,
    meta:        [],
  };
}

const tagMap          = new Map<number, TagDef>([[TAG_MONITOR, makeTagDef(TAG_MONITOR)], [TAG_TREND, makeTagDef(TAG_TREND)]]);
const moduleTagIds    = new Map<string, number[]>([[MODULE_ID, [TAG_MONITOR, TAG_TREND]]]);
const trendableTagIds = new Set<number>([TAG_TREND]);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeIntake(lkv = new LkvCache(), dbPipeline = new DbPipeline(), watchdogTimeoutMs = 1000) {
  return new TelemetryIntake({ lkv, tagMap, moduleTagIds, trendableTagIds, dbPipeline, watchdogTimeoutMs });
}

function telemetryMsg(
  tags: { tag_id: number; value: number | boolean | string | null }[],
  status = 'OK',
  timestamp = 1000,
): TelemetryMessage {
  return { timestamp, status, tags };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TelemetryIntake', () => {
  it('ingest() updates LKV values', () => {
    const lkv = new LkvCache();
    const intake = makeIntake(lkv);

    intake.ingest(MODULE_ID, telemetryMsg([{ tag_id: TAG_MONITOR, value: 42.0 }]));

    expect(lkv.getValue(TAG_MONITOR)).toBe(42.0);
  });

  it('ingest() skips unknown tag_ids', () => {
    const lkv = new LkvCache();
    const intake = makeIntake(lkv);

    intake.ingest(MODULE_ID, telemetryMsg([{ tag_id: TAG_UNKNOWN, value: 99 }]));

    expect(lkv.has(TAG_UNKNOWN)).toBe(false);
  });

  it('only trendable tags are enqueued to DB pipeline', () => {
    const lkv = new LkvCache();
    const dbPipeline = new DbPipeline();
    const intake = makeIntake(lkv, dbPipeline);

    intake.ingest(MODULE_ID, telemetryMsg([
      { tag_id: TAG_MONITOR, value: 10 },
      { tag_id: TAG_TREND,   value: 20 },
    ]));

    expect(dbPipeline.queueSize).toBe(1);
    const [entry] = dbPipeline.flush();
    expect(entry.tags).toHaveLength(1);
    expect(entry.tags[0].tagId).toBe(TAG_TREND);
  });

  it('same value does not enqueue to DB pipeline', () => {
    const lkv = new LkvCache();
    const dbPipeline = new DbPipeline();
    const intake = makeIntake(lkv, dbPipeline);

    const msg = telemetryMsg([{ tag_id: TAG_TREND, value: 50 }]);
    intake.ingest(MODULE_ID, msg);
    dbPipeline.flush(); // clear first enqueue

    intake.ingest(MODULE_ID, msg); // same value
    expect(dbPipeline.queueSize).toBe(0);
  });

  it('FAULT status writes null to all module tags', () => {
    const lkv = new LkvCache();
    lkv.set(TAG_MONITOR, 100);
    lkv.set(TAG_TREND, 200);
    const intake = makeIntake(lkv);

    intake.ingest(MODULE_ID, telemetryMsg([], 'FAULT'));

    expect(lkv.getValue(TAG_MONITOR)).toBeNull();
    expect(lkv.getValue(TAG_TREND)).toBeNull();
  });

  it('watchdogTick writes null to all module tags on timeout', () => {
    const lkv = new LkvCache();
    lkv.set(TAG_MONITOR, 100);
    lkv.set(TAG_TREND, 200);
    // watchdogTimeoutMs=0 ensures any module (never seen or stale) times out immediately
    const intake = makeIntake(lkv, new DbPipeline(), 0);

    intake.watchdogTick();

    expect(lkv.getValue(TAG_MONITOR)).toBeNull();
    expect(lkv.getValue(TAG_TREND)).toBeNull();
  });

  it('watchdog does not fire for modules with recent telemetry', () => {
    const lkv = new LkvCache();
    lkv.set(TAG_MONITOR, 100);
    const intake = makeIntake(lkv); // watchdogTimeoutMs=1000

    // ingest sets lastSeen so now - lastSeen ≈ 0 < 1000
    intake.ingest(MODULE_ID, telemetryMsg([{ tag_id: TAG_MONITOR, value: 100 }]));
    intake.watchdogTick();

    expect(lkv.getValue(TAG_MONITOR)).toBe(100);
  });

  it('watchdog does not re-null already-timed-out modules (no extra generation bumps)', () => {
    const lkv = new LkvCache();
    lkv.set(TAG_MONITOR, 100);
    const intake = makeIntake(lkv, new DbPipeline(), 0);

    intake.watchdogTick(); // first tick: nulls tags, bumps generation
    const genAfterFirst = lkv.getGeneration(TAG_MONITOR);

    intake.watchdogTick(); // second tick: already in timedOutModules, no re-null
    expect(lkv.getGeneration(TAG_MONITOR)).toBe(genAfterFirst);
  });
});
