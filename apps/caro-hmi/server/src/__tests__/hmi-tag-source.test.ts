import { describe, it, expect, vi, afterEach } from 'vitest';
import { HmiTagSource } from '../hmi-tag-source.js';
import type { TimescaleSizeMonitor } from '../timescale-size-monitor.js';
import { TelemetryIntake } from '../telemetry-intake.js';
import { LkvCache } from '../lkv.js';
import { DbPipeline } from '../db-pipeline.js';
import { DutyTracker } from '../duty-tracker.js';
import { ModuleStatus } from '@caro/tag-registry-shared';
import type { ActiveTag } from '@caro/db';
import type { TagDef } from '@caro/hmi-context';
import type { ModuleStats } from '../telemetry-intake.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const HMI_PUBLISH_INTERVAL_MS = 250;

function makeActiveTag(
  tag_id: number,
  tag_path: string,
  module = 'HMI',
  overrides: Partial<ActiveTag> = {},
): ActiveTag {
  return {
    tag_id,
    registry_rev: 1,
    tag_path,
    module,
    module_type: 'HMI',
    data_type:   'i16',
    is_setpoint: false,
    trends:      false,
    unit:        null,
    format:      null,
    eng_min:     null,
    eng_max:     null,
    tag_name:    null,
    retired:     false,
    meta:        {},
    ...overrides,
  } as ActiveTag;
}

function makeTagDef(tag_id: number, module_id = 'HMI'): TagDef {
  return {
    tag_id,
    tag_path:    `CARO_1.${module_id}.tag${tag_id}`,
    tag_name:    null,
    data_type:   'i16',
    is_setpoint: false,
    module_id,
    module_type: 'HMI',
    eng_min:     null,
    eng_max:     null,
    unit:        null,
    format:      null,
    meta:        [],
  };
}

/** Build a TelemetryIntake wired to a given LkvCache for the provided tag_ids. */
function makeIntake(tagIds: number[], lkv = new LkvCache(), moduleId = 'HMI') {
  const tagMap       = new Map<number, TagDef>(tagIds.map(id => [id, makeTagDef(id, moduleId)]));
  const moduleTagIds = new Map<string, number[]>([[moduleId, tagIds]]);
  const intake = new TelemetryIntake({
    lkv,
    tagMap,
    moduleTagIds,
    trendableTagIds: new Set(),
    dbPipeline: new DbPipeline(),
    watchdogTimeoutMs: 5000,
    dutyTracker: new DutyTracker(),
  });
  return { lkv, intake };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('HmiTagSource', () => {
  it('property set updates internal value and get retrieves it', () => {
    const { intake } = makeIntake([1066]);
    const hmiTags = HmiTagSource.create(
      [makeActiveTag(1066, 'CARO_1.HMI.Module_Count')],
      { intake, hmiPublishIntervalMs: HMI_PUBLISH_INTERVAL_MS, dutyTracker: new DutyTracker() },
    );

    hmiTags.Module_Count = 11;
    expect(hmiTags.Module_Count).toBe(11);
  });

  it('unknown property throws on set', () => {
    const { intake } = makeIntake([1066]);
    const hmiTags = HmiTagSource.create(
      [makeActiveTag(1066, 'CARO_1.HMI.Module_Count')],
      { intake, hmiPublishIntervalMs: HMI_PUBLISH_INTERVAL_MS, dutyTracker: new DutyTracker() },
    );

    expect(() => { (hmiTags as Record<string, unknown>).Nonexistent = 5; })
      .toThrow('unknown property');
  });

  it('unknown property returns undefined on get', () => {
    const { intake } = makeIntake([1066]);
    const hmiTags = HmiTagSource.create(
      [makeActiveTag(1066, 'CARO_1.HMI.Module_Count')],
      { intake, hmiPublishIntervalMs: HMI_PUBLISH_INTERVAL_MS, dutyTracker: new DutyTracker() },
    );

    expect((hmiTags as Record<string, unknown>).Nonexistent).toBeUndefined();
  });

  it('publish tick calls intake.ingest with correct TelemetryMessage shape', () => {
    vi.useFakeTimers();
    try {
      const lkv = new LkvCache();
      const { intake } = makeIntake([1066, 1067], lkv);
      const hmiTags = HmiTagSource.create(
        [
          makeActiveTag(1066, 'CARO_1.HMI.Module_Count'),
          makeActiveTag(1067, 'CARO_1.HMI.Status'),
        ],
        { intake, hmiPublishIntervalMs: HMI_PUBLISH_INTERVAL_MS, dutyTracker: new DutyTracker() },
      );

      hmiTags.Module_Count = 11;
      hmiTags.Status = 1;
      hmiTags.startPublishing();

      vi.advanceTimersByTime(HMI_PUBLISH_INTERVAL_MS);

      expect(lkv.getValue(1066)).toBe(11);
      expect(lkv.getValue(1067)).toBe(1);

      hmiTags.stopPublishing();
    } finally {
      vi.useRealTimers();
    }
  });

  it('publish tick does nothing with zero HMI tags', () => {
    vi.useFakeTimers();
    try {
      const lkv = new LkvCache();
      const { intake } = makeIntake([], lkv);
      const hmiTags = HmiTagSource.create(
        [],
        { intake, hmiPublishIntervalMs: HMI_PUBLISH_INTERVAL_MS, dutyTracker: new DutyTracker() },
      );

      hmiTags.startPublishing();
      vi.advanceTimersByTime(HMI_PUBLISH_INTERVAL_MS * 5);

      expect(lkv.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('property name derived correctly — strips module segment and joins with underscore', () => {
    const { intake } = makeIntake([2001], new LkvCache(), 'MyHMI');
    const hmiTags = HmiTagSource.create(
      [makeActiveTag(2001, 'Plant1.MyHMI.Status.Active', 'MyHMI')],
      { intake, hmiPublishIntervalMs: HMI_PUBLISH_INTERVAL_MS, dutyTracker: new DutyTracker() },
    );

    (hmiTags as Record<string, unknown>).Status_Active = 'OK';
    expect((hmiTags as Record<string, unknown>).Status_Active).toBe('OK');
  });

  it('duplicate property name throws at init', () => {
    const { intake } = makeIntake([1066, 1067]);

    expect(() =>
      HmiTagSource.create(
        [
          makeActiveTag(1066, 'CARO_1.HMI.Module_Count'),
          makeActiveTag(1067, 'CARO_1.HMI.Module_Count'), // same resolved property name
        ],
        { intake, hmiPublishIntervalMs: HMI_PUBLISH_INTERVAL_MS, dutyTracker: new DutyTracker() },
      )
    ).toThrow('collision');
  });

  it('reset() increments Reset_Count tag on each call', () => {
    const { intake } = makeIntake([1066, 1099]);
    const hmiTags = HmiTagSource.create(
      [
        makeActiveTag(1066, 'CARO_1.HMI.Module_Count'),
        makeActiveTag(1099, 'CARO_1.HMI.Reset_Count'),
      ],
      { intake, hmiPublishIntervalMs: HMI_PUBLISH_INTERVAL_MS, dutyTracker: new DutyTracker() },
    );

    hmiTags.reset();
    expect((hmiTags as Record<string, unknown>).Reset_Count).toBe(1);

    hmiTags.reset();
    expect((hmiTags as Record<string, unknown>).Reset_Count).toBe(2);
  });

  it('class methods (startPublishing, stopPublishing) accessible through proxy', () => {
    const { intake } = makeIntake([1066]);
    const hmiTags = HmiTagSource.create(
      [makeActiveTag(1066, 'CARO_1.HMI.Module_Count')],
      { intake, hmiPublishIntervalMs: HMI_PUBLISH_INTERVAL_MS, dutyTracker: new DutyTracker() },
    );

    expect(typeof hmiTags.startPublishing).toBe('function');
    expect(typeof hmiTags.stopPublishing).toBe('function');
  });
});

// ── Module_Info array emission tests ─────────────────────────────────────────

// Tag IDs: 200–204 = the five Module_Info array tags (HMI module_type).
// Tags 1–N = non-HMI module tags used only for module ordering.

const MI_TAG_IDS = {
  DATA_RATE:    200,
  PKG_RATE:     201,
  STATUS:       202,
  TAGS_PER_PKG: 203,
  WATCHDOG:     204,
};

function makeModuleInfoTags(): ActiveTag[] {
  return [
    makeActiveTag(MI_TAG_IDS.DATA_RATE,    'CARO_1.HMI.Module_Info.Data_Rate',    'HMI', { data_type: 'f32[]' }),
    makeActiveTag(MI_TAG_IDS.PKG_RATE,     'CARO_1.HMI.Module_Info.Pkg_Rate',     'HMI', { data_type: 'f32[]' }),
    makeActiveTag(MI_TAG_IDS.STATUS,       'CARO_1.HMI.Module_Info.Status',       'HMI', { data_type: 'i16[]' }),
    makeActiveTag(MI_TAG_IDS.TAGS_PER_PKG, 'CARO_1.HMI.Module_Info.Tags_Per_Pkg', 'HMI', { data_type: 'i16[]' }),
    makeActiveTag(MI_TAG_IDS.WATCHDOG,     'CARO_1.HMI.Module_Info.Watchdog',     'HMI', { data_type: 'i16[]' }),
  ];
}

/** Make a non-HMI active tag for module ordering purposes. */
function makeModuleTag(tag_id: number, moduleId: string): ActiveTag {
  return makeActiveTag(tag_id, `CARO_1.${moduleId}.SomeTag`, moduleId, { module_type: 'MQTT' });
}

function makeModuleStats(module_id: string, overrides: Partial<ModuleStats> = {}): ModuleStats {
  return {
    module_id,
    status: 'OK',
    packets_per_sec: 0,
    bytes_per_sec: 0,
    tags_in_last_packet: 0,
    stalled: false,
    last_seen_ms: Date.now(),
    ...overrides,
  };
}

/** Build HmiTagSource with Module_Info tags + N MQTT modules for ordering. */
function makeModuleInfoSource(
  moduleIds: string[],
  statsReturnValue: ModuleStats[],
): { hmiTags: HmiTagSource & Record<string, number | boolean | string | number[]>; lkv: LkvCache } {
  const lkv = new LkvCache();
  const hmiTagIds = Object.values(MI_TAG_IDS);

  // Module tags are non-HMI — only used for ordering by getModuleNames.
  // Assign tag_ids 1..N so ordering is deterministic (same as moduleIds array order).
  const moduleTags = moduleIds.map((id, i) => makeModuleTag(i + 1, id));
  const allTags    = [...moduleTags, ...makeModuleInfoTags()];

  const intake = {
    getModuleStats: vi.fn().mockReturnValue(statsReturnValue),
    ingest: vi.fn().mockImplementation((moduleId: string, message: { tags: { tag_id: number; value: unknown }[] }) => {
      for (const { tag_id, value } of message.tags) {
        if (hmiTagIds.includes(tag_id)) {
          lkv.set(tag_id, value as number | number[] | null);
        }
      }
    }),
  } as unknown as TelemetryIntake;

  const hmiTags = HmiTagSource.create(allTags, {
    intake,
    hmiPublishIntervalMs: HMI_PUBLISH_INTERVAL_MS,
    dutyTracker: new DutyTracker(),
  });

  return { hmiTags, lkv };
}

describe('HmiTagSource — Module_Info array emission', () => {
  it('arrays have correct length matching the number of modules (MQTT + HMI)', () => {
    // 3 MQTT modules + 1 HMI module (from makeModuleInfoTags) = 4 total
    const moduleIds = ['M1', 'M2', 'M3'];
    const stats = moduleIds.map(id => makeModuleStats(id));
    const { hmiTags, lkv } = makeModuleInfoSource(moduleIds, stats);

    hmiTags.publishNow();

    expect((lkv.getValue(MI_TAG_IDS.DATA_RATE)    as number[]).length).toBe(4);
    expect((lkv.getValue(MI_TAG_IDS.PKG_RATE)     as number[]).length).toBe(4);
    expect((lkv.getValue(MI_TAG_IDS.STATUS)       as number[]).length).toBe(4);
    expect((lkv.getValue(MI_TAG_IDS.TAGS_PER_PKG) as number[]).length).toBe(4);
  });

  it('per-module values are correct for a known stats input', () => {
    const moduleIds = ['A', 'B', 'C'];
    const stats = [
      makeModuleStats('A', { bytes_per_sec: 2048, packets_per_sec: 10, tags_in_last_packet: 5, status: 'OK' }),
      makeModuleStats('B', { bytes_per_sec: 512,  packets_per_sec: 3,  tags_in_last_packet: 2, status: 'WARNING' }),
      makeModuleStats('C', { bytes_per_sec: 0,    packets_per_sec: 0,  tags_in_last_packet: 0, status: 'FAULT' }),
    ];
    const { hmiTags, lkv } = makeModuleInfoSource(moduleIds, stats);

    hmiTags.publishNow();

    const dataRate   = lkv.getValue(MI_TAG_IDS.DATA_RATE)    as number[];
    const pkgRate    = lkv.getValue(MI_TAG_IDS.PKG_RATE)     as number[];
    const status     = lkv.getValue(MI_TAG_IDS.STATUS)       as number[];
    const tagsPerPkg = lkv.getValue(MI_TAG_IDS.TAGS_PER_PKG) as number[];

    // Module A (index 0)
    expect(dataRate[0]).toBeCloseTo(2.0);       // 2048 bytes / 1024 = 2 KB/s
    expect(pkgRate[0]).toBe(10);
    expect(tagsPerPkg[0]).toBe(5);
    expect(status[0]).toBe(ModuleStatus.OK);

    // Module B (index 1)
    expect(dataRate[1]).toBeCloseTo(0.5);       // 512 / 1024
    expect(pkgRate[1]).toBe(3);
    expect(tagsPerPkg[1]).toBe(2);
    expect(status[1]).toBe(ModuleStatus.WARNING);

    // Module C (index 2)
    expect(dataRate[2]).toBe(0);
    expect(status[2]).toBe(ModuleStatus.FAULT);
  });

  it('missing module (not in stats) produces zeros and UNKNOWN status', () => {
    const moduleIds = ['A', 'B'];
    // Only A is in stats — B is missing
    const stats = [makeModuleStats('A', { bytes_per_sec: 1024, packets_per_sec: 2, tags_in_last_packet: 3 })];
    const { hmiTags, lkv } = makeModuleInfoSource(moduleIds, stats);

    hmiTags.publishNow();

    const dataRate = lkv.getValue(MI_TAG_IDS.DATA_RATE)    as number[];
    const status   = lkv.getValue(MI_TAG_IDS.STATUS)       as number[];

    expect(dataRate[1]).toBe(0);
    expect(status[1]).toBe(ModuleStatus.UNKNOWN);
  });

  it('zero MQTT modules → 1 HMI module in arrays (watchdog length 1)', () => {
    // No MQTT modules, but HMI itself is always included via makeModuleInfoTags
    const { hmiTags, lkv } = makeModuleInfoSource([], []);

    hmiTags.publishNow();

    // HMI module is included, so arrays have length 1
    expect((lkv.getValue(MI_TAG_IDS.DATA_RATE) as number[]).length).toBe(1);
    expect((lkv.getValue(MI_TAG_IDS.WATCHDOG)  as number[]).length).toBe(1);
  });
});

describe('HmiTagSource — watchdog bit packing', () => {
  it('stalled module at index 0 sets bit 0 in word 0', () => {
    const moduleIds = ['M0', 'M1', 'M2'];
    const stats = [
      makeModuleStats('M0', { stalled: true }),
      makeModuleStats('M1'),
      makeModuleStats('M2'),
    ];
    const { hmiTags, lkv } = makeModuleInfoSource(moduleIds, stats);

    hmiTags.publishNow();

    const watchdog = lkv.getValue(MI_TAG_IDS.WATCHDOG) as number[];
    expect(watchdog[0] & 1).toBe(1); // bit 0
  });

  it('stalled at index 7 → bit 7 set in word 0', () => {
    const moduleIds = Array.from({ length: 8 }, (_, i) => `M${i}`);
    const stats = moduleIds.map((id, i) => makeModuleStats(id, { stalled: i === 7 }));
    const { hmiTags, lkv } = makeModuleInfoSource(moduleIds, stats);

    hmiTags.publishNow();

    const watchdog = lkv.getValue(MI_TAG_IDS.WATCHDOG) as number[];
    expect(watchdog[0] & (1 << 7)).toBe(1 << 7);
  });

  it('stalled at index 15 → bit 15 set in word 0', () => {
    const moduleIds = Array.from({ length: 16 }, (_, i) => `M${i}`);
    const stats = moduleIds.map((id, i) => makeModuleStats(id, { stalled: i === 15 }));
    const { hmiTags, lkv } = makeModuleInfoSource(moduleIds, stats);

    hmiTags.publishNow();

    const watchdog = lkv.getValue(MI_TAG_IDS.WATCHDOG) as number[];
    expect(watchdog[0] & (1 << 15)).toBe(1 << 15);
  });

  it('stalled at index 16 → bit 0 set in word 1 (rolls to second word)', () => {
    const moduleIds = Array.from({ length: 17 }, (_, i) => `M${i}`);
    const stats = moduleIds.map((id, i) => makeModuleStats(id, { stalled: i === 16 }));
    const { hmiTags, lkv } = makeModuleInfoSource(moduleIds, stats);

    hmiTags.publishNow();

    const watchdog = lkv.getValue(MI_TAG_IDS.WATCHDOG) as number[];
    expect(watchdog.length).toBe(2);
    expect(watchdog[1] & 1).toBe(1); // bit 0 of word 1
    expect(watchdog[0]).toBe(0);     // word 0 unset
  });

  it('stalled at index 31 → bit 15 set in word 1 (32 MQTT + HMI = 33 modules, 3 words)', () => {
    const moduleIds = Array.from({ length: 32 }, (_, i) => `M${i}`);
    const stats = moduleIds.map((id, i) => makeModuleStats(id, { stalled: i === 31 }));
    const { hmiTags, lkv } = makeModuleInfoSource(moduleIds, stats);

    hmiTags.publishNow();

    const watchdog = lkv.getValue(MI_TAG_IDS.WATCHDOG) as number[];
    // 32 MQTT + 1 HMI = 33 modules → ceil(33/16) = 3 words
    expect(watchdog.length).toBe(3);
    expect(watchdog[1] & (1 << 15)).toBe(1 << 15);
  });

  it('20 modules → watchdog.length === 2', () => {
    const moduleIds = Array.from({ length: 20 }, (_, i) => `M${i}`);
    const stats = moduleIds.map(id => makeModuleStats(id));
    const { hmiTags, lkv } = makeModuleInfoSource(moduleIds, stats);

    hmiTags.publishNow();

    const watchdog = lkv.getValue(MI_TAG_IDS.WATCHDOG) as number[];
    expect(watchdog.length).toBe(2);
  });

  it('indices 0, 7, 15, 16, 31 stalled → correct bits in both words', () => {
    const moduleIds = Array.from({ length: 32 }, (_, i) => `M${i}`);
    const stalledIdx = new Set([0, 7, 15, 16, 31]);
    const stats = moduleIds.map((id, i) => makeModuleStats(id, { stalled: stalledIdx.has(i) }));
    const { hmiTags, lkv } = makeModuleInfoSource(moduleIds, stats);

    hmiTags.publishNow();

    const watchdog = lkv.getValue(MI_TAG_IDS.WATCHDOG) as number[];
    const expectedWord0 = (1 << 0) | (1 << 7) | (1 << 15);
    const expectedWord1 = (1 << 0) | (1 << 15); // indices 16 and 31 → bits 0 and 15 in word 1
    expect(watchdog[0]).toBe(expectedWord0);
    expect(watchdog[1]).toBe(expectedWord1);
  });
});

describe('HmiTagSource — status string mapping', () => {
  function statusFor(statusStr: string | undefined): number {
    const moduleIds = ['M1'];
    const stats = statusStr !== undefined
      ? [makeModuleStats('M1', { status: statusStr })]
      : [];
    const { hmiTags, lkv } = makeModuleInfoSource(moduleIds, stats);
    hmiTags.publishNow();
    return (lkv.getValue(MI_TAG_IDS.STATUS) as number[])[0];
  }

  it('"OK" → ModuleStatus.OK',      () => expect(statusFor('OK')).toBe(ModuleStatus.OK));
  it('"ONLINE" → ModuleStatus.OK',  () => expect(statusFor('ONLINE')).toBe(ModuleStatus.OK));
  it('"WARNING" → ModuleStatus.WARNING', () => expect(statusFor('WARNING')).toBe(ModuleStatus.WARNING));
  it('"FAULT" → ModuleStatus.FAULT',     () => expect(statusFor('FAULT')).toBe(ModuleStatus.FAULT));
  it('"STALLED" → ModuleStatus.STALLED', () => expect(statusFor('STALLED')).toBe(ModuleStatus.STALLED));
  it('unknown string → UNKNOWN',         () => expect(statusFor('GARBAGE')).toBe(ModuleStatus.UNKNOWN));
  it('undefined (missing module) → UNKNOWN', () => {
    // Module is in moduleIds but NOT in stats, so s is undefined in the loop
    const moduleIds = ['M1'];
    const { hmiTags, lkv } = makeModuleInfoSource(moduleIds, []); // empty stats
    hmiTags.publishNow();
    const status = lkv.getValue(MI_TAG_IDS.STATUS) as number[];
    expect(status[0]).toBe(ModuleStatus.UNKNOWN);
  });
});

// ── Trend_Info observability tests ───────────────────────────────────────────

const TREND_TAG_IDS = {
  TRENDING:     300,
  QUEUE_DEPTH:  301,
  ROWS_PER_SEC: 302,
  FLUSH_MS:     303,
  DROPPED_PKGS: 304,
  ERROR_COUNT:  305,
};

function makeTrendInfoTags(omit?: string): ActiveTag[] {
  const all: ActiveTag[] = [
    makeActiveTag(TREND_TAG_IDS.TRENDING,     'CARO_1.HMI.Trend_Info.Trending'),
    makeActiveTag(TREND_TAG_IDS.QUEUE_DEPTH,  'CARO_1.HMI.Trend_Info.Queue_Depth'),
    makeActiveTag(TREND_TAG_IDS.ROWS_PER_SEC, 'CARO_1.HMI.Trend_Info.Rows_Per_Sec'),
    makeActiveTag(TREND_TAG_IDS.FLUSH_MS,     'CARO_1.HMI.Trend_Info.Flush_ms'),
    makeActiveTag(TREND_TAG_IDS.DROPPED_PKGS, 'CARO_1.HMI.Trend_Info.Dropped_Pkgs'),
    makeActiveTag(TREND_TAG_IDS.ERROR_COUNT,  'CARO_1.HMI.Trend_Info.Error_Count'),
  ];
  return omit ? all.filter(t => !t.tag_path.endsWith(omit)) : all;
}

interface PipelineState {
  trending: boolean;
  rowsPerSec: number;
  queueDepth: number;
  lastFlushMs: number;
  droppedPkgsTotal: number;
  errorCountTotal: number;
}

function makeTrendInfoSource(
  pipelineState: PipelineState,
  tags = makeTrendInfoTags(),
): { hmiTags: HmiTagSource & Record<string, number | boolean | string | number[]>; lkv: LkvCache } {
  const lkv = new LkvCache();
  const tagIds = tags.map(t => t.tag_id);

  const intake = {
    getModuleStats: vi.fn().mockReturnValue([]),
    ingest: vi.fn().mockImplementation((_moduleId: string, msg: { tags: { tag_id: number; value: unknown }[] }) => {
      for (const { tag_id, value } of msg.tags) {
        if (tagIds.includes(tag_id)) {
          lkv.set(tag_id, value as number | boolean | null);
        }
      }
    }),
  } as unknown as TelemetryIntake;

  const hmiTags = HmiTagSource.create(tags, {
    intake,
    hmiPublishIntervalMs: 250,
    dutyTracker: new DutyTracker(),
    dbPipeline: pipelineState as unknown as DbPipeline,
  });

  return { hmiTags, lkv };
}

describe('HmiTagSource — Trend_Info observability', () => {
  it('Trending tag value mirrors dbPipeline.trending', () => {
    const ps: PipelineState = { trending: true, rowsPerSec: 0, queueDepth: 0, lastFlushMs: 0, droppedPkgsTotal: 0, errorCountTotal: 0 };
    const { hmiTags, lkv } = makeTrendInfoSource(ps);

    hmiTags.publishNow();
    expect(lkv.getValue(TREND_TAG_IDS.TRENDING)).toBe(true);

    ps.trending = false;
    hmiTags.publishNow();
    expect(lkv.getValue(TREND_TAG_IDS.TRENDING)).toBe(false);
  });

  it('Rows_Per_Sec tag value mirrors dbPipeline.rowsPerSec', () => {
    const ps: PipelineState = { trending: false, rowsPerSec: 42.5, queueDepth: 0, lastFlushMs: 0, droppedPkgsTotal: 0, errorCountTotal: 0 };
    const { hmiTags, lkv } = makeTrendInfoSource(ps);
    hmiTags.publishNow();
    expect(lkv.getValue(TREND_TAG_IDS.ROWS_PER_SEC)).toBe(42.5);
  });

  it('other observability tags are published correctly', () => {
    const ps: PipelineState = { trending: false, rowsPerSec: 0, queueDepth: 7, lastFlushMs: 12.5, droppedPkgsTotal: 3, errorCountTotal: 1 };
    const { hmiTags, lkv } = makeTrendInfoSource(ps);
    hmiTags.publishNow();
    expect(lkv.getValue(TREND_TAG_IDS.QUEUE_DEPTH)).toBe(7);
    expect(lkv.getValue(TREND_TAG_IDS.FLUSH_MS)).toBe(12.5);
    expect(lkv.getValue(TREND_TAG_IDS.DROPPED_PKGS)).toBe(3);
    expect(lkv.getValue(TREND_TAG_IDS.ERROR_COUNT)).toBe(1);
  });

  it('skips missing tag and logs warn once — other five still publish', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const ps: PipelineState = { trending: true, rowsPerSec: 0, queueDepth: 2, lastFlushMs: 8, droppedPkgsTotal: 0, errorCountTotal: 0 };
      const { hmiTags, lkv } = makeTrendInfoSource(ps, makeTrendInfoTags('Flush_ms'));

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('Trend_Info_Flush_ms');

      hmiTags.publishNow();

      expect(lkv.getValue(TREND_TAG_IDS.TRENDING)).toBe(true);
      expect(lkv.getValue(TREND_TAG_IDS.QUEUE_DEPTH)).toBe(2);
      expect(lkv.getValue(TREND_TAG_IDS.DROPPED_PKGS)).toBe(0);
      expect(lkv.getValue(TREND_TAG_IDS.ERROR_COUNT)).toBe(0);
      expect(lkv.getValue(TREND_TAG_IDS.FLUSH_MS)).toBeNull();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('no Trend_Info warnings when dbPipeline is not provided', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const lkv = new LkvCache();
      const { intake } = makeIntake([1001], lkv);
      HmiTagSource.create(
        [makeActiveTag(1001, 'CARO_1.HMI.Some_Tag')],
        { intake, hmiPublishIntervalMs: 250, dutyTracker: new DutyTracker() },
      );
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ── Trend_Info.DB_Size observability tests ────────────────────────────────────

const DB_SIZE_TAG_ID = 306;

function makeDbSizeSource(
  pipelineState: PipelineState,
  sizeMonitor: TimescaleSizeMonitor | undefined,
  includeSizeTag: boolean,
): { hmiTags: HmiTagSource & Record<string, number | boolean | string | number[]>; lkv: LkvCache } {
  const lkv = new LkvCache();
  const baseTags = makeTrendInfoTags();
  const allTags = includeSizeTag
    ? [...baseTags, makeActiveTag(DB_SIZE_TAG_ID, 'CARO_1.HMI.Trend_Info.DB_Size', 'HMI', { data_type: 'f32' })]
    : baseTags;
  const tagIds = allTags.map(t => t.tag_id);

  const intake = {
    getModuleStats: vi.fn().mockReturnValue([]),
    ingest: vi.fn().mockImplementation((_moduleId: string, msg: { tags: { tag_id: number; value: unknown }[] }) => {
      for (const { tag_id, value } of msg.tags) {
        if (tagIds.includes(tag_id)) {
          lkv.set(tag_id, value as number | boolean | null);
        }
      }
    }),
  } as unknown as TelemetryIntake;

  const hmiTags = HmiTagSource.create(allTags, {
    intake,
    hmiPublishIntervalMs: 250,
    dutyTracker: new DutyTracker(),
    dbPipeline: pipelineState as unknown as DbPipeline,
    sizeMonitor,
  });

  return { hmiTags, lkv };
}

describe('HmiTagSource — Trend_Info.DB_Size', () => {
  const basePs: PipelineState = { trending: false, rowsPerSec: 0, queueDepth: 0, lastFlushMs: 0, droppedPkgsTotal: 0, errorCountTotal: 0 };

  it('DB_Size tag mirrors sizeMonitor.sizeGB', () => {
    const mockMonitor = { sizeGB: 2.5 } as unknown as TimescaleSizeMonitor;
    const { hmiTags, lkv } = makeDbSizeSource(basePs, mockMonitor, true);

    hmiTags.publishNow();

    expect(lkv.getValue(DB_SIZE_TAG_ID)).toBe(2.5);
  });

  it('DB_Size tag is not published when sizeMonitor is undefined', () => {
    const { hmiTags, lkv } = makeDbSizeSource(basePs, undefined, true);

    hmiTags.publishNow();

    // sizeMonitor absent → value never updated from null
    expect(lkv.getValue(DB_SIZE_TAG_ID)).toBeNull();
  });

  it('warns once when DB_Size tag id is missing from registry', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const mockMonitor = { sizeGB: 1.0 } as unknown as TimescaleSizeMonitor;
      // includeSizeTag=false → DB_Size absent from registry
      makeDbSizeSource(basePs, mockMonitor, false);

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('Trend_Info_DB_Size');
    } finally {
      warnSpy.mockRestore();
    }
  });
});
