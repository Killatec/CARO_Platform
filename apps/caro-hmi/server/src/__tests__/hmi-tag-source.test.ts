import { describe, it, expect, vi } from 'vitest';
import { HmiTagSource } from '../hmi-tag-source.js';
import { TelemetryIntake } from '../telemetry-intake.js';
import { LkvCache } from '../lkv.js';
import { DbPipeline } from '../db-pipeline.js';
import type { ActiveTag } from '@caro/db';
import type { TagDef } from '@caro/hmi-context';

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
    retired:     false,
    meta:        {},
    ...overrides,
  };
}

function makeTagDef(tag_id: number, module_id = 'HMI'): TagDef {
  return {
    tag_id,
    tag_path:    `CARO_1.${module_id}.tag${tag_id}`,
    data_type:   'i16',
    is_setpoint: false,
    module_id,
    eng_min:     null,
    eng_max:     null,
    unit:        null,
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
  });
  return { lkv, intake };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('HmiTagSource', () => {
  it('property set updates internal value and get retrieves it', () => {
    const { intake } = makeIntake([1066]);
    const hmiTags = HmiTagSource.create(
      [makeActiveTag(1066, 'CARO_1.HMI.Module_Count')],
      { intake, hmiPublishIntervalMs: HMI_PUBLISH_INTERVAL_MS },
    );

    hmiTags.Module_Count = 11;
    expect(hmiTags.Module_Count).toBe(11);
  });

  it('unknown property throws on set', () => {
    const { intake } = makeIntake([1066]);
    const hmiTags = HmiTagSource.create(
      [makeActiveTag(1066, 'CARO_1.HMI.Module_Count')],
      { intake, hmiPublishIntervalMs: HMI_PUBLISH_INTERVAL_MS },
    );

    expect(() => { (hmiTags as Record<string, unknown>).Nonexistent = 5; })
      .toThrow('unknown property');
  });

  it('unknown property returns undefined on get', () => {
    const { intake } = makeIntake([1066]);
    const hmiTags = HmiTagSource.create(
      [makeActiveTag(1066, 'CARO_1.HMI.Module_Count')],
      { intake, hmiPublishIntervalMs: HMI_PUBLISH_INTERVAL_MS },
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
        { intake, hmiPublishIntervalMs: HMI_PUBLISH_INTERVAL_MS },
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
        { intake, hmiPublishIntervalMs: HMI_PUBLISH_INTERVAL_MS },
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
      { intake, hmiPublishIntervalMs: HMI_PUBLISH_INTERVAL_MS },
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
        { intake, hmiPublishIntervalMs: HMI_PUBLISH_INTERVAL_MS },
      )
    ).toThrow('collision');
  });

  it('class methods (startPublishing, stopPublishing) accessible through proxy', () => {
    const { intake } = makeIntake([1066]);
    const hmiTags = HmiTagSource.create(
      [makeActiveTag(1066, 'CARO_1.HMI.Module_Count')],
      { intake, hmiPublishIntervalMs: HMI_PUBLISH_INTERVAL_MS },
    );

    expect(typeof hmiTags.startPublishing).toBe('function');
    expect(typeof hmiTags.stopPublishing).toBe('function');
  });
});
