import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MockHmiProvider } from '@caro/hmi-context';
import type { TagDef } from '@caro/hmi-context';
import { TrendChart } from '../src/TrendChart.js';
import type { AggregateSeriesData } from '../src/types.js';

// ── uPlot mock (canvas not available in jsdom) ────────────────────────────────

vi.mock('uplot', () => {
  const MockUPlot = vi.fn().mockImplementation(() => ({
    destroy: vi.fn(),
    setData: vi.fn(),
    redraw: vi.fn(),
  }));
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

function makeData(tagIds: number[] = [1, 2, 3, 4]): AggregateSeriesData {
  const n = 10;
  return {
    type: 'aggregate',
    source: '1min_cagg',
    startTime: 0n,
    endTime: BigInt(n * 1000),
    n,
    bucketSMs: 1000,
    series: new Map(tagIds.map(id => [id, new Array(n).fill(id * 1.0)])),
  };
}

function renderChart(tagIds: number[] = [1, 2, 3, 4], data = makeData(tagIds)) {
  return render(
    <MockHmiProvider tagDefs={TAG_DEFS}>
      <TrendChart data={data} tagIds={tagIds} siteTimezone="UTC" width={800} height={400} />
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
    // Each tag's short name (last segment of tag_path) appears in legend.
    expect(screen.getByText('Temp')).toBeTruthy();
    expect(screen.getByText('Power')).toBeTruthy();
    expect(screen.getByText('Valve')).toBeTruthy();
    expect(screen.getByText('Pressure')).toBeTruthy();
  });

  it('first tag is selected by default (legend entry is bolded)', () => {
    renderChart([1, 2]);
    const tempEntry = screen.getByText('Temp');
    // The name span for the selected entry has fontWeight 700.
    expect(tempEntry.style.fontWeight).toBe('700');
    const powerEntry = screen.getByText('Power');
    expect(powerEntry.style.fontWeight).not.toBe('700');
  });

  it('clicking a legend entry changes selection', () => {
    renderChart([1, 2]);
    const powerEntry = screen.getByText('Power');
    // Click the whole entry row (parent of the name span).
    fireEvent.click(powerEntry.parentElement!);
    // Now Power entry's name span should be bold.
    expect(powerEntry.style.fontWeight).toBe('700');
  });

  it('clicking the remove button removes the trace from legend', () => {
    renderChart([1, 2]);
    const removeButtons = screen.getAllByTitle('Remove trace');
    // Remove the first tag (Temp).
    fireEvent.click(removeButtons[0]!);
    expect(screen.queryByText('Temp')).toBeNull();
    expect(screen.getByText('Power')).toBeTruthy();
  });

  it('shows resolution indicator text', () => {
    renderChart();
    // bucketSMs=1000ms → bucketS=1s → "1 s buckets"
    expect(screen.getByText('1 s buckets')).toBeTruthy();
  });

  it('boolean tag current value formats as "0" or "1" in legend', () => {
    // Tag 3 is bool, value 3.0 → isBoolean → "1"
    const data = makeData([3]);
    renderChart([3], data);
    // The value in the legend entry should be "1" (since value=3.0 which is truthy→"1").
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('null values in series array are passed to uPlot data as-is (null preserved)', async () => {
    const { default: MockUPlot } = await import('uplot');
    const dataWithNulls: AggregateSeriesData = {
      type: 'aggregate',
      source: '1min_cagg',
      startTime: 0n,
      endTime: 3_000n,
      n: 3,
      bucketSMs: 1000,
      series: new Map([[1, [1.0, null, 3.0]]]),
    };
    renderChart([1], dataWithNulls);
    // uPlot constructor should have been called; the data passed should contain null.
    const calls = (MockUPlot as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const uplotData = calls[calls.length - 1]![1] as unknown[][];
    // ys[0] = data for tag 1; should include null.
    const ySeries = uplotData[1] as (number | null)[];
    expect(ySeries).toContain(null);
  });
});
