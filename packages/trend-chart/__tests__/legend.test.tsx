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

function renderLegend(
  tagIds: number[] = [1],
  data: AggregateSeriesData | RawSeriesData = makeDataV7(),
  onRemove = vi.fn(),
  opts: { cursorIdx?: number; showLastWhenIdle?: boolean } = {},
) {
  return render(
    <MockHmiProvider tagDefs={TAG_DEFS}>
      <Legend
        tagIds={tagIds}
        data={data}
        tagMap={new Map([[1, TAG_DEFS[1]!], [2, TAG_DEFS[2]!]])}
        selectedTagId={tagIds[0] ?? 1}
        cursorIdx={opts.cursorIdx}
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

  it('cursorIdx defined → shows that bucket value', () => {
    // series for tag 1 = [10,20,30,40,50]; index 1 → 20 °C
    renderLegend([1], makeDataV7(), vi.fn(), { cursorIdx: 1, showLastWhenIdle: false });
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

  it('cursorIdx defined → shows max at that bucket', () => {
    // max[1]=22 → "22 °C"
    renderLegend([1], makeDataV8(), vi.fn(), { cursorIdx: 1, showLastWhenIdle: false });
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
    renderLegend([1], makeDataV8(), vi.fn(), { cursorIdx: 1, showLastWhenIdle: false });
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
    renderLegend([1], makeRawData(), vi.fn(), { cursorIdx: 2, showLastWhenIdle: false });
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

  it('cursorIdx defined → shows value at that cursor position', () => {
    renderLegend([1], makeRawData(), vi.fn(), { cursorIdx: 2, showLastWhenIdle: false });
    expect(screen.getByText('30 °C')).toBeTruthy();
  });
});
