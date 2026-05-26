import { describe, it, expect, vi, afterEach } from 'vitest';
import { TrendSnapshotScheduler } from '../trend-snapshot-scheduler.js';
import { TelemetryIntake } from '../telemetry-intake.js';
import type { TelemetryMessage } from '../telemetry-intake.js';
import { LkvCache } from '../lkv.js';
import { DbPipeline } from '../db-pipeline.js';
import { DutyTracker } from '../duty-tracker.js';
import type { TagDef } from '@caro/hmi-context';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MODULE_A   = 'modA';
const MODULE_B   = 'modB';
const TAG_TREND  = 10;  // trendable, belongs to MODULE_A
const TAG_TREND2 = 11;  // trendable, belongs to MODULE_A
const TAG_MON    = 12;  // non-trendable, belongs to MODULE_A
const TAG_B      = 20;  // trendable, belongs to MODULE_B

function makeTagDef(tag_id: number, module_id: string): TagDef {
  return {
    tag_id,
    tag_path:    `${module_id}.tag${tag_id}`,
    tag_name:    null,
    data_type:   'f32',
    is_setpoint: false,
    module_id,
    module_type: 'MQTT',
    eng_min:     null,
    eng_max:     null,
    unit:        null,
    format:      null,
    meta:        [],
  };
}

const tagMap = new Map<number, TagDef>([
  [TAG_TREND,  makeTagDef(TAG_TREND,  MODULE_A)],
  [TAG_TREND2, makeTagDef(TAG_TREND2, MODULE_A)],
  [TAG_MON,    makeTagDef(TAG_MON,    MODULE_A)],
  [TAG_B,      makeTagDef(TAG_B,      MODULE_B)],
]);

const moduleTagIds = new Map<string, number[]>([
  [MODULE_A, [TAG_TREND, TAG_TREND2, TAG_MON]],
  [MODULE_B, [TAG_B]],
]);

const trendableTagIds = new Set<number>([TAG_TREND, TAG_TREND2, TAG_B]);

function makeMsg(
  tags: { tag_id: number; value: number | null }[],
  timestamp = 1000,
): TelemetryMessage {
  return { timestamp, status: 'OK', tags };
}

function makeIntake(lkv = new LkvCache(), dbPipeline = new DbPipeline()) {
  return new TelemetryIntake({
    lkv,
    tagMap,
    moduleTagIds,
    trendableTagIds,
    dbPipeline,
    watchdogTimeoutMs: 10_000,
    dutyTracker: new DutyTracker(),
  });
}

function makeScheduler(intake: TelemetryIntake, intervalMs = 1000) {
  return new TrendSnapshotScheduler(intake, moduleTagIds, new DutyTracker(), intervalMs);
}

// ── Tests: TelemetryIntake snapshot flag methods ──────────────────────────────

describe('TelemetryIntake — snapshot flag methods', () => {
  it('consumeTrendSnapshotPending returns false when flag was never set', () => {
    const intake = makeIntake();
    expect(intake.consumeTrendSnapshotPending(MODULE_A)).toBe(false);
  });

  it('markTrendSnapshotPending then consume returns true', () => {
    const intake = makeIntake();
    intake.markTrendSnapshotPending(MODULE_A);
    expect(intake.consumeTrendSnapshotPending(MODULE_A)).toBe(true);
  });

  it('flag is cleared after consumption — second consume returns false', () => {
    const intake = makeIntake();
    intake.markTrendSnapshotPending(MODULE_A);
    intake.consumeTrendSnapshotPending(MODULE_A);
    expect(intake.consumeTrendSnapshotPending(MODULE_A)).toBe(false);
  });
});

// ── Tests: piggyback path ─────────────────────────────────────────────────────

describe('TelemetryIntake — piggyback snapshot via ingest()', () => {
  afterEach((): void => { vi.restoreAllMocks(); });

  it('piggyback: ingest with flag set enqueues full trendable-tag set for module', () => {
    const lkv = new LkvCache();
    const dbPipeline = new DbPipeline();
    const enqueueSpy = vi.spyOn(dbPipeline, 'enqueue');
    const intake = makeIntake(lkv, dbPipeline);

    lkv.set(TAG_TREND,  1.0);
    lkv.set(TAG_TREND2, 2.0);

    intake.markTrendSnapshotPending(MODULE_A);
    // Only TAG_MON arrives — snapshot should include all trendable tags
    intake.ingest(MODULE_A, makeMsg([{ tag_id: TAG_MON, value: 5 }], 2000));

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const entry = enqueueSpy.mock.calls[0][0];
    expect(entry.moduleTs).toBe(2000);
    const tagIds = entry.tags.map((t: { tagId: number }) => t.tagId).sort((a: number, b: number) => a - b);
    expect(tagIds).toEqual([TAG_TREND, TAG_TREND2]);
  });

  it('piggyback: enqueued values come from LKV, not just the incoming message', () => {
    const lkv = new LkvCache();
    const dbPipeline = new DbPipeline();
    const enqueueSpy = vi.spyOn(dbPipeline, 'enqueue');
    const intake = makeIntake(lkv, dbPipeline);

    lkv.set(TAG_TREND,  42.0);
    lkv.set(TAG_TREND2, 99.0);

    intake.markTrendSnapshotPending(MODULE_A);
    intake.ingest(MODULE_A, makeMsg([], 3000));

    const entry = enqueueSpy.mock.calls[0][0];
    const valMap = new Map(entry.tags.map((t: { tagId: number; value: unknown }) => [t.tagId, t.value]));
    expect(valMap.get(TAG_TREND)).toBe(42.0);
    expect(valMap.get(TAG_TREND2)).toBe(99.0);
  });

  it('piggyback: null LKV values (uninitialized tags) are preserved in snapshot', () => {
    const lkv = new LkvCache();
    const dbPipeline = new DbPipeline();
    const enqueueSpy = vi.spyOn(dbPipeline, 'enqueue');
    const intake = makeIntake(lkv, dbPipeline);

    // TAG_TREND never set — getValue returns null
    lkv.set(TAG_TREND2, 5.0);

    intake.markTrendSnapshotPending(MODULE_A);
    intake.ingest(MODULE_A, makeMsg([], 4000));

    const entry = enqueueSpy.mock.calls[0][0];
    const valMap = new Map(entry.tags.map((t: { tagId: number; value: unknown }) => [t.tagId, t.value]));
    expect(valMap.get(TAG_TREND)).toBeNull();
    expect(valMap.get(TAG_TREND2)).toBe(5.0);
  });

  it('no flag → normal COV behavior — only changed trendable tags enqueued', () => {
    const lkv = new LkvCache();
    const dbPipeline = new DbPipeline();
    const enqueueSpy = vi.spyOn(dbPipeline, 'enqueue');
    const intake = makeIntake(lkv, dbPipeline);

    lkv.set(TAG_TREND, 1.0); // set initial so change is detectable
    intake.ingest(MODULE_A, makeMsg([{ tag_id: TAG_TREND, value: 2.0 }]));

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const entry = enqueueSpy.mock.calls[0][0];
    expect(entry.tags).toHaveLength(1);
    expect(entry.tags[0].tagId).toBe(TAG_TREND);
    expect(entry.tags[0].value).toBe(2.0);
  });

  it('no flag, unchanged value → no enqueue', () => {
    const lkv = new LkvCache();
    const dbPipeline = new DbPipeline();
    const enqueueSpy = vi.spyOn(dbPipeline, 'enqueue');
    const intake = makeIntake(lkv, dbPipeline);

    lkv.set(TAG_TREND, 1.0);
    intake.ingest(MODULE_A, makeMsg([{ tag_id: TAG_TREND, value: 1.0 }]));
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('flag is consumed by ingest — subsequent consume returns false', () => {
    const intake = makeIntake();
    intake.markTrendSnapshotPending(MODULE_A);
    intake.ingest(MODULE_A, makeMsg([]));
    expect(intake.consumeTrendSnapshotPending(MODULE_A)).toBe(false);
  });
});

// ── Tests: forceTrendSnapshot ─────────────────────────────────────────────────

describe('TelemetryIntake — forceTrendSnapshot()', () => {
  afterEach((): void => { vi.restoreAllMocks(); });

  it('enqueues full trendable-tag set with moduleTs = Date.now()', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(5000);
      const lkv = new LkvCache();
      const dbPipeline = new DbPipeline();
      const enqueueSpy = vi.spyOn(dbPipeline, 'enqueue');
      const intake = makeIntake(lkv, dbPipeline);

      lkv.set(TAG_TREND, 7.0);
      intake.forceTrendSnapshot(MODULE_A);

      expect(enqueueSpy).toHaveBeenCalledTimes(1);
      const entry = enqueueSpy.mock.calls[0][0];
      expect(entry.moduleTs).toBe(5000);
      const tagIds = entry.tags.map((t: { tagId: number }) => t.tagId).sort((a: number, b: number) => a - b);
      expect(tagIds).toEqual([TAG_TREND, TAG_TREND2]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not enqueue when module has zero trendable tags', () => {
    const noTrendModule = 'emptyMod';
    const localModuleTagIds = new Map<string, number[]>([[noTrendModule, [TAG_MON]]]);
    const dbPipeline = new DbPipeline();
    const enqueueSpy = vi.spyOn(dbPipeline, 'enqueue');
    const intake = new TelemetryIntake({
      lkv: new LkvCache(),
      tagMap,
      moduleTagIds: localModuleTagIds,
      trendableTagIds,
      dbPipeline,
      watchdogTimeoutMs: 10_000,
      dutyTracker: new DutyTracker(),
    });

    intake.forceTrendSnapshot(noTrendModule);
    expect(enqueueSpy).not.toHaveBeenCalled();
  });
});

// ── Tests: TrendSnapshotScheduler ticks ──────────────────────────────────────

describe('TrendSnapshotScheduler — tick behavior', () => {
  afterEach((): void => { vi.restoreAllMocks(); });

  it('first tick: does not forceTrendSnapshot (no prior mark), marks all modules', () => {
    vi.useFakeTimers();
    try {
      const intake = makeIntake();
      const forceSpy = vi.spyOn(intake, 'forceTrendSnapshot');
      const markSpy  = vi.spyOn(intake, 'markTrendSnapshotPending');

      const scheduler = makeScheduler(intake, 1000);
      scheduler.start();
      vi.advanceTimersByTime(1000);

      expect(forceSpy).not.toHaveBeenCalled();
      expect(markSpy).toHaveBeenCalledWith(MODULE_A);
      expect(markSpy).toHaveBeenCalledWith(MODULE_B);
      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('silent module: second tick force-writes and re-marks', () => {
    vi.useFakeTimers();
    try {
      const lkv = new LkvCache();
      const dbPipeline = new DbPipeline();
      const enqueueSpy = vi.spyOn(dbPipeline, 'enqueue');
      const intake = makeIntake(lkv, dbPipeline);
      const forceSpy = vi.spyOn(intake, 'forceTrendSnapshot');

      lkv.set(TAG_TREND, 3.0);

      const scheduler = makeScheduler(intake, 1000);
      scheduler.start();

      vi.advanceTimersByTime(1000); // tick 1: consume=false, mark all
      expect(forceSpy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1000); // tick 2: consume=true for both, force both
      expect(forceSpy).toHaveBeenCalledWith(MODULE_A);
      expect(forceSpy).toHaveBeenCalledWith(MODULE_B);
      expect(enqueueSpy).toHaveBeenCalled();
      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('active module: piggyback clears flag — second tick does not force that module', () => {
    vi.useFakeTimers();
    try {
      const intake = makeIntake();
      const forceSpy = vi.spyOn(intake, 'forceTrendSnapshot');

      const scheduler = makeScheduler(intake, 1000);
      scheduler.start();

      vi.advanceTimersByTime(1000); // tick 1: marks all modules
      expect(forceSpy).not.toHaveBeenCalled();

      // MODULE_A sends telemetry — piggyback consumes its flag
      intake.ingest(MODULE_A, makeMsg([{ tag_id: TAG_TREND, value: 5 }]));

      vi.advanceTimersByTime(1000); // tick 2: MODULE_A flag gone, MODULE_B still pending
      expect(forceSpy).not.toHaveBeenCalledWith(MODULE_A);
      expect(forceSpy).toHaveBeenCalledWith(MODULE_B);
      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── Tests: TrendSnapshotScheduler lifecycle ───────────────────────────────────

describe('TrendSnapshotScheduler — lifecycle', () => {
  afterEach((): void => { vi.restoreAllMocks(); });

  it('stop() without prior start() is a no-op', () => {
    const intake = makeIntake();
    const scheduler = makeScheduler(intake);
    expect(() => scheduler.stop()).not.toThrow();
  });

  it('start() twice clears the old handle — tick fires once per interval, not twice', () => {
    vi.useFakeTimers();
    try {
      const intake = makeIntake();
      const markSpy = vi.spyOn(intake, 'markTrendSnapshotPending');
      const scheduler = makeScheduler(intake, 1000);

      scheduler.start();
      scheduler.start(); // clears first handle

      vi.advanceTimersByTime(1000);
      // 2 modules × 1 tick = 2 mark calls; if two handles alive it'd be 4
      expect(markSpy.mock.calls.length).toBe(2);
      scheduler.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stop() prevents further ticks from firing', () => {
    vi.useFakeTimers();
    try {
      const intake = makeIntake();
      const markSpy = vi.spyOn(intake, 'markTrendSnapshotPending');
      const scheduler = makeScheduler(intake, 1000);

      scheduler.start();
      vi.advanceTimersByTime(1000); // one tick fires
      scheduler.stop();
      vi.advanceTimersByTime(2000); // no more ticks

      expect(markSpy.mock.calls.length).toBe(2); // only 2 modules × 1 tick
    } finally {
      vi.useRealTimers();
    }
  });
});
