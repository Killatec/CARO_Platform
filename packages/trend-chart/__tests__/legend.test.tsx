import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MockHmiProvider } from '@caro/hmi-context';
import type { TagDef } from '@caro/hmi-context';
import { Legend } from '../src/Legend.js';
import type { AggregateSeriesData, RawSeriesData } from '../src/types.js';

const TAG_DEFS: Record<number, TagDef> = {
  1: { tag_id: 1, tag_path: 'A.B.Temp', data_type: 'float', is_setpoint: false,
       module_id: 'M', module_type: 'MQTT', eng_min: 0, eng_max: 100, unit: '°C', meta: [] },
  2: { tag_id: 2, tag_path: 'A.B.Power', data_type: 'float', is_setpoint: false,
       module_id: 'M', module_type: 'MQTT', eng_min: null, eng_max: null, unit: 'kW', meta: [] },
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
  opts: { cursorTsMs?: number | null; showLastWhenIdle?: boolean } = {},
) {
  return render(
    <MockHmiProvider tagDefs={TAG_DEFS}>
      <Legend
        tagIds={tagIds}
        data={data}
        tagMap={new Map([[1, TAG_DEFS[1]!], [2, TAG_DEFS[2]!]])}
        selectedTagId={tagIds[0] ?? 1}
        cursorTsMs={opts.cursorTsMs}
        showLastWhenIdle={opts.showLastWhenIdle ?? true}
        onSelect={vi.fn()}
        onRemove={onRemove}
      />
    </MockHmiProvider>,
  );
}

// ── Structural tests (independent of value format) ────────────────────────────

describe('Legend — entry rows', () => {
  it('renders the tag short name for each tagId', () => {
    renderLegend([1, 2]);
    expect(screen.getByText('Temp')).toBeTruthy();
    expect(screen.getByText('Power')).toBeTruthy();
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
    expect(screen.getByText('Temp').style.fontWeight).toBe('700');
    expect(screen.getByText('Power').style.fontWeight).not.toBe('700');
  });
});

// ── v0.7 aggregate: single-value fallback ─────────────────────────────────────

describe('Legend — aggregate v0.7 (no min/max) — single-value fallback', () => {
  it('showLastWhenIdle=true → shows last-bucket value', () => {
    renderLegend([1], makeDataV7(), vi.fn(), { showLastWhenIdle: true });
    expect(screen.getByText('50 °C')).toBeTruthy();
  });

  it('showLastWhenIdle=false → shows em-dash placeholder', () => {
    renderLegend([1], makeDataV7(), vi.fn(), { showLastWhenIdle: false });
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('cursorTsMs in bucket 1 → shows that bucket value', () => {
    // bucket 1 covers [1000, 2000); value[1]=20 → "20 °C"
    renderLegend([1], makeDataV7(), vi.fn(), { cursorTsMs: 1500, showLastWhenIdle: false });
    expect(screen.getByText('20 °C')).toBeTruthy();
  });
});

// ── v0.8 aggregate: max-only display ─────────────────────────────────────────

describe('Legend — aggregate v0.8 (with min/max bands)', () => {
  it('showLastWhenIdle=true → shows last-bucket max with unit', () => {
    renderLegend([1], makeDataV8(), vi.fn(), { showLastWhenIdle: true });
    // Last bucket: max[4]=52 → "52 °C"
    expect(screen.getByText('52 °C')).toBeTruthy();
  });

  it('showLastWhenIdle=false → shows em-dash placeholder', () => {
    renderLegend([1], makeDataV8(), vi.fn(), { showLastWhenIdle: false });
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('cursorTsMs in bucket 1 → shows max at that bucket', () => {
    // bucket 1 covers [1000, 2000); max[1]=22 → "22 °C"
    renderLegend([1], makeDataV8(), vi.fn(), { cursorTsMs: 1500, showLastWhenIdle: false });
    expect(screen.getByText('22 °C')).toBeTruthy();
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
    expect(screen.getByText('5 °C')).toBeTruthy();
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
    expect(screen.getByText('50 °C')).toBeTruthy();
  });

  it('showLastWhenIdle=false → shows em-dash', () => {
    renderLegend([1], makeRawData(), vi.fn(), { showLastWhenIdle: false });
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('cursorTsMs at sample ts → shows that sample value', () => {
    // cursorTsMs=2000 → LOCF → ts[2]=2000n → value=30 → "30 °C"
    renderLegend([1], makeRawData(), vi.fn(), { cursorTsMs: 2000, showLastWhenIdle: false });
    expect(screen.getByText('30 °C')).toBeTruthy();
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
    expect(screen.getByText('20 °C')).toBeTruthy();
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
    expect(screen.getByText('30 °C')).toBeTruthy();
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
    expect(screen.getByText('10 °C')).toBeTruthy();
  });

  it('multi-tag: cursor at ts=3000 shows LOCF value for tag1', () => {
    // tag1's last sample ≤ 3000n is ts=2000n → value 30
    renderLegend([1, 2], makeRawDataMultiTag(), vi.fn(), { cursorTsMs: 3000, showLastWhenIdle: false });
    expect(screen.getByText('30 °C')).toBeTruthy();
  });

  it('multi-tag: cursor at ts=0 shows em-dash for tag2 (no tag2 data at or before ts=0)', () => {
    // tag2's first sample is ts=1000n > 0n → not seeded → "—"
    // tag1 shows "10 °C"
    renderLegend([1, 2], makeRawDataMultiTag(), vi.fn(), { cursorTsMs: 0, showLastWhenIdle: false });
    expect(screen.getByText('10 °C')).toBeTruthy();
    expect(screen.getByText('—')).toBeTruthy();
  });

  it('multi-tag: cursor at ts=2000 shows LOCF 100 kW for tag2', () => {
    // tag2's last sample ≤ 2000n is ts=1000n → value 100
    renderLegend([1, 2], makeRawDataMultiTag(), vi.fn(), { cursorTsMs: 2000, showLastWhenIdle: false });
    expect(screen.getByText('100 kW')).toBeTruthy();
  });

  // makeRawDataWithPrev: ts=[1000n, 3000n], value=[20, 40], prev={ts: 0n, value: 5}

  it('prev seed: cursor at prev.ts shows prev value', () => {
    // cursorTsMs=0 → prev.ts=0n ≤ 0n → seeds 5; ts[0]=1000n > 0n → stop → "5 °C"
    renderLegend([1], makeRawDataWithPrev(), vi.fn(), { cursorTsMs: 0, showLastWhenIdle: false });
    expect(screen.getByText('5 °C')).toBeTruthy();
  });

  it('prev seed: cursor at first COV ts shows first COV value', () => {
    // cursorTsMs=1000 → prev seeds 5; ts[0]=1000n ≤ 1000n → lastVal=20 → "20 °C"
    renderLegend([1], makeRawDataWithPrev(), vi.fn(), { cursorTsMs: 1000, showLastWhenIdle: false });
    expect(screen.getByText('20 °C')).toBeTruthy();
  });

  it('prev seed: cursor at last COV ts shows last COV value', () => {
    // cursorTsMs=3000 → prev seeds 5; ts[0]=1000n→20; ts[1]=3000n→40 → "40 °C"
    renderLegend([1], makeRawDataWithPrev(), vi.fn(), { cursorTsMs: 3000, showLastWhenIdle: false });
    expect(screen.getByText('40 °C')).toBeTruthy();
  });
});

// ── Aggregate — bucket boundary resolution (cursorTsMs) ──────────────────────

describe('Legend — aggregate — bucket boundary resolution', () => {
  // makeDataV8: startTime=0n, bucketSMs=1000, n=5
  // max=[12, 22, 32, 42, 52]

  it('cursor just before boundary → resolves to left bucket', () => {
    // cursorTsMs=999 → bucketIdx=floor(999/1000)=0 → max[0]=12 → "12 °C"
    renderLegend([1], makeDataV8(), vi.fn(), { cursorTsMs: 999, showLastWhenIdle: false });
    expect(screen.getByText('12 °C')).toBeTruthy();
  });

  it('cursor exactly at boundary → resolves to right bucket', () => {
    // cursorTsMs=1000 → bucketIdx=floor(1000/1000)=1 → max[1]=22 → "22 °C"
    renderLegend([1], makeDataV8(), vi.fn(), { cursorTsMs: 1000, showLastWhenIdle: false });
    expect(screen.getByText('22 °C')).toBeTruthy();
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
    expect(screen.getByText('20 °C')).toBeTruthy();
  });

  it('Bug 1: active tag still resolves correctly alongside quiet tag', () => {
    // At cursorTsMs=1500, tag2's LOCF from ts=500n → value 100 → "100 kW".
    renderLegend([1, 2], makeRawDataStepAndActive(), vi.fn(), { cursorTsMs: 1500, showLastWhenIdle: false });
    expect(screen.getByText('100 kW')).toBeTruthy();
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
    expect(screen.getByText('5 °C')).toBeTruthy();
  });

  it('Bug 2: prev-only flat tag shows prev value up to the union max', () => {
    // Cursor at union max (2000ms). Tag 1 LOCF = 5; tag 2 LOCF = 200.
    renderLegend([1, 2], makeRawDataPrevOnlyFlat(), vi.fn(), { cursorTsMs: 2000, showLastWhenIdle: false });
    expect(screen.getByText('5 °C')).toBeTruthy();
    expect(screen.getByText('200 kW')).toBeTruthy();
  });

  it('Bug 2: prev-only flat tag shows em-dash when cursor is past union max', () => {
    // cursorTsMs=2500 > unionMax=2000ms → '—' for both.
    renderLegend([1, 2], makeRawDataPrevOnlyFlat(), vi.fn(), { cursorTsMs: 2500, showLastWhenIdle: false });
    expect(screen.getAllByText('—')).toHaveLength(2);
  });
});
