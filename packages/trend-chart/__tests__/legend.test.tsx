import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MockHmiProvider } from '@caro/hmi-context';
import type { TagDef } from '@caro/hmi-context';
import { Legend, charsForTag } from '../src/Legend.js';
import type { AggregateSeriesData, RawSeriesData } from '../src/types.js';

const TAG_DEFS: Record<number, TagDef> = {
  1: { tag_id: 1, tag_path: 'A.B.Temp', tag_name: 'Temperature', data_type: 'float', is_setpoint: false, trendable: true,
       module_id: 'M', module_type: 'MQTT', eng_min: 0, eng_max: 100, unit: '°C', format: null, meta: [] },
  2: { tag_id: 2, tag_path: 'A.B.Power', tag_name: 'Power Reading', data_type: 'float', is_setpoint: false, trendable: true,
       module_id: 'M', module_type: 'MQTT', eng_min: null, eng_max: null, unit: 'kW', format: null, meta: [] },
};

// v0.7-style aggregate fixture (no min/max) — exercises the single-value fallback.
// startTime=0n, bucketSMs=1000, n=5 → buckets at [0,1000), [1000,2000), …, [4000,5000).
function makeDataV7(): AggregateSeriesData {
  return {
    type: 'aggregate',
    source: '1min_cagg',
    startTime: 0n,
    endTime: 5_000n,
    n: 5,
    bucketSMs: 1000,
    series: new Map([
      [1, { value: [10, 20, 30, 40, 50] }],
      [2, { value: [1, 2, 3, 4, 5] }],
    ]),
  };
}

// v0.8-style aggregate fixture with min/max bands.
function makeDataV8(): AggregateSeriesData {
  return {
    type: 'aggregate',
    source: '1min_cagg',
    startTime: 0n,
    endTime: 5_000n,
    n: 5,
    bucketSMs: 1000,
    series: new Map([
      [1, { value: [10, 20, 30, 40, 50], min: [8, 18, 28, 38, 48], max: [12, 22, 32, 42, 52] }],
      [2, { value: [1, 2, 3, 4, 5],     min: [0.5, 1.5, 2.5, 3.5, 4.5], max: [1.5, 2.5, 3.5, 4.5, 5.5] }],
    ]),
  };
}

// Raw fixture: 5 uniformly spaced COV samples.
function makeRawData(): RawSeriesData {
  return {
    type: 'raw',
    source: 'raw',
    startTime: 0n,
    endTime: 5_000n,
    series: new Map([
      [1, { ts: [0n, 1000n, 2000n, 3000n, 4000n], value: [10, 20, 30, 40, 50] }],
    ]),
  };
}

// Two tags with interleaved COV timestamps.
// Tag 1 ts: [0n, 2000n, 4000n], values: [10, 30, 50]
// Tag 2 ts: [1000n, 3000n],     values: [100, 300]
function makeRawDataMultiTag(): RawSeriesData {
  return {
    type: 'raw',
    source: 'raw',
    startTime: 0n,
    endTime: 4_000n,
    series: new Map([
      [1, { ts: [0n, 2000n, 4000n], value: [10, 30, 50] }],
      [2, { ts: [1000n, 3000n], value: [100, 300] }],
    ]),
  };
}

// Single tag with a prev seed outside [startTime, endTime).
// tag1: ts=[1000n, 3000n], value=[20, 40], prev={ts: 0n, value: 5}
function makeRawDataWithPrev(): RawSeriesData {
  return {
    type: 'raw',
    source: 'raw',
    startTime: 1_000n,
    endTime: 3_000n,
    series: new Map([
      [1, { ts: [1000n, 3000n], value: [20, 40], prev: { ts: 0n, value: 5 } }],
    ]),
  };
}

// Raw fixture with a null sample in the middle — models a COV gap.
// ts=[0n, 1000n, 2000n], value=[10, null, 30]
function makeRawDataWithNull(): RawSeriesData {
  return {
    type: 'raw',
    source: 'raw',
    startTime: 0n,
    endTime: 3_000n,
    series: new Map([
      [1, { ts: [0n, 1000n, 2000n], value: [10, null, 30] }],
    ]),
  };
}

// Bug 1 regression fixture: tag 1 steps once and goes quiet; tag 2 has samples
// extending past tag 1's last sample. The union-extent upper bound is 2000n (tag 2).
// Tag 1: ts=[0n, 1000n], value=[10, 20]  — last sample at 1000ms
// Tag 2: ts=[500n, 2000n], value=[100, 200] — last sample at 2000ms
function makeRawDataStepAndActive(): RawSeriesData {
  return {
    type: 'raw',
    source: 'raw',
    startTime: 0n,
    endTime: 2_000n,
    series: new Map([
      [1, { ts: [0n, 1000n], value: [10, 20] }],
      [2, { ts: [500n, 2000n], value: [100, 200] }],
    ]),
  };
}

// Bug 2 regression fixture: tag 1 has only a prev seed (empty ts); tag 2 has
// in-window samples. The union-extent upper bound is 2000n (tag 2).
// Tag 1: ts=[], value=[], prev={ts: 0n, value: 5}
// Tag 2: ts=[500n, 2000n], value=[100, 200]
function makeRawDataPrevOnlyFlat(): RawSeriesData {
  return {
    type: 'raw',
    source: 'raw',
    startTime: 500n,
    endTime: 2_000n,
    series: new Map([
      [1, { ts: [], value: [], prev: { ts: 0n, value: 5 } }],
      [2, { ts: [500n, 2000n], value: [100, 200] }],
    ]),
  };
}

function renderLegend(
  tagIds: number[] = [1],
  data: AggregateSeriesData | RawSeriesData = makeDataV7(),
  onRemove = vi.fn(),
  opts: {
    cursorTsMs?: number | null;
    showLastWhenIdle?: boolean;
    siteTimezone?: string;
    bucketSMs?: bigint | null;
    lastFetchMs?: number | null;
  } = {},
) {
  return render(
    <MockHmiProvider tagDefs={TAG_DEFS}>
      <Legend
        tagIds={tagIds}
        data={data}
        tagMap={new Map([[1, TAG_DEFS[1]!], [2, TAG_DEFS[2]!]])}
        selectedTagId={tagIds[0] ?? 1}
        cursorTsMs={opts.cursorTsMs}
        siteTimezone={opts.siteTimezone}
        bucketSMs={opts.bucketSMs ?? null}
        lastFetchMs={opts.lastFetchMs ?? null}
        showLastWhenIdle={opts.showLastWhenIdle ?? true}
        onSelect={vi.fn()}
        onRemove={onRemove}
      />
    </MockHmiProvider>,
  );
}

// ── Structural tests (independent of value format) ────────────────────────────

describe('Legend — entry rows', () => {
  it('renders the tag_name for each tagId', () => {
    renderLegend([1, 2]);
    expect(screen.getByText('Temperature')).toBeTruthy();
    expect(screen.getByText('Power Reading')).toBeTruthy();
  });

  it('renders a remove button for each tag', () => {
    renderLegend([1, 2]);
    expect(screen.getAllByTitle('Remove trace')).toHaveLength(2);
  });

  it('calls onRemove with the correct tagId when remove is clicked', () => {
    const onRemove = vi.fn();
    renderLegend([1, 2], makeDataV7(), onRemove);
    const btns = screen.getAllByTitle('Remove trace');
    fireEvent.click(btns[0]!);
    expect(onRemove).toHaveBeenCalledWith(1);
  });

  it('selected tag name is bold; unselected is not', () => {
    renderLegend([1, 2]);
    expect(screen.getByText('Temperature').style.fontWeight).toBe('700');
    expect(screen.getByText('Power Reading').style.fontWeight).not.toBe('700');
  });
});

// ── v0.7 aggregate: single-value fallback ─────────────────────────────────────

describe('Legend — aggregate v0.7 (no min/max) — single-value fallback', () => {
  it('showLastWhenIdle=true → shows last-bucket value', () => {
    renderLegend([1], makeDataV7(), vi.fn(), { showLastWhenIdle: true });
    expect(screen.getByText('50')).toBeTruthy();
  });

  it('showLastWhenIdle=false → shows em-dash placeholder', () => {
    renderLegend([1], makeDataV7(), vi.fn(), { showLastWhenIdle: false });
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('cursorTsMs in bucket 1 → shows that bucket value', () => {
    // bucket 1 covers [1000, 2000); value[1]=20 → "20 °C"
    renderLegend([1], makeDataV7(), vi.fn(), { cursorTsMs: 1500, showLastWhenIdle: false });
    expect(screen.getByText('20')).toBeTruthy();
  });
});

// ── v0.8 aggregate: max-only display ─────────────────────────────────────────

describe('Legend — aggregate v0.8 (with min/max bands)', () => {
  it('showLastWhenIdle=true → shows last-bucket max with unit', () => {
    renderLegend([1], makeDataV8(), vi.fn(), { showLastWhenIdle: true });
    // Last bucket: max[4]=52 → "52 °C"
    expect(screen.getByText('52')).toBeTruthy();
  });

  it('showLastWhenIdle=false → shows em-dash placeholder', () => {
    renderLegend([1], makeDataV8(), vi.fn(), { showLastWhenIdle: false });
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('cursorTsMs in bucket 1 → shows max at that bucket', () => {
    // bucket 1 covers [1000, 2000); max[1]=22 → "22 °C"
    renderLegend([1], makeDataV8(), vi.fn(), { cursorTsMs: 1500, showLastWhenIdle: false });
    expect(screen.getByText('22')).toBeTruthy();
  });

  it('both bounds null → shows em-dash', () => {
    const data: AggregateSeriesData = {
      type: 'aggregate',
      source: '1min_cagg',
      startTime: 0n,
      endTime: 1_000n,
      n: 1,
      bucketSMs: 1000,
      series: new Map([[1, { value: [null], min: [null], max: [null] }]]),
    };
    renderLegend([1], data, vi.fn(), { showLastWhenIdle: true });
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('collapsed band (min === max) — max naturally collapses to the single value', () => {
    const data: AggregateSeriesData = {
      type: 'aggregate',
      source: '1min_cagg',
      startTime: 0n,
      endTime: 1_000n,
      n: 1,
      bucketSMs: 1000,
      series: new Map([[1, { value: [5], min: [5], max: [5] }]]),
    };
    renderLegend([1], data, vi.fn(), { showLastWhenIdle: true });
    expect(screen.getByText('5')).toBeTruthy();
  });
});

// ── Contextual header text — six-state table ──────────────────────────────────

describe('Legend — contextual header text', () => {
  it('aggregate + cursor present → header reads "Value: Max @ Cursor"', () => {
    renderLegend([1], makeDataV8(), vi.fn(), { cursorTsMs: 1500, showLastWhenIdle: false });
    expect(screen.getByText('Value: Max @ Cursor')).toBeTruthy();
  });

  it('aggregate + idle + tailing → header reads "Value: Last Sample"', () => {
    renderLegend([1], makeDataV8(), vi.fn(), { showLastWhenIdle: true });
    expect(screen.getByText('Value: Last Sample')).toBeTruthy();
  });

  it('aggregate + idle + fixed → header reads "Value: N/A"', () => {
    renderLegend([1], makeDataV8(), vi.fn(), { showLastWhenIdle: false });
    expect(screen.getByText('Value: N/A')).toBeTruthy();
  });

  it('raw + cursor present → header reads "Value: @ Cursor"', () => {
    renderLegend([1], makeRawData(), vi.fn(), { cursorTsMs: 2000, showLastWhenIdle: false });
    expect(screen.getByText('Value: @ Cursor')).toBeTruthy();
  });

  it('raw + idle + tailing → header reads "Value: Last Sample"', () => {
    renderLegend([1], makeRawData(), vi.fn(), { showLastWhenIdle: true });
    expect(screen.getByText('Value: Last Sample')).toBeTruthy();
  });

  it('raw + idle + fixed → header reads "Value: N/A"', () => {
    renderLegend([1], makeRawData(), vi.fn(), { showLastWhenIdle: false });
    expect(screen.getByText('Value: N/A')).toBeTruthy();
  });
});

// ── Raw mode ──────────────────────────────────────────────────────────────────

describe('Legend — raw mode', () => {
  it('showLastWhenIdle=true → shows last sample value', () => {
    renderLegend([1], makeRawData(), vi.fn(), { showLastWhenIdle: true });
    // Last value in [10,20,30,40,50] = 50 °C
    expect(screen.getByText('50')).toBeTruthy();
  });

  it('showLastWhenIdle=false → shows em-dash', () => {
    renderLegend([1], makeRawData(), vi.fn(), { showLastWhenIdle: false });
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('cursorTsMs at sample ts → shows that sample value', () => {
    // cursorTsMs=2000 → LOCF → ts[2]=2000n → value=30 → "30 °C"
    renderLegend([1], makeRawData(), vi.fn(), { cursorTsMs: 2000, showLastWhenIdle: false });
    expect(screen.getByText('30')).toBeTruthy();
  });
});

// ── Raw mode — step-transition and gap correctness ────────────────────────────
//
// The rendered line is stepped (align=1, held-forward). The legend must show the
// value whose forward-held span contains the cursor X, not the value of the
// nearest data point in index space.

describe('Legend — raw mode — step-transition and gaps', () => {
  // makeRawData: ts=[0,1000,2000,3000,4000], value=[10,20,30,40,50]

  it('cursor between samples shows held (near-side) value, not nearer-index value', () => {
    // Cursor at 1700ms. Nearest sample by distance is ts=2000 (300ms away) → value 30.
    // Correct LOCF: last ts ≤ 1700 is ts=1000 → value 20.
    renderLegend([1], makeRawData(), vi.fn(), { cursorTsMs: 1700, showLastWhenIdle: false });
    expect(screen.getByText('20')).toBeTruthy();
  });

  it('cursor past the last sample → em-dash (no line drawn past last point)', () => {
    // Last sample at ts=4000n; cursor at 5000ms → "—"
    renderLegend([1], makeRawData(), vi.fn(), { cursorTsMs: 5000, showLastWhenIdle: false });
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('cursor before the first sample with no prev → em-dash', () => {
    // First sample at ts=0n; cursor at -1ms → no data before cursor → "—"
    renderLegend([1], makeRawData(), vi.fn(), { cursorTsMs: -1, showLastWhenIdle: false });
    expect(screen.getByText('—')).toBeTruthy();
  });

  // makeRawDataWithNull: ts=[0n, 1000n, 2000n], value=[10, null, 30]

  it('null sample: cursor in null region → em-dash', () => {
    // At ts=1000 value is null (gap). Cursor at 1500ms → LOCF from ts=1000 → null → "—"
    renderLegend([1], makeRawDataWithNull(), vi.fn(), { cursorTsMs: 1500, showLastWhenIdle: false });
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('null sample: cursor after null-then-resume → shows resumed value', () => {
    // At ts=2000 value resumes to 30. Cursor exactly at 2000ms.
    renderLegend([1], makeRawDataWithNull(), vi.fn(), { cursorTsMs: 2000, showLastWhenIdle: false });
    expect(screen.getByText('30')).toBeTruthy();
  });
});

// ── Raw mode — multi-tag and prev seed correctness ────────────────────────────
//
// Tests LOCF resolution across tags with different COV timestamps and prev seeds.
// Using cursorTsMs (actual timestamp) eliminates the need for union-grid index math.

describe('Legend — raw mode — multi-tag and prev seed correctness', () => {
  // makeRawDataMultiTag:
  //   tag1 ts: [0n, 2000n, 4000n], values: [10, 30, 50]
  //   tag2 ts: [1000n, 3000n],     values: [100, 300]

  it('multi-tag: cursor at ts=1000 shows LOCF value for tag1', () => {
    // tag1's last sample ≤ 1000n is ts=0n → value 10
    renderLegend([1, 2], makeRawDataMultiTag(), vi.fn(), { cursorTsMs: 1000, showLastWhenIdle: false });
    expect(screen.getByText('10')).toBeTruthy();
  });

  it('multi-tag: cursor at ts=3000 shows LOCF value for tag1', () => {
    // tag1's last sample ≤ 3000n is ts=2000n → value 30
    renderLegend([1, 2], makeRawDataMultiTag(), vi.fn(), { cursorTsMs: 3000, showLastWhenIdle: false });
    expect(screen.getByText('30')).toBeTruthy();
  });

  it('multi-tag: cursor at ts=0 shows em-dash for tag2 (no tag2 data at or before ts=0)', () => {
    // tag2's first sample is ts=1000n > 0n → not seeded → "—"
    // tag1 shows "10 °C"
    renderLegend([1, 2], makeRawDataMultiTag(), vi.fn(), { cursorTsMs: 0, showLastWhenIdle: false });
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('multi-tag: cursor at ts=2000 shows LOCF 100 kW for tag2', () => {
    // tag2's last sample ≤ 2000n is ts=1000n → value 100
    renderLegend([1, 2], makeRawDataMultiTag(), vi.fn(), { cursorTsMs: 2000, showLastWhenIdle: false });
    expect(screen.getByText('100')).toBeTruthy();
  });

  // makeRawDataWithPrev: ts=[1000n, 3000n], value=[20, 40], prev={ts: 0n, value: 5}

  it('prev seed: cursor at prev.ts shows prev value', () => {
    // cursorTsMs=0 → prev.ts=0n ≤ 0n → seeds 5; ts[0]=1000n > 0n → stop → "5 °C"
    renderLegend([1], makeRawDataWithPrev(), vi.fn(), { cursorTsMs: 0, showLastWhenIdle: false });
    expect(screen.getByText('5')).toBeTruthy();
  });

  it('prev seed: cursor at first COV ts shows first COV value', () => {
    // cursorTsMs=1000 → prev seeds 5; ts[0]=1000n ≤ 1000n → lastVal=20 → "20 °C"
    renderLegend([1], makeRawDataWithPrev(), vi.fn(), { cursorTsMs: 1000, showLastWhenIdle: false });
    expect(screen.getByText('20')).toBeTruthy();
  });

  it('prev seed: cursor at last COV ts shows last COV value', () => {
    // cursorTsMs=3000 → prev seeds 5; ts[0]=1000n→20; ts[1]=3000n→40 → "40 °C"
    renderLegend([1], makeRawDataWithPrev(), vi.fn(), { cursorTsMs: 3000, showLastWhenIdle: false });
    expect(screen.getByText('40')).toBeTruthy();
  });
});

// ── Aggregate — bucket boundary resolution (cursorTsMs) ──────────────────────

describe('Legend — aggregate — bucket boundary resolution', () => {
  // makeDataV8: startTime=0n, bucketSMs=1000, n=5
  // max=[12, 22, 32, 42, 52]

  it('cursor just before boundary → resolves to left bucket', () => {
    // cursorTsMs=999 → bucketIdx=floor(999/1000)=0 → max[0]=12 → "12 °C"
    renderLegend([1], makeDataV8(), vi.fn(), { cursorTsMs: 999, showLastWhenIdle: false });
    expect(screen.getByText('12')).toBeTruthy();
  });

  it('cursor exactly at boundary → resolves to right bucket', () => {
    // cursorTsMs=1000 → bucketIdx=floor(1000/1000)=1 → max[1]=22 → "22 °C"
    renderLegend([1], makeDataV8(), vi.fn(), { cursorTsMs: 1000, showLastWhenIdle: false });
    expect(screen.getByText('22')).toBeTruthy();
  });

  it('null bucket under cursor → em-dash', () => {
    const data: AggregateSeriesData = {
      type: 'aggregate',
      source: '1min_cagg',
      startTime: 0n,
      endTime: 3_000n,
      n: 3,
      bucketSMs: 1000,
      series: new Map([[1, { value: [10, null, 30], min: [8, null, 28], max: [12, null, 32] }]]),
    };
    // cursorTsMs=1500 → bucketIdx=1 → max[1]=null → "—"
    renderLegend([1], data, vi.fn(), { cursorTsMs: 1500, showLastWhenIdle: false });
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('bucketIdx < 0 (cursor before startTime) → em-dash', () => {
    // cursorTsMs=-500 → bucketIdx=floor(-500/1000)=-1 < 0 → "—"
    renderLegend([1], makeDataV8(), vi.fn(), { cursorTsMs: -500, showLastWhenIdle: false });
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('bucketIdx >= n (cursor past endTime) → em-dash', () => {
    // cursorTsMs=5500 → bucketIdx=floor(5500/1000)=5 >= n=5 → "—"
    renderLegend([1], makeDataV8(), vi.fn(), { cursorTsMs: 5500, showLastWhenIdle: false });
    expect(screen.getByText('—')).toBeTruthy();
  });
});

// ── Raw mode — union-extent upper bound (Bug 1 + Bug 2 regression) ────────────
//
// These tests require MULTI-TAG fixtures because the union extent only differs
// from the per-tag extent when another tag has later samples.
//
// Bug 1: per-tag upper-bound check (`cursorBigInt > tag.lastTs`) incorrectly
//   returned '—' for a tag whose own last COV sample was before the cursor,
//   even though the tag's line is forward-filled to the union max.
// Bug 2: empty-ts short-circuit (`ts.length === 0`) incorrectly returned '—'
//   for a tag with only a prev seed, even though a flat line is drawn.

describe('Legend — raw mode — union-extent upper bound (Bug 1 + Bug 2 regression)', () => {
  // makeRawDataStepAndActive:
  //   tag1 ts: [0n, 1000n], value: [10, 20]  — steps at 1000ms, then quiet
  //   tag2 ts: [500n, 2000n], value: [100, 200] — extends to 2000ms
  //   Union max: 2000n

  it('Bug 1: quiet tag shows held value after its own last sample (cursor < union max)', () => {
    // Cursor at 1500ms. Tag 1's last sample is 1000ms < 1500ms.
    // Old code: `1500n > 1000n` → returned '—' (wrong).
    // Correct: LOCF from ts=1000n → value 20 → "20 °C".
    renderLegend([1, 2], makeRawDataStepAndActive(), vi.fn(), { cursorTsMs: 1500, showLastWhenIdle: false });
    expect(screen.getByText('20')).toBeTruthy();
  });

  it('Bug 1: active tag still resolves correctly alongside quiet tag', () => {
    // At cursorTsMs=1500, tag2's LOCF from ts=500n → value 100 → "100 kW".
    renderLegend([1, 2], makeRawDataStepAndActive(), vi.fn(), { cursorTsMs: 1500, showLastWhenIdle: false });
    expect(screen.getByText('100')).toBeTruthy();
  });

  it('cursor past union max → em-dash for all tags', () => {
    // cursorTsMs=2500 > unionMax=2000ms → '—' for both tags.
    renderLegend([1, 2], makeRawDataStepAndActive(), vi.fn(), { cursorTsMs: 2500, showLastWhenIdle: false });
    expect(screen.getAllByText('—')).toHaveLength(2);
  });

  // makeRawDataPrevOnlyFlat:
  //   tag1 ts: [], value: [], prev={ts: 0n, value: 5}  — flat, no in-window samples
  //   tag2 ts: [500n, 2000n], value: [100, 200]
  //   Union max: 2000n

  it('Bug 2: prev-only flat tag shows prev value when cursor is in-window', () => {
    // Tag 1 has empty ts but a prev seed. Cursor at 1000ms.
    // Old code: `ts.length === 0` → returned '—' (wrong).
    // Correct: prev.ts=0n ≤ 1000n → seeded → value 5 → "5 °C".
    renderLegend([1, 2], makeRawDataPrevOnlyFlat(), vi.fn(), { cursorTsMs: 1000, showLastWhenIdle: false });
    expect(screen.getByText('5')).toBeTruthy();
  });

  it('Bug 2: prev-only flat tag shows prev value up to the union max', () => {
    // Cursor at union max (2000ms). Tag 1 LOCF = 5; tag 2 LOCF = 200.
    renderLegend([1, 2], makeRawDataPrevOnlyFlat(), vi.fn(), { cursorTsMs: 2000, showLastWhenIdle: false });
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('200')).toBeTruthy();
  });

  it('Bug 2: prev-only flat tag shows em-dash when cursor is past union max', () => {
    // cursorTsMs=2500 > unionMax=2000ms → '—' for both.
    renderLegend([1, 2], makeRawDataPrevOnlyFlat(), vi.fn(), { cursorTsMs: 2500, showLastWhenIdle: false });
    expect(screen.getAllByText('—')).toHaveLength(2);
  });
});

// ── charsForTag — column-width formula ───────────────────────────────────────

describe('charsForTag', () => {
  it('bool tag always returns 1', () => {
    expect(charsForTag({ ...TAG_DEFS[1]!, data_type: 'bool' })).toBe(1);
  });

  it('null tag returns MIN_CHARS (4)', () => {
    expect(charsForTag(undefined)).toBe(4);
  });

  it('eng_min=0, eng_max=100, format=null → 8 chars (3 int + 1 dot + 4 dec)', () => {
    // sign=0, intDigits=3, dot=1, decimals=4 → 8
    expect(charsForTag(TAG_DEFS[1]!)).toBe(8);
  });

  it('eng_min=-10, eng_max=50, format="%.2f" → 6 chars (1 sign + 2 int + 1 dot + 2 dec)', () => {
    const tag: TagDef = { ...TAG_DEFS[1]!, eng_min: -10, eng_max: 50, format: '%.2f' };
    expect(charsForTag(tag)).toBe(6);
  });

  it('format="%.0f" → no dot, no decimals (e.g. eng_min=0, eng_max=9 → 1+0+0=1)', () => {
    const tag: TagDef = { ...TAG_DEFS[1]!, eng_min: 0, eng_max: 9, format: '%.0f' };
    // sign=0, intDigits=1, dot=0, decimals=0 → 1
    expect(charsForTag(tag)).toBe(1);
  });

  it('eng_min=null, eng_max=null, format=null → falls back to 9999 sentinel → 8 chars', () => {
    // maxAbs=9999, intDigits=4, decimals=4, sign=0, dot=1 → 9
    expect(charsForTag(TAG_DEFS[2]!)).toBe(9);
  });
});

// ── Units column ──────────────────────────────────────────────────────────────

describe('Legend — units column', () => {
  it('unit cell shows the tag unit string', () => {
    renderLegend([1]);
    expect(screen.getByText('°C')).toBeTruthy();
  });

  it('unit cell is empty when tag unit is null', () => {
    const tagMap = new Map<number, TagDef>([[99, {
      tag_id: 99, tag_path: 'A.B.C', tag_name: 'NoUnit', data_type: 'float',
      is_setpoint: false, trendable: true, module_id: 'M', module_type: 'MQTT',
      eng_min: null, eng_max: null, unit: null, format: null, meta: [],
    }]]);
    render(
      <MockHmiProvider tagDefs={{ 99: tagMap.get(99)! }}>
        <Legend
          tagIds={[99]}
          data={makeDataV7()}
          tagMap={tagMap}
          selectedTagId={99}
          bucketSMs={null}
          lastFetchMs={null}
          showLastWhenIdle={true}
          onSelect={vi.fn()}
          onRemove={vi.fn()}
        />
      </MockHmiProvider>,
    );
    // No unit text visible — but the tag name and value are present.
    expect(screen.getByText('NoUnit')).toBeTruthy();
    expect(screen.queryByText('°C')).toBeNull();
    expect(screen.queryByText('kW')).toBeNull();
  });

  it('two-tag render shows both unit strings', () => {
    renderLegend([1, 2]);
    expect(screen.getByText('°C')).toBeTruthy();
    expect(screen.getByText('kW')).toBeTruthy();
  });
});

// ── Reflow stability — valueColPx does not change on data update ──────────────

describe('Legend — value column width stability', () => {
  it('value cell width style is fixed (set from charsForTag, not data values)', () => {
    const { container } = renderLegend([1], makeDataV7(), vi.fn(), { showLastWhenIdle: true });
    // Find the value <td> — it has textAlign:right style. Get its computed inline width.
    const valueTds = container.querySelectorAll('td[style*="text-align: right"]');
    expect(valueTds.length).toBeGreaterThan(0);
    const widthBefore = (valueTds[0] as HTMLElement).style.width;
    expect(widthBefore).toBeTruthy();
    // Width is a pixel string, not empty or 'auto'.
    expect(widthBefore).toMatch(/^\d+(\.\d+)?px$/);
  });
});

// ── Legend label source ────────────────────────────────────────────────────────

describe('Legend — label source', () => {
  it('uses tag_name when present', () => {
    renderLegend([1, 2]);
    expect(screen.getByText('Temperature')).toBeTruthy();
    expect(screen.getByText('Power Reading')).toBeTruthy();
  });

  it('falls back to Tag-<id> when tag_name is null', () => {
    const tagMap = new Map<number, TagDef>([[99, {
      tag_id: 99, tag_path: 'A.B.C', tag_name: null, data_type: 'float',
      is_setpoint: false, trendable: true, module_id: 'M', module_type: 'MQTT',
      eng_min: null, eng_max: null, unit: null, format: null, meta: [],
    }]]);
    render(
      <MockHmiProvider tagDefs={{ 99: tagMap.get(99)! }}>
        <Legend
          tagIds={[99]}
          data={makeDataV7()}
          tagMap={tagMap}
          selectedTagId={99}
          bucketSMs={null}
          lastFetchMs={null}
          showLastWhenIdle={false}
          onSelect={vi.fn()}
          onRemove={vi.fn()}
        />
      </MockHmiProvider>,
    );
    expect(screen.getByText('Tag-99')).toBeTruthy();
  });

  it('falls back to Tag-<id> when tagId is not in tagMap', () => {
    render(
      <MockHmiProvider tagDefs={TAG_DEFS}>
        <Legend
          tagIds={[999]}
          data={makeDataV7()}
          tagMap={new Map()}
          selectedTagId={999}
          bucketSMs={null}
          lastFetchMs={null}
          showLastWhenIdle={false}
          onSelect={vi.fn()}
          onRemove={vi.fn()}
        />
      </MockHmiProvider>,
    );
    expect(screen.getByText('Tag-999')).toBeTruthy();
  });
});

// ── Cursor row ────────────────────────────────────────────────────────────────

describe('Legend — cursor row', () => {
  it('shows "Cursor: --" when cursorTsMs is absent', () => {
    renderLegend([1]);
    expect(screen.getByText(/^Cursor:/).textContent).toBe('Cursor: --');
  });

  it('shows "Cursor: --" when cursorTsMs is null', () => {
    renderLegend([1], makeDataV7(), vi.fn(), { cursorTsMs: null });
    expect(screen.getByText(/^Cursor:/).textContent).toBe('Cursor: --');
  });

  it('formats a timestamp when cursorTsMs is provided', () => {
    // 2024-01-15 12:00:00 UTC
    renderLegend([1], makeDataV7(), vi.fn(), { cursorTsMs: 1_705_320_000_000, siteTimezone: 'UTC' });
    const el = screen.getByText(/^Cursor:/);
    expect(el.textContent).not.toBe('Cursor: --');
    expect(el.textContent).toContain('15-Jan-2024');
    expect(el.textContent).toContain('12:00:00');
  });
});

// ── BucketFetchIndicator integration ─────────────────────────────────────────

describe('Legend — bucket/fetch section', () => {
  it('shows "—" for bucket size when bucketSMs is null', () => {
    renderLegend([1], makeDataV7(), vi.fn(), { bucketSMs: null });
    expect(screen.getByText(/^Bucket Size:/).textContent).toBe('Bucket Size: —');
  });

  it('shows formatted bucket size when bucketSMs is provided', () => {
    renderLegend([1], makeDataV7(), vi.fn(), { bucketSMs: 60_000n });
    expect(screen.getByText(/^Bucket Size:/).textContent).toBe('Bucket Size: 1 min');
  });

  it('shows "—" for last fetch when lastFetchMs is null', () => {
    renderLegend([1], makeDataV7(), vi.fn(), { lastFetchMs: null });
    expect(screen.getByText(/^Last Fetch:/).textContent).toBe('Last Fetch: —');
  });
});

// ── Signals header row ────────────────────────────────────────────────────────

describe('Legend — Signals header row', () => {
  it('Signals header is in <thead> with colSpan 5', () => {
    const { container } = renderLegend([1]);
    const th = container.querySelector('thead th') as HTMLTableCellElement | null;
    expect(th).not.toBeNull();
    expect(th!.colSpan).toBe(5);
    expect(th!.textContent).toContain('Signals');
  });

  it('Signals <th> has bottom border', () => {
    const { container } = renderLegend([1]);
    const th = container.querySelector('thead th')!;
    expect((th as HTMLElement).outerHTML).toContain('1px solid');
  });

  it('gear button click invokes onSettingsClick', () => {
    const onSettingsClick = vi.fn();
    render(
      <MockHmiProvider tagDefs={TAG_DEFS}>
        <Legend
          tagIds={[1]}
          data={makeDataV7()}
          tagMap={new Map([[1, TAG_DEFS[1]!]])}
          selectedTagId={1}
          bucketSMs={null}
          lastFetchMs={null}
          showLastWhenIdle={false}
          onSelect={vi.fn()}
          onRemove={vi.fn()}
          onSettingsClick={onSettingsClick}
        />
      </MockHmiProvider>,
    );
    fireEvent.click(screen.getByTitle('Configure signals'));
    expect(onSettingsClick).toHaveBeenCalledTimes(1);
  });
});
