import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MockHmiProvider } from '@caro/hmi-context';
import type { TagDef } from '@caro/hmi-context';
import { TrendChart } from '../src/TrendChart.js';
import type { AggregateSeriesData, RawSeriesData } from '../src/types.js';

// ── uPlot mock (canvas not available in jsdom) ────────────────────────────────

vi.mock('uplot', () => {
  const MockUPlot = vi.fn().mockImplementation(() => {
    const over = document.createElement('div');
    return {
      destroy: vi.fn(),
      setData: vi.fn(),
      redraw: vi.fn(),
      setScale: vi.fn(),
      scales: { x: { min: 0, max: 3600 } },
      over,
    };
  });
  (MockUPlot as unknown as Record<string, unknown>).paths = {
    stepped: vi.fn(() => vi.fn()),
  };
  return { default: MockUPlot };
});

// uPlot CSS — no-op in test env
vi.mock('uplot/dist/uPlot.min.css', () => ({}));

// ── Fixture helpers ───────────────────────────────────────────────────────────

const TAG_DEFS: Record<number, TagDef> = {
  1: { tag_id: 1, tag_path: 'A.B.Temp', data_type: 'float', is_setpoint: false,
       module_id: 'M', module_type: 'MQTT', eng_min: 0, eng_max: 100, unit: '°C', meta: [] },
  2: { tag_id: 2, tag_path: 'A.B.Power', data_type: 'float', is_setpoint: false,
       module_id: 'M', module_type: 'MQTT', eng_min: null, eng_max: null, unit: 'kW', meta: [] },
  3: { tag_id: 3, tag_path: 'A.B.Valve', data_type: 'bool', is_setpoint: false,
       module_id: 'M', module_type: 'MQTT', eng_min: null, eng_max: null, unit: null, meta: [] },
  4: { tag_id: 4, tag_path: 'A.B.Pressure', data_type: 'float', is_setpoint: false,
       module_id: 'M', module_type: 'MQTT', eng_min: 0, eng_max: 50, unit: 'bar', meta: [] },
};

// v0.7-style aggregate data (no min/max) — triggers v0.7 legend fallback.
function makeData(tagIds: number[] = [1, 2, 3, 4]): AggregateSeriesData {
  const n = 10;
  return {
    type: 'aggregate',
    source: '1min_cagg',
    startTime: 0n,
    endTime: BigInt(n * 1000),
    n,
    bucketSMs: 1000,
    series: new Map(tagIds.map(id => [id, { value: new Array(n).fill(id * 1.0) }])),
  };
}

// v0.8-style aggregate data with min/max bands.
function makeDataWithBands(tagIds: number[] = [1, 2]): AggregateSeriesData {
  const n = 5;
  return {
    type: 'aggregate',
    source: '1min_cagg',
    startTime: 0n,
    endTime: BigInt(n * 1000),
    n,
    bucketSMs: 1000,
    series: new Map(tagIds.map(id => [id, {
      value: new Array(n).fill(id * 1.0),
      min:   new Array(n).fill(id * 1.0 - 0.5),
      max:   new Array(n).fill(id * 1.0 + 0.5),
    }])),
  };
}

function makeRawData(tagIds: number[] = [1]): RawSeriesData {
  return {
    type: 'raw',
    source: 'raw',
    startTime: 0n,
    endTime: 3_000n,
    series: new Map(tagIds.map(id => [id, { ts: [0n, 1000n, 2000n], value: [1.0, 2.0, null] }])),
  };
}

function renderChart(tagIds: number[] = [1, 2, 3, 4], data = makeData(tagIds), onTagRemove?: (id: number) => void) {
  return render(
    <MockHmiProvider tagDefs={TAG_DEFS}>
      <TrendChart
        data={data}
        tagIds={tagIds}
        siteTimezone="UTC"
        height={400}
        onTagRemove={onTagRemove}
      />
    </MockHmiProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TrendChart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders 4 legend entries when given 4 tagIds', () => {
    renderChart();
    expect(screen.getByText('Temp')).toBeTruthy();
    expect(screen.getByText('Power')).toBeTruthy();
    expect(screen.getByText('Valve')).toBeTruthy();
    expect(screen.getByText('Pressure')).toBeTruthy();
  });

  it('first tag is selected by default (legend entry is bolded)', () => {
    renderChart([1, 2]);
    const tempEntry = screen.getByText('Temp');
    expect(tempEntry.style.fontWeight).toBe('700');
    const powerEntry = screen.getByText('Power');
    expect(powerEntry.style.fontWeight).not.toBe('700');
  });

  it('clicking a legend entry changes selection', () => {
    renderChart([1, 2]);
    const powerEntry = screen.getByText('Power');
    fireEvent.click(powerEntry.parentElement!);
    expect(powerEntry.style.fontWeight).toBe('700');
  });

  it('clicking the remove button calls onTagRemove with the correct tagId', () => {
    const onTagRemove = vi.fn();
    renderChart([1, 2], makeData([1, 2]), onTagRemove);
    const removeButtons = screen.getAllByTitle('Remove trace');
    fireEvent.click(removeButtons[0]!);
    expect(onTagRemove).toHaveBeenCalledWith(1);
  });

  it('boolean tag current value formats as "0" or "1" in legend (v0.7 fallback)', () => {
    // Tag 3 is bool, no min/max → v0.7 fallback shows single value.
    // value=3.0 (truthy) → "1"
    const data = makeData([3]);
    renderChart([3], data);
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('renders footer node inside the left column, not as a sibling of Legend', () => {
    render(
      <MockHmiProvider tagDefs={TAG_DEFS}>
        <TrendChart
          data={makeData([1, 2])}
          tagIds={[1, 2]}
          siteTimezone="UTC"
          height={400}
          footer={<div data-testid="chart-footer">footer content</div>}
        />
      </MockHmiProvider>,
    );
    const footer = screen.getByTestId('chart-footer');
    expect(footer).toBeTruthy();
    const [removeBtn] = screen.getAllByTitle('Remove trace');
    expect(footer.parentElement?.contains(removeBtn!)).toBe(false);
  });

  // ── Band rendering (aggregate) ────────────────────────────────────────────

  it('aggregate v0.8: uPlot receives interleaved min/max arrays (not value arrays)', async () => {
    const { default: MockUPlot } = await import('uplot');
    const data = makeDataWithBands([1]);
    renderChart([1], data);

    const calls = (MockUPlot as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const uplotData = calls[calls.length - 1]![1] as unknown[][];

    // uplotData[1] = mins[0], uplotData[2] = maxs[0]
    const mins = uplotData[1] as (number | null)[];
    const maxs = uplotData[2] as (number | null)[];
    expect(mins).toEqual(new Array(5).fill(0.5));   // id*1.0 - 0.5 = 0.5 for id=1
    expect(maxs).toEqual(new Array(5).fill(1.5));   // id*1.0 + 0.5 = 1.5 for id=1
  });

  it('aggregate v0.8: null values in min/max bands are passed through to uPlot', async () => {
    const { default: MockUPlot } = await import('uplot');
    const dataWithNulls: AggregateSeriesData = {
      type: 'aggregate',
      source: '1min_cagg',
      startTime: 0n,
      endTime: 3_000n,
      n: 3,
      bucketSMs: 1000,
      series: new Map([[1, { value: [1.0, null, 3.0], min: [0.5, null, 2.5], max: [1.5, null, 3.5] }]]),
    };
    renderChart([1], dataWithNulls);
    const calls = (MockUPlot as ReturnType<typeof vi.fn>).mock.calls;
    const uplotData = calls[calls.length - 1]![1] as unknown[][];
    const mins = uplotData[1] as (number | null)[];
    expect(mins).toContain(null);
  });

  it('aggregate v0.7 (no min/max): band arrays are null-filled', async () => {
    const { default: MockUPlot } = await import('uplot');
    const data = makeData([1]);  // no min/max
    renderChart([1], data);
    const calls = (MockUPlot as ReturnType<typeof vi.fn>).mock.calls;
    const uplotData = calls[calls.length - 1]![1] as unknown[][];
    // mins[0] should be all-null (mixed-cache guard)
    const mins = uplotData[1] as (number | null)[];
    expect(mins.every(v => v === null)).toBe(true);
  });

  it('raw mode: uPlot receives mins === maxs (same reference) — zero-area band', async () => {
    const { default: MockUPlot } = await import('uplot');
    const rawData = makeRawData([1]);
    renderChart([1], rawData);
    const calls = (MockUPlot as ReturnType<typeof vi.fn>).mock.calls;
    const uplotData = calls[calls.length - 1]![1] as unknown[][];
    // Raw always-band: uplotData[1] = mins[0], uplotData[2] = maxs[0].
    // They are the same array reference (zero-area band).
    const mins = uplotData[1] as (number | null)[];
    const maxs = uplotData[2] as (number | null)[];
    expect(mins).toBe(maxs); // same reference
    // ts=[0n,1000n,2000n], value=[1.0,2.0,null] — forward-filled values
    expect(mins).toEqual([1.0, 2.0, null]);
  });

  it('data.type flip (aggregate → raw) does NOT trigger uPlot destroy/recreate', async () => {
    const { default: MockUPlot } = await import('uplot');
    const aggData = makeDataWithBands([1]);
    // Stable tagIds reference — avoids rebuild from tagIds reference-equality change.
    const stableTagIds = [1];
    const { rerender } = render(
      <MockHmiProvider tagDefs={TAG_DEFS}>
        <TrendChart data={aggData} tagIds={stableTagIds} siteTimezone="UTC" height={400} />
      </MockHmiProvider>,
    );
    const callsAfterFirst = (MockUPlot as ReturnType<typeof vi.fn>).mock.calls.length;

    // Switch to raw data (data.type: 'aggregate' → 'raw'), tagIds unchanged.
    const rawData = makeRawData([1]);
    rerender(
      <MockHmiProvider tagDefs={TAG_DEFS}>
        <TrendChart data={rawData} tagIds={stableTagIds} siteTimezone="UTC" height={400} />
      </MockHmiProvider>,
    );

    // uPlot constructor must NOT be called again — setData handles the mode flip.
    const callsAfterSwitch = (MockUPlot as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfterSwitch).toBe(callsAfterFirst);
  });
});
