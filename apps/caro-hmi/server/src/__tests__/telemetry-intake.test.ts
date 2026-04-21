import { describe, it, expect, vi, afterEach } from 'vitest';
import { TelemetryIntake } from '../telemetry-intake.js';
import type { TelemetryMessage } from '../telemetry-intake.js';
import { LkvCache } from '../lkv.js';
import { DbPipeline } from '../db-pipeline.js';
import { DutyTracker } from '../duty-tracker.js';
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

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeIntake(lkv = new LkvCache(), dbPipeline = new DbPipeline(), watchdogTimeoutMs = 1000) {
  return new TelemetryIntake({ lkv, tagMap, moduleTagIds, trendableTagIds, dbPipeline, watchdogTimeoutMs, dutyTracker: new DutyTracker() });
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

  // ── getModuleStats ────────────────────────────────────────────────────────────

  it('getModuleStats returns empty array when no modules known', () => {
    const intake = new TelemetryIntake({
      lkv: new LkvCache(),
      tagMap,
      moduleTagIds: new Map(),
      trendableTagIds,
      dbPipeline: new DbPipeline(),
      watchdogTimeoutMs: 1000,
      dutyTracker: new DutyTracker(),
    });
    expect(intake.getModuleStats()).toEqual([]);
  });

  it('getModuleStats returns entry for each known module', () => {
    const twoModules = new Map<string, number[]>([
      ['modA', [TAG_MONITOR]],
      ['modB', [TAG_TREND]],
    ]);
    const intake = new TelemetryIntake({
      lkv: new LkvCache(),
      tagMap,
      moduleTagIds: twoModules,
      trendableTagIds,
      dbPipeline: new DbPipeline(),
      watchdogTimeoutMs: 1000,
      dutyTracker: new DutyTracker(),
    });
    expect(intake.getModuleStats()).toHaveLength(2);
  });

  it('ingest updates tags_in_last_packet', () => {
    const intake = makeIntake();
    intake.ingest(MODULE_ID, telemetryMsg([
      { tag_id: TAG_MONITOR, value: 1 },
      { tag_id: TAG_TREND,   value: 2 },
      { tag_id: TAG_UNKNOWN, value: 3 },
    ]));
    const stats = intake.getModuleStats().find(s => s.module_id === MODULE_ID)!;
    expect(stats.tags_in_last_packet).toBe(3);
  });

  it('watchdogTick sets watchdogLatched (stalled indicator)', () => {
    const intake = makeIntake(new LkvCache(), new DbPipeline(), 0);
    intake.watchdogTick();
    const stats = intake.getModuleStats().find(s => s.module_id === MODULE_ID)!;
    expect(stats.stalled).toBe(true);
  });

  it('ingest does NOT clear stalled status (watchdog is latching)', () => {
    const intake = makeIntake(new LkvCache(), new DbPipeline(), 0);
    intake.watchdogTick();
    intake.ingest(MODULE_ID, telemetryMsg([{ tag_id: TAG_MONITOR, value: 1 }]));
    const stats = intake.getModuleStats().find(s => s.module_id === MODULE_ID)!;
    expect(stats.stalled).toBe(true);
  });

  it('resetAllWatchdogs() clears stalled status', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(3000);
      const intake = makeIntake(new LkvCache(), new DbPipeline(), 2000);
      intake.watchdogTick(); // 3000 - 0 = 3000 > 2000 → trips
      expect(intake.getModuleStats().find(s => s.module_id === MODULE_ID)!.stalled).toBe(true);
      intake.ingest(MODULE_ID, telemetryMsg([{ tag_id: TAG_MONITOR, value: 1 }])); // lastSeen = 3000
      intake.resetAllWatchdogs(); // 3000 - 3000 = 0 ≤ 2000 → clears
      expect(intake.getModuleStats().find(s => s.module_id === MODULE_ID)!.stalled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resetWatchdog(moduleId) clears only that module', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(3000);
      const MODULE_B = 'modB';
      const twoModules = new Map<string, number[]>([
        [MODULE_ID, [TAG_MONITOR]],
        [MODULE_B,  [TAG_TREND]],
      ]);
      const intake = new TelemetryIntake({
        lkv: new LkvCache(),
        tagMap,
        moduleTagIds: twoModules,
        trendableTagIds,
        dbPipeline: new DbPipeline(),
        watchdogTimeoutMs: 2000,
        dutyTracker: new DutyTracker(),
      });

      intake.watchdogTick(); // both modules time out: 3000 - 0 = 3000 > 2000
      expect(intake.getModuleStats().find(s => s.module_id === MODULE_ID)!.stalled).toBe(true);
      expect(intake.getModuleStats().find(s => s.module_id === MODULE_B)!.stalled).toBe(true);

      intake.ingest(MODULE_ID, telemetryMsg([{ tag_id: TAG_MONITOR, value: 1 }])); // lastSeen=3000 for MODULE_ID only
      intake.resetWatchdog(MODULE_ID); // 3000 - 3000 = 0 ≤ 2000 → clears MODULE_ID
      expect(intake.getModuleStats().find(s => s.module_id === MODULE_ID)!.stalled).toBe(false);
      expect(intake.getModuleStats().find(s => s.module_id === MODULE_B)!.stalled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resetAllWatchdogs does not clear modules with stale lastSeen', () => {
    const intake = makeIntake(new LkvCache(), new DbPipeline(), 0);
    intake.watchdogTick(); // lastSeen=0, Date.now()-0 >> 0 → trips
    intake.resetAllWatchdogs(); // Date.now()-0 >> 0 → stale → stays latched
    expect(intake.getModuleStats().find(s => s.module_id === MODULE_ID)!.stalled).toBe(true);
  });

  it('resetAllWatchdogs clears modules with fresh lastSeen', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(3000);
      const intake = makeIntake(new LkvCache(), new DbPipeline(), 2000);
      intake.watchdogTick(); // trips: 3000 - 0 = 3000 > 2000
      intake.ingest(MODULE_ID, telemetryMsg([{ tag_id: TAG_MONITOR, value: 1 }])); // lastSeen=3000, latch stays
      expect(intake.getModuleStats().find(s => s.module_id === MODULE_ID)!.stalled).toBe(true);
      intake.resetAllWatchdogs(); // 3000 - 3000 = 0 ≤ 2000 → clears
      expect(intake.getModuleStats().find(s => s.module_id === MODULE_ID)!.stalled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resetWatchdog(moduleId) only clears if lastSeen is fresh', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(3000);
      const intake = makeIntake(new LkvCache(), new DbPipeline(), 2000);
      intake.watchdogTick(); // trips: 3000 - 0 = 3000 > 2000

      // stale lastSeen — reset should not clear
      intake.resetWatchdog(MODULE_ID);
      expect(intake.getModuleStats().find(s => s.module_id === MODULE_ID)!.stalled).toBe(true);

      // fresh lastSeen — reset should clear
      intake.ingest(MODULE_ID, telemetryMsg([{ tag_id: TAG_MONITOR, value: 1 }]));
      intake.resetWatchdog(MODULE_ID);
      expect(intake.getModuleStats().find(s => s.module_id === MODULE_ID)!.stalled).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('watchdogTick sets moduleStatus to STALLED on timeout', () => {
    const intake = makeIntake(new LkvCache(), new DbPipeline(), 0);
    intake.watchdogTick();
    expect(intake.getModuleStats().find(s => s.module_id === MODULE_ID)!.status).toBe('STALLED');
  });

  it('ingest updates moduleStatus even while watchdog is latched', () => {
    const intake = makeIntake(new LkvCache(), new DbPipeline(), 0);
    intake.watchdogTick();
    expect(intake.getModuleStats().find(s => s.module_id === MODULE_ID)!.status).toBe('STALLED');
    intake.ingest(MODULE_ID, telemetryMsg([], 'ONLINE'));
    expect(intake.getModuleStats().find(s => s.module_id === MODULE_ID)!.status).toBe('ONLINE');
  });

  it('watchdogTick auto-clears real-time stall when comms resume', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(3000);
      const intake = makeIntake(new LkvCache(), new DbPipeline(), 1000);
      intake.watchdogTick(); // trips: 3000 - 0 = 3000 > 1000
      expect(intake.getModuleStats().find(s => s.module_id === MODULE_ID)!.status).toBe('STALLED');

      // comms resume — ingest at T=3000
      intake.ingest(MODULE_ID, telemetryMsg([{ tag_id: TAG_MONITOR, value: 1 }], 'ONLINE'));
      expect(intake.getModuleStats().find(s => s.module_id === MODULE_ID)!.status).toBe('ONLINE');

      // tick within timeout (T=3500, 3500 - 3000 = 500 ≤ 1000) — auto-clears timedOutModules
      vi.setSystemTime(3500);
      intake.watchdogTick(); // not timed out → timedOutModules.delete()
      // STATUS stays live (timedOutModules cleared, no re-STALLED)
      expect(intake.getModuleStats().find(s => s.module_id === MODULE_ID)!.status).toBe('ONLINE');
      // watchdogLatched still set — dot remains red until manual reset
      expect(intake.getModuleStats().find(s => s.module_id === MODULE_ID)!.stalled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('LKV re-nulls on second comms loss after comms resumed', () => {
    vi.useFakeTimers();
    try {
      const lkv = new LkvCache();
      lkv.set(TAG_MONITOR, 100);
      lkv.set(TAG_TREND, 200);
      vi.setSystemTime(3000);
      const intake = makeIntake(lkv, new DbPipeline(), 1000);

      // First trip — LKV nulled
      intake.watchdogTick();
      expect(lkv.getValue(TAG_MONITOR)).toBeNull();

      // Comms resume — ingest + tick within timeout (auto-clears timedOutModules)
      intake.ingest(MODULE_ID, telemetryMsg([{ tag_id: TAG_MONITOR, value: 50 }], 'ONLINE')); // lastSeen=3000
      vi.setSystemTime(3500); // 3500 - 3000 = 500 ≤ 1000 → not timed out
      intake.watchdogTick(); // auto-clears timedOutModules
      expect(lkv.getValue(TAG_MONITOR)).toBe(50);

      // Comms stop again — advance past timeout, tick re-nulls LKV
      vi.setSystemTime(5000); // 5000 - 3000 = 2000 > 1000
      const genBefore = lkv.getGeneration(TAG_MONITOR);
      intake.watchdogTick(); // not in timedOutModules → re-trips → nulls LKV
      expect(lkv.getValue(TAG_MONITOR)).toBeNull();
      expect(lkv.getGeneration(TAG_MONITOR)).toBeGreaterThan(genBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it('STATUS shows STALLED on second comms loss after auto-clear', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(3000);
      const intake = makeIntake(new LkvCache(), new DbPipeline(), 1000);
      intake.watchdogTick(); // first trip, STALLED

      // comms resume — ingest + tick within timeout (auto-clears timedOutModules)
      intake.ingest(MODULE_ID, telemetryMsg([{ tag_id: TAG_MONITOR, value: 1 }], 'ONLINE'));
      vi.setSystemTime(3500); // 3500 - 3000 = 500 ≤ 1000
      intake.watchdogTick(); // auto-clears timedOutModules, status stays ONLINE
      expect(intake.getModuleStats().find(s => s.module_id === MODULE_ID)!.status).toBe('ONLINE');

      // comms stop again — advance past timeout, tick re-trips
      vi.setSystemTime(5000); // 5000 - 3000 = 2000 > 1000
      intake.watchdogTick(); // not in timedOutModules → re-trips → STALLED
      expect(intake.getModuleStats().find(s => s.module_id === MODULE_ID)!.status).toBe('STALLED');
    } finally {
      vi.useRealTimers();
    }
  });

  it('packets_per_sec and bytes_per_sec are 0 before rate timer fires', () => {
    const intake = makeIntake();
    intake.ingest(MODULE_ID, telemetryMsg([{ tag_id: TAG_MONITOR, value: 1 }]));
    intake.ingest(MODULE_ID, telemetryMsg([{ tag_id: TAG_MONITOR, value: 2 }]));
    const stats = intake.getModuleStats().find(s => s.module_id === MODULE_ID)!;
    expect(stats.packets_per_sec).toBe(0);
    expect(stats.bytes_per_sec).toBe(0);
  });

  it('rate timer computes packets_per_sec and bytes_per_sec', () => {
    vi.useFakeTimers();
    try {
      const intake = makeIntake();
      intake.startRateTimer();
      for (let i = 0; i < 5; i++) {
        intake.ingest(MODULE_ID, telemetryMsg([{ tag_id: TAG_MONITOR, value: i }]));
      }
      vi.advanceTimersByTime(1000);
      const stats = intake.getModuleStats().find(s => s.module_id === MODULE_ID)!;
      expect(stats.packets_per_sec).toBe(5);
      expect(stats.bytes_per_sec).toBeGreaterThan(0);
      intake.stopRateTimer();
    } finally {
      vi.useRealTimers();
    }
  });

  it('status is UNKNOWN before any ingest', () => {
    const intake = makeIntake();
    const stats = intake.getModuleStats().find(s => s.module_id === MODULE_ID)!;
    expect(stats.status).toBe('UNKNOWN');
  });

  it('status reflects last ingested message status', () => {
    const intake = makeIntake();
    intake.ingest(MODULE_ID, telemetryMsg([], 'ONLINE'));
    expect(intake.getModuleStats().find(s => s.module_id === MODULE_ID)!.status).toBe('ONLINE');
    intake.ingest(MODULE_ID, telemetryMsg([], 'FAULT'));
    expect(intake.getModuleStats().find(s => s.module_id === MODULE_ID)!.status).toBe('FAULT');
  });

  it('FAULT packets are counted in rate stats', () => {
    vi.useFakeTimers();
    try {
      const intake = makeIntake();
      intake.startRateTimer();
      for (let i = 0; i < 3; i++) {
        intake.ingest(MODULE_ID, telemetryMsg([], 'FAULT'));
      }
      vi.advanceTimersByTime(1000);
      const stats = intake.getModuleStats().find(s => s.module_id === MODULE_ID)!;
      expect(stats.packets_per_sec).toBe(3);
      expect(stats.bytes_per_sec).toBeGreaterThan(0);
      intake.stopRateTimer();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── Watchdog stall sentinel ───────────────────────────────────────────────────

describe('TelemetryIntake — watchdog stall sentinel', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('enqueues null sentinel on watchdog stall transition — 3 trending tags', () => {
    const TAG_T1 = 10, TAG_T2 = 11, TAG_T3 = 12;
    const localTagMap = new Map<number, TagDef>([
      [TAG_T1, makeTagDef(TAG_T1)],
      [TAG_T2, makeTagDef(TAG_T2)],
      [TAG_T3, makeTagDef(TAG_T3)],
    ]);
    const localModuleTagIds = new Map<string, number[]>([[MODULE_ID, [TAG_T1, TAG_T2, TAG_T3]]]);
    const localTrendable    = new Set<number>([TAG_T1, TAG_T2, TAG_T3]);
    const dbPipeline        = new DbPipeline();
    const enqueueSpy        = vi.spyOn(dbPipeline, 'enqueue');

    const intake = new TelemetryIntake({
      lkv: new LkvCache(),
      tagMap: localTagMap,
      moduleTagIds: localModuleTagIds,
      trendableTagIds: localTrendable,
      dbPipeline,
      watchdogTimeoutMs: 0,
      dutyTracker: new DutyTracker(),
    });

    intake.watchdogTick();

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const entry = enqueueSpy.mock.calls[0][0];
    expect(entry.tags).toHaveLength(3);
    expect(entry.tags.every((t: { value: unknown }) => t.value === null)).toBe(true);
    expect(entry.tags.map((t: { tagId: number }) => t.tagId).sort((a: number, b: number) => a - b))
      .toEqual([TAG_T1, TAG_T2, TAG_T3].sort((a, b) => a - b));
  });

  it('does not re-enqueue sentinel on subsequent watchdog ticks while stalled', () => {
    const dbPipeline = new DbPipeline();
    const enqueueSpy = vi.spyOn(dbPipeline, 'enqueue');
    const intake     = makeIntake(new LkvCache(), dbPipeline, 0);

    intake.watchdogTick();
    intake.watchdogTick();

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
  });

  it('does not enqueue sentinel on recovery — only the real frame value', () => {
    const dbPipeline = new DbPipeline();
    const enqueueSpy = vi.spyOn(dbPipeline, 'enqueue');
    const intake     = makeIntake(new LkvCache(), dbPipeline, 0);

    // First tick: stall transition → sentinel enqueued
    intake.watchdogTick();
    expect(enqueueSpy).toHaveBeenCalledTimes(1);

    // Recovery: real telemetry frame — COV enqueues the real value
    intake.ingest(MODULE_ID, telemetryMsg([{ tag_id: TAG_TREND, value: 55 }]));
    // Subsequent watchdog tick: comms fresh or still stale but already in timedOutModules
    // — either way, no new sentinel is emitted
    intake.watchdogTick();

    // 1 sentinel + 1 real value, nothing more
    expect(enqueueSpy).toHaveBeenCalledTimes(2);
    const secondCall = enqueueSpy.mock.calls[1][0];
    expect(secondCall.tags[0].value).not.toBeNull();
  });

  it('skips null sentinel and logs warn when module is not in registry', () => {
    const dbPipeline = new DbPipeline();
    const enqueueSpy = vi.spyOn(dbPipeline, 'enqueue');
    const warnSpy    = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const intake     = makeIntake(new LkvCache(), dbPipeline, 0);

    // Call the private method directly with a key absent from moduleTagIds
    (intake as unknown as { enqueueWatchdogStallSentinel(k: string): void })
      .enqueueWatchdogStallSentinel('unknown_module');

    expect(enqueueSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('filters non-trending tags from sentinel — 3 trending out of 5', () => {
    const TAG_T1 = 20, TAG_T2 = 21, TAG_T3 = 22, TAG_NT1 = 23, TAG_NT2 = 24;
    const localTagMap = new Map<number, TagDef>([
      [TAG_T1,  makeTagDef(TAG_T1)],
      [TAG_T2,  makeTagDef(TAG_T2)],
      [TAG_T3,  makeTagDef(TAG_T3)],
      [TAG_NT1, makeTagDef(TAG_NT1)],
      [TAG_NT2, makeTagDef(TAG_NT2)],
    ]);
    const localModuleTagIds = new Map<string, number[]>([
      [MODULE_ID, [TAG_T1, TAG_T2, TAG_T3, TAG_NT1, TAG_NT2]],
    ]);
    const localTrendable = new Set<number>([TAG_T1, TAG_T2, TAG_T3]);
    const dbPipeline     = new DbPipeline();
    const enqueueSpy     = vi.spyOn(dbPipeline, 'enqueue');

    const intake = new TelemetryIntake({
      lkv: new LkvCache(),
      tagMap: localTagMap,
      moduleTagIds: localModuleTagIds,
      trendableTagIds: localTrendable,
      dbPipeline,
      watchdogTimeoutMs: 0,
      dutyTracker: new DutyTracker(),
    });

    intake.watchdogTick();

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const entry = enqueueSpy.mock.calls[0][0];
    expect(entry.tags).toHaveLength(3);
    const sentinelIds = entry.tags
      .map((t: { tagId: number }) => t.tagId)
      .sort((a: number, b: number) => a - b);
    expect(sentinelIds).toEqual([TAG_T1, TAG_T2, TAG_T3].sort((a, b) => a - b));
  });
});

// ── FAULT message with tag data ───────────────────────────────────────────────

describe('TelemetryIntake — FAULT message with tag data', () => {
  it('FAULT message with tag data enqueues the real values, not null', () => {
    const lkv        = new LkvCache();
    lkv.set(TAG_TREND, 99);
    const dbPipeline = new DbPipeline();
    const enqueueSpy = vi.spyOn(dbPipeline, 'enqueue');
    const intake     = makeIntake(lkv, dbPipeline);

    intake.ingest(MODULE_ID, telemetryMsg([{ tag_id: TAG_TREND, value: 42 }], 'FAULT', 1000));

    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    const entry = enqueueSpy.mock.calls[0][0];
    expect(entry.tags).toHaveLength(1);
    expect(entry.tags[0].tagId).toBe(TAG_TREND);
    expect(entry.tags[0].value).toBe(42);
    expect(intake.getModuleStats().find(s => s.module_id === MODULE_ID)!.status).toBe('FAULT');
  });

  it('FAULT message without tag data does not enqueue', () => {
    const dbPipeline = new DbPipeline();
    const enqueueSpy = vi.spyOn(dbPipeline, 'enqueue');
    const intake     = makeIntake(new LkvCache(), dbPipeline);

    intake.ingest(MODULE_ID, telemetryMsg([], 'FAULT'));

    expect(enqueueSpy).not.toHaveBeenCalled();
  });
});
