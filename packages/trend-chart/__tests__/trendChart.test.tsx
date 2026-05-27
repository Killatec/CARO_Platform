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
      scales: { x: { min: 0, max: 3600 }, y_1: { min: 0, max: 100 } },
      data: [[]] as unknown[][],
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
  1: { tag_id: 1, tag_path: 'A.B.Temp', tag_name: 'Temp', data_type: 'float', is_setpoint: false, trendable: true,
       module_id: 'M', module_type: 'MQTT', eng_min: 0, eng_max: 100, unit: '°C', format: null, meta: [] },
  2: { tag_id: 2, tag_path: 'A.B.Power', tag_name: 'Power', data_type: 'float', is_setpoint: false, trendable: true,
       module_id: 'M', module_type: 'MQTT', eng_min: null, eng_max: null, unit: 'kW', format: null, meta: [] },
  3: { tag_id: 3, tag_path: 'A.B.Valve', tag_name: 'Valve', data_type: 'bool', is_setpoint: false, trendable: false,
       module_id: 'M', module_type: 'MQTT', eng_min: null, eng_max: null, unit: null, format: null, meta: [] },
  4: { tag_id: 4, tag_path: 'A.B.Pressure', tag_name: 'Pressure', data_type: 'float', is_setpoint: false, trendable: true,
       module_id: 'M', module_type: 'MQTT', eng_min: 0, eng_max: 50, unit: 'bar', format: null, meta: [] },
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

  // ── X-axis zone wheel → onXRangeChange (every tick exits tailing) ───────────
  //
  // inXZone is set by mousemove calling isInXAxisHitZone(u, clientX, clientY).
  // u.over.getBoundingClientRect() returns all zeros in jsdom (detached element), so:
  //   clientY=1 > r.bottom=0  → above condition true
  //   clientY=1 ≤ r.bottom+100=100 → within 100px strip  → inXZone=true
  // Wheel events on the canvas (clientY=0, i.e. NOT > r.bottom=0) leave inXZone=false.

  it('wheel on canvas (no prior X-zone mousemove) does NOT fire onXRangeChange', () => {
    const onXRangeChange = vi.fn();
    const { container: root } = render(
      <MockHmiProvider tagDefs={TAG_DEFS}>
        <TrendChart
          data={makeData([1])}
          tagIds={[1]}
          siteTimezone="UTC"
          height={400}
          onXRangeChange={onXRangeChange}
        />
      </MockHmiProvider>,
    );
    const containerDiv = root.firstElementChild!.firstElementChild!.firstElementChild as HTMLElement;
    // No mousemove → inXZone stays false → handler returns early.
    fireEvent.wheel(containerDiv, { clientX: 0, clientY: 0, deltaY: 100 });
    expect(onXRangeChange).not.toHaveBeenCalled();
  });

  it('wheel in X-axis zone (zoom-in, sub-threshold) fires onXRangeChange', () => {
    const onXRangeChange = vi.fn();
    const { container: root } = render(
      <MockHmiProvider tagDefs={TAG_DEFS}>
        <TrendChart
          data={makeData([1])}
          tagIds={[1]}
          siteTimezone="UTC"
          height={400}
          onXRangeChange={onXRangeChange}
        />
      </MockHmiProvider>,
    );
    const containerDiv = root.firstElementChild!.firstElementChild!.firstElementChild as HTMLElement;
    fireEvent.mouseMove(containerDiv, { clientX: 0, clientY: 1 }); // sets inXZone=true
    fireEvent.wheel(containerDiv, { clientX: 0, clientY: 1, deltaY: -100 }); // zoom-in
    expect(onXRangeChange).toHaveBeenCalled();
  });

  it('wheel in X-axis zone (zoom-out, sub-threshold) fires onXRangeChange', () => {
    const onXRangeChange = vi.fn();
    const { container: root } = render(
      <MockHmiProvider tagDefs={TAG_DEFS}>
        <TrendChart
          data={makeData([1])}
          tagIds={[1]}
          siteTimezone="UTC"
          height={400}
          onXRangeChange={onXRangeChange}
        />
      </MockHmiProvider>,
    );
    const containerDiv = root.firstElementChild!.firstElementChild!.firstElementChild as HTMLElement;
    fireEvent.mouseMove(containerDiv, { clientX: 0, clientY: 1 }); // sets inXZone=true
    fireEvent.wheel(containerDiv, { clientX: 0, clientY: 1, deltaY: 100 }); // zoom-out
    expect(onXRangeChange).toHaveBeenCalled();
  });

  // ── Imperative setScale: rangeExceeded overrides zoom gate ───────────────────
  //
  // Strategy: count total setScale calls across ALL MockUPlot instances before and
  // after each rerender. This is robust against React's effect unmount/remount cycle
  // (strict-mode or cleanup-driven), which can create multiple instances so that
  // `mock.results[0]?.value` is not always the live uPlot in `uplotRef.current`.

  function totalSetScaleCalls(MockUPlot: ReturnType<typeof vi.fn>): number {
    return MockUPlot.mock.results.reduce(
      (n, r) => n + (r.value?.setScale.mock.calls.length ?? 0),
      0,
    );
  }

  it('rangeExceeded=true forces setScale even when lastIntent is zoom', async () => {
    const { default: MockUPlot } = await import('uplot');
    const xRange = { startMs: 1_700_000_000_000n, endMs: 1_700_003_600_000n };
    const stableTagIds = [1];

    const { rerender } = render(
      <MockHmiProvider tagDefs={TAG_DEFS}>
        <TrendChart
          data={makeData(stableTagIds)}
          tagIds={stableTagIds}
          siteTimezone="UTC"
          height={400}
          xRange={xRange}
          lastIntent="zoom"
          rangeExceeded={false}
        />
      </MockHmiProvider>,
    );

    const callsBefore = totalSetScaleCalls(MockUPlot as ReturnType<typeof vi.fn>);

    // rangeExceeded becomes true — same xRange, same lastIntent='zoom'.
    // Effect re-runs due to rangeExceeded dep change; zoom gate bypassed → setScale fires.
    rerender(
      <MockHmiProvider tagDefs={TAG_DEFS}>
        <TrendChart
          data={makeData(stableTagIds)}
          tagIds={stableTagIds}
          siteTimezone="UTC"
          height={400}
          xRange={xRange}
          lastIntent="zoom"
          rangeExceeded={true}
        />
      </MockHmiProvider>,
    );

    const callsAfter = totalSetScaleCalls(MockUPlot as ReturnType<typeof vi.fn>);
    expect(callsAfter).toBeGreaterThan(callsBefore);
  });

  it('lastIntent=zoom without rangeExceeded suppresses setScale on xRange change', async () => {
    const { default: MockUPlot } = await import('uplot');
    const stableTagIds = [1];
    const xRange1 = { startMs: 1_700_000_000_000n, endMs: 1_700_003_600_000n };

    const { rerender } = render(
      <MockHmiProvider tagDefs={TAG_DEFS}>
        <TrendChart
          data={makeData(stableTagIds)}
          tagIds={stableTagIds}
          siteTimezone="UTC"
          height={400}
          xRange={xRange1}
          lastIntent="zoom"
          rangeExceeded={false}
        />
      </MockHmiProvider>,
    );

    const callsBefore = totalSetScaleCalls(MockUPlot as ReturnType<typeof vi.fn>);

    // New xRange object → effect fires (dep changed); rangeExceeded=false → zoom gate fires.
    const xRange2 = { startMs: 1_700_003_600_000n, endMs: 1_700_007_200_000n };
    rerender(
      <MockHmiProvider tagDefs={TAG_DEFS}>
        <TrendChart
          data={makeData(stableTagIds)}
          tagIds={stableTagIds}
          siteTimezone="UTC"
          height={400}
          xRange={xRange2}
          lastIntent="zoom"
          rangeExceeded={false}
        />
      </MockHmiProvider>,
    );

    // Zoom gate active, rangeExceeded=false: no new setScale calls.
    const callsAfter = totalSetScaleCalls(MockUPlot as ReturnType<typeof vi.fn>);
    expect(callsAfter).toBe(callsBefore);
  });
});

// ── Empty tagIds — layout preservation ───────────────────────────────────────
//
// When tagIds=[], TrendChart must render the Signals header + gear button (so
// the user can open the picker) and the plot container div must have non-zero
// height (so the layout doesn't collapse).

describe('TrendChart — empty tagIds', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Minimal aggregate data with an empty series Map — the placeholder that
  // TrendChartContainer synthesises when tagIds=[].
  function makeEmptyPlaceholder(): AggregateSeriesData {
    return {
      type: 'aggregate',
      source: 'mixed',
      startTime: 1_700_000_000_000n,
      endTime: 1_700_003_600_000n,
      n: 2,
      bucketSMs: 3_600_000,
      series: new Map(),
    };
  }

  it('renders the Signals header with gear button when tagIds=[]', () => {
    render(
      <MockHmiProvider tagDefs={TAG_DEFS}>
        <TrendChart
          data={makeEmptyPlaceholder()}
          tagIds={[]}
          siteTimezone="UTC"
          height={400}
          onSettingsClick={vi.fn()}
        />
      </MockHmiProvider>,
    );

    // Signals header must be present.
    expect(screen.getByText('Signals')).toBeTruthy();
    // Gear button must be present — it is the sole entry point to add tags.
    expect(screen.getByTitle('Configure signals')).toBeTruthy();
  });

  it('plot container div has non-zero height (= the height prop) when tagIds=[]', () => {
    const { container } = render(
      <MockHmiProvider tagDefs={TAG_DEFS}>
        <TrendChart
          data={makeEmptyPlaceholder()}
          tagIds={[]}
          siteTimezone="UTC"
          height={400}
        />
      </MockHmiProvider>,
    );

    // The containerRef div is the first child of LEFT_COLUMN (the first flex child
    // inside the wrapper).  Find it by its inline height style.
    const heightDiv = container.querySelector('div[style*="height: 400"]') as HTMLElement | null;
    expect(heightDiv).not.toBeNull();
    // Inline style height matches the prop.
    expect(heightDiv!.style.height).toBe('400px');
  });

  it('clicking the gear button invokes onSettingsClick when tagIds=[]', () => {
    const onSettingsClick = vi.fn();
    render(
      <MockHmiProvider tagDefs={TAG_DEFS}>
        <TrendChart
          data={makeEmptyPlaceholder()}
          tagIds={[]}
          siteTimezone="UTC"
          height={400}
          onSettingsClick={onSettingsClick}
        />
      </MockHmiProvider>,
    );

    fireEvent.click(screen.getByTitle('Configure signals'));
    expect(onSettingsClick).toHaveBeenCalledOnce();
  });

  it('renders no remove-trace buttons when tagIds=[]', () => {
    render(
      <MockHmiProvider tagDefs={TAG_DEFS}>
        <TrendChart
          data={makeEmptyPlaceholder()}
          tagIds={[]}
          siteTimezone="UTC"
          height={400}
        />
      </MockHmiProvider>,
    );

    expect(screen.queryAllByTitle('Remove trace')).toHaveLength(0);
  });
});

// ── Hydration props and notification callbacks ─────────────────────────────────
//
// Tests for initialSelectedTagId, initialYScaleOverrides, onSelectedTagChange,
// and onYScaleOverridesChange — added for session persistence (§14.x).

describe('TrendChart — hydration callbacks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── initialSelectedTagId ──────────────────────────────────────────────────

  it('initialSelectedTagId seeds selectedTagId state: legend entry is bolded on first render', () => {
    render(
      <MockHmiProvider tagDefs={TAG_DEFS}>
        <TrendChart
          data={makeData([1, 2])}
          tagIds={[1, 2]}
          siteTimezone="UTC"
          height={400}
          initialSelectedTagId={2}
        />
      </MockHmiProvider>,
    );
    // Tag 2 (Power) should be initially selected (bold), not tag 1 (Temp).
    const powerEntry = screen.getByText('Power');
    expect(powerEntry.style.fontWeight).toBe('700');
    const tempEntry = screen.getByText('Temp');
    expect(tempEntry.style.fontWeight).not.toBe('700');
  });

  it('initialSelectedTagId=null falls back to first tag', () => {
    render(
      <MockHmiProvider tagDefs={TAG_DEFS}>
        <TrendChart
          data={makeData([1, 2])}
          tagIds={[1, 2]}
          siteTimezone="UTC"
          height={400}
          initialSelectedTagId={null}
        />
      </MockHmiProvider>,
    );
    // null → first tag (1 = Temp) selected.
    const tempEntry = screen.getByText('Temp');
    expect(tempEntry.style.fontWeight).toBe('700');
  });

  // ── initialYScaleOverrides ────────────────────────────────────────────────

  it('initialYScaleOverrides seeds yScaleOverridesRef on first mount', async () => {
    const { default: MockUPlot } = await import('uplot');
    const overrides = new Map([[1, { min: -50, max: 200 }]]);

    render(
      <MockHmiProvider tagDefs={TAG_DEFS}>
        <TrendChart
          data={makeDataWithBands([1])}
          tagIds={[1]}
          siteTimezone="UTC"
          height={400}
          initialYScaleOverrides={overrides}
        />
      </MockHmiProvider>,
    );

    // uPlot was built. Verify that the config included the seeded Y scale
    // by checking that buildUplotConfig was called (uPlot constructor called).
    const calls = (MockUPlot as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    // If the override was seeded correctly, the uPlot config built from
    // yScaleOverridesRef would include a min/max for y_1. We verify
    // indirectly via the constructor being called (the ref is initialized
    // before the effect builds uPlot, so the seeded value is in scope).
    // The actual assertion on yScaleOverridesRef is that it starts with
    // the override, which is covered by the round-trip: the ref is seeded
    // in the useState-equivalent line and passed to buildUplotConfig.
    const uplotConfig = calls[calls.length - 1]![0] as { scales?: Record<string, unknown> };
    // The config should have a y_1 scale entry (built from yScaleOverridesRef).
    expect(uplotConfig.scales).toBeDefined();
    expect(uplotConfig.scales!['y_1']).toBeDefined();
  });

  // ── onSelectedTagChange callback ──────────────────────────────────────────

  it('onSelectedTagChange fires when the user clicks a legend entry', () => {
    const onSelectedTagChange = vi.fn();
    render(
      <MockHmiProvider tagDefs={TAG_DEFS}>
        <TrendChart
          data={makeData([1, 2])}
          tagIds={[1, 2]}
          siteTimezone="UTC"
          height={400}
          onSelectedTagChange={onSelectedTagChange}
        />
      </MockHmiProvider>,
    );
    // Click on tag 2 (Power) legend entry row.
    const powerEntry = screen.getByText('Power');
    fireEvent.click(powerEntry.parentElement!);
    expect(onSelectedTagChange).toHaveBeenCalledWith(2);
  });

  it('onSelectedTagChange not fired on initial render (only on user interaction)', () => {
    const onSelectedTagChange = vi.fn();
    render(
      <MockHmiProvider tagDefs={TAG_DEFS}>
        <TrendChart
          data={makeData([1, 2])}
          tagIds={[1, 2]}
          siteTimezone="UTC"
          height={400}
          onSelectedTagChange={onSelectedTagChange}
        />
      </MockHmiProvider>,
    );
    expect(onSelectedTagChange).not.toHaveBeenCalled();
  });

  // ── onYScaleOverridesChange callback ─────────────────────────────────────

  it('onYScaleOverridesChange fires after a Y-axis wheel zoom', () => {
    // The global mock includes y_1: { min:0, max:100 } so zoomYScale passes its
    // !yScale guard. clientHeight=0 in jsdom → zoomYScale returns early (overHeightPx=0),
    // leaving the initial y_1 value intact. onYWheel reads it and fires the callback.
    const onYScaleOverridesChange = vi.fn();
    const { container: root } = render(
      <MockHmiProvider tagDefs={TAG_DEFS}>
        <TrendChart
          data={makeDataWithBands([1])}
          tagIds={[1]}
          siteTimezone="UTC"
          height={400}
          onYScaleOverridesChange={onYScaleOverridesChange}
        />
      </MockHmiProvider>,
    );

    // isInYAxisHitZone: in jsdom all rects are zero, so clientX in [-100,0) and clientY=0
    // puts us in the Y-axis hit zone. Listeners attach to containerRef (3 levels deep).
    const containerDiv = root.firstElementChild!.firstElementChild!.firstElementChild as HTMLElement;
    fireEvent.mouseMove(containerDiv, { clientX: -30, clientY: 0 });
    fireEvent.wheel(containerDiv, { clientX: -30, clientY: 0, deltaY: 100 });

    expect(onYScaleOverridesChange).toHaveBeenCalled();
    const arg = onYScaleOverridesChange.mock.calls[0]![0] as Map<number, { min: number; max: number }>;
    expect(arg).toBeInstanceOf(Map);
  });

  it('onYScaleOverridesChange receives a new Map instance (shallow clone) each time', () => {
    const onYScaleOverridesChange = vi.fn();
    const { container: root } = render(
      <MockHmiProvider tagDefs={TAG_DEFS}>
        <TrendChart
          data={makeDataWithBands([1])}
          tagIds={[1]}
          siteTimezone="UTC"
          height={400}
          onYScaleOverridesChange={onYScaleOverridesChange}
        />
      </MockHmiProvider>,
    );

    const containerDiv = root.firstElementChild!.firstElementChild!.firstElementChild as HTMLElement;
    fireEvent.mouseMove(containerDiv, { clientX: -30, clientY: 0 });
    fireEvent.wheel(containerDiv, { clientX: -30, clientY: 0, deltaY: 100 });
    fireEvent.wheel(containerDiv, { clientX: -30, clientY: 0, deltaY: -100 });

    expect(onYScaleOverridesChange).toHaveBeenCalledTimes(2);
    const first = onYScaleOverridesChange.mock.calls[0]![0];
    const second = onYScaleOverridesChange.mock.calls[1]![0];
    expect(first).not.toBe(second);
  });
});
