import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MockHmiProvider } from '@caro/hmi-context';
import type { TagDef } from '@caro/hmi-context';
import { TrendChartContainer } from '../src/TrendChartContainer.js';
import { computeDragZoomViewport } from '../src/useZoomState.js';
import { useTrendData } from '../src/useTrendData.js';
import { formatDateTime } from '@caro/ui';
import type { UseTrendDataResult } from '../src/useTrendData.js';
import { MIN_VIEWPORT_SPAN_MS, MAX_VIEWPORT_SPAN_MS } from '../src/level.js';
import { expectCallOrder } from './testUtils.js';

// ── useLiveSubscription mock (hoisted so vi.mock factory can close over it) ───

const liveHoisted = vi.hoisted(() => {
  const commitAndDrain = vi.fn();
  let _tail: unknown = null;
  let _lastOpts: Record<string, unknown> | null = null;
  let _snapshot: unknown = null;

  return {
    commitAndDrain,
    setTail: (t: unknown) => { _tail = t; },
    getTail: () => _tail,
    setLastOpts: (o: Record<string, unknown>) => { _lastOpts = o; },
    getLastOpts: () => _lastOpts,
    setSnapshot: (s: unknown) => { _snapshot = s; },
    getSnapshot: () => _snapshot,
  };
});

vi.mock('../src/useLiveSubscription.js', () => ({
  useLiveSubscription: vi.fn((opts: Record<string, unknown>) => {
    liveHoisted.setLastOpts(opts);
    return {
      tail: liveHoisted.getTail(),
      commitAndDrain: liveHoisted.commitAndDrain,
      getLatestSampleTs: vi.fn().mockReturnValue(null),
      getBufferSnapshot: vi.fn(() => liveHoisted.getSnapshot()),
      getCurrentGeneration: vi.fn().mockReturnValue(0),
      seedFromSpineFetch: vi.fn(),
    };
  }),
  TREND_RING_CAPACITY: 20,
}));

// ── TrendChart mock ───────────────────────────────────────────────────────────
// Renders the footer prop (so all footer-based assertions still work) and stub
// remove buttons (so the onTagRemove test still works). Captures onXRangeChange,
// onXPan, and onDragZoom for dispatch-path integration tests.

let capturedOnXRangeChange: ((min: bigint, max: bigint) => void) | undefined;
let capturedOnXPan: ((min: bigint, max: bigint) => void) | undefined;
let capturedOnDragZoom: ((startMs: bigint, endMs: bigint) => void) | undefined;
let capturedData: { startTime: bigint; endTime: bigint; n?: number; series?: Map<unknown, unknown> } | undefined;

vi.mock('../src/TrendChart.js', () => ({
  TrendChart: (props: {
    data?: { startTime: bigint; endTime: bigint; n?: number; series?: Map<unknown, unknown> };
    tagIds: number[];
    footer?: unknown;
    onTagRemove?: (id: number) => void;
    onXRangeChange?: (min: bigint, max: bigint) => void;
    onXPan?: (min: bigint, max: bigint) => void;
    onDragZoom?: (startMs: bigint, endMs: bigint) => void;
    showLastWhenIdle?: boolean;
    rangeExceeded?: boolean;
    rangeTooNarrow?: boolean;
  }) => {
    capturedOnXRangeChange = props.onXRangeChange;
    capturedOnXPan = props.onXPan;
    capturedOnDragZoom = props.onDragZoom;
    capturedData = props.data;
    return (
      <div>
        {props.tagIds.map(id => (
          <button key={id} title="Remove trace" onClick={() => props.onTagRemove?.(id)}>×</button>
        ))}
        <span data-testid="idle-mode">{props.showLastWhenIdle ? 'live' : 'fixed'}</span>
        {props.footer as React.ReactNode}
      </div>
    );
  },
}));

// ── useTrendData mock ─────────────────────────────────────────────────────────

vi.mock('../src/useTrendData.js', () => ({
  useTrendData: vi.fn(),
}));

const mockUseTrendData = vi.mocked(useTrendData);

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TAG_DEFS: Record<number, TagDef> = {
  1: { tag_id: 1, tag_path: 'A.B.Temp', data_type: 'float', is_setpoint: false,
       module_id: 'M', module_type: 'MQTT', eng_min: 0, eng_max: 100, unit: '°C', meta: [] },
  2: { tag_id: 2, tag_path: 'A.B.Power', data_type: 'float', is_setpoint: false,
       module_id: 'M', module_type: 'MQTT', eng_min: null, eng_max: null, unit: 'kW', meta: [] },
  3: { tag_id: 3, tag_path: 'A.B.Valve', data_type: 'bool', is_setpoint: false,
       module_id: 'M', module_type: 'MQTT', eng_min: null, eng_max: null, unit: null, meta: [] },
};

function makeAggData(tagIds: number[] = [1, 2]) {
  const n = 500;
  const baseVals = Array.from({ length: n }, (_, i) => i * 0.1);
  return {
    type: 'aggregate' as const,
    source: '1min_cagg' as const,
    startTime: 0n,
    endTime: BigInt(n * 3600),
    n,
    bucketSMs: 3600,
    series: new Map(tagIds.map(id => [id, {
      value: baseVals.map(v => v + id),
      min:   baseVals.map(v => v + id - 0.5),
      max:   baseVals.map(v => v + id + 0.5),
    }])),
  };
}

function makeResult(tagIds: number[], opts: Partial<UseTrendDataResult> = {}): UseTrendDataResult {
  return {
    data: makeAggData(tagIds),
    isLoading: false,
    error: null,
    ensureCovered: vi.fn(),
    getActiveRange: vi.fn().mockReturnValue(null),
    evictAll: vi.fn(),
    refetchHistory: vi.fn(),
    swapCounter: 0,
    activeTileCount: 0,
    lastFetchMs: null,
    responseTailTs: null,
    ...opts,
  };
}

function renderContainer(tagIds = [1, 2]) {
  return render(
    <MockHmiProvider tagDefs={TAG_DEFS}>
      <TrendChartContainer tagIds={tagIds} siteTimezone="UTC" height={400} />
    </MockHmiProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TrendChartContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    capturedOnXRangeChange = undefined;
    capturedOnXPan = undefined;
    capturedOnDragZoom = undefined;
    capturedData = undefined;
    liveHoisted.setTail(null);
    liveHoisted.setSnapshot(makeAggData([1, 2]));
    mockUseTrendData.mockReturnValue(makeResult([1, 2]));
    // EndPicker calls showPicker() on the hidden input; jsdom doesn't implement it.
    Object.defineProperty(HTMLInputElement.prototype, 'showPicker', {
      value: vi.fn(),
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders span preset buttons', () => {
    renderContainer();
    expect(screen.getByText('1m')).toBeTruthy();
    expect(screen.getByText('5m')).toBeTruthy();
    expect(screen.getByText('15m')).toBeTruthy();
    expect(screen.getByText('1h')).toBeTruthy();
    expect(screen.getByText('4h')).toBeTruthy();
    expect(screen.getByText('24h')).toBeTruthy();
    expect(screen.getByText('7d')).toBeTruthy();
    expect(screen.getByText('14d')).toBeTruthy();
  });

  it('renders Live button in initial tailing mode', () => {
    renderContainer();
    expect(screen.getByText('● Live')).toBeTruthy();
  });

  it('passes correct viewport and tagIds to useTrendData on first render', () => {
    renderContainer();
    expect(mockUseTrendData).toHaveBeenCalled();
    const lastCall = mockUseTrendData.mock.calls[mockUseTrendData.mock.calls.length - 1]!;
    const opts = lastCall[0];
    expect(opts.tagIds).toEqual([1, 2]);
    expect(opts.viewport).toBeDefined();
  });

  it('preset click resets dataViewport span to the new preset duration', () => {
    renderContainer([1]);
    const callsBefore = mockUseTrendData.mock.calls.length;

    fireEvent.click(screen.getByText('4h'));

    const calls = mockUseTrendData.mock.calls.slice(callsBefore);
    const expected4hMs = 4n * 60n * 60n * 1000n;
    const found = calls.some(([opts]) => {
      const span = opts.viewport.end - opts.viewport.start;
      return span === expected4hMs;
    });
    expect(found).toBe(true);
  });

  it('clicking preset changes active highlight', () => {
    renderContainer();
    const btn4h = screen.getByText('4h');
    fireEvent.click(btn4h);
    expect(btn4h.style.background).toBe('rgb(37, 99, 235)');
  });

  it('preset click in initial tailing mode → preset highlighted, others not', () => {
    renderContainer();
    fireEvent.click(screen.getByText('4h'));
    expect(screen.getByText('4h').style.background).toBe('rgb(37, 99, 235)');
    expect(screen.getByText('1h').style.background).not.toBe('rgb(37, 99, 235)');
  });

  it('preset click while in fixed mode → mode stays fixed, preset highlighted', () => {
    renderContainer([1]);
    // Commit a far-past End via the hidden picker input to enter fixed mode.
    const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2020-01-02T00:00:00' } });
    // Now in fixed mode — click 4h preset.
    fireEvent.click(screen.getByText('4h'));
    // Should show "Go Live" (still fixed), and 4h highlighted.
    expect(screen.getByText('Go Live')).toBeTruthy();
    expect(screen.getByText('4h').style.background).toBe('rgb(37, 99, 235)');
  });

  it('onTagRemove drops the tag from the list passed to useTrendData', () => {
    renderContainer([1, 2]);
    const removeButtons = screen.getAllByTitle('Remove trace');
    fireEvent.click(removeButtons[0]!);

    const calls = mockUseTrendData.mock.calls;
    const found = calls.some(([opts]) => opts.tagIds.length === 1 && opts.tagIds[0] === 2);
    expect(found).toBe(true);
  });

  it('shows loading hint when data is null and isLoading=true', () => {
    // In Live mode chart data comes from getBufferSnapshot(); null snapshot keeps chartData null.
    liveHoisted.setSnapshot(null);
    mockUseTrendData.mockReturnValue(makeResult([1, 2], { data: null, isLoading: true }));
    renderContainer();
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('shows no-tags hint when tagIds is empty', () => {
    liveHoisted.setSnapshot(null);
    mockUseTrendData.mockReturnValue(makeResult([], { data: null, isLoading: false }));
    renderContainer([]);
    expect(screen.getByText('No tags selected.')).toBeTruthy();
  });

  it('modeViewport over-range: shows range message in cursor row; chart and controls remain interactive', () => {
    renderContainer([1]);
    // Trigger over-range via zoom (modeViewport-derived path, not hook flag).
    const end = 1_700_000_000_000n;
    const start = end - (MAX_VIEWPORT_SPAN_MS + 1n);
    act(() => {
      capturedOnXRangeChange?.(start, end);
      vi.runAllTimers();
    });
    // Message text present in cursor row.
    expect(screen.getByText('Range too wide. Zoom in or pick a smaller preset.')).toBeTruthy();
    // TrendChart was rendered — mock emits × button per tagId.
    expect(screen.getByTitle('Remove trace')).toBeTruthy();
    // Footer controls accessible — operator can recover.
    expect(screen.getByText('1m')).toBeTruthy();
    // Zoom → fixed transition: "Go Live" (not "● Live").
    expect(screen.getByText('Go Live')).toBeTruthy();
  });

  it('modeViewport over-range: placeholderData uses modeViewport bounds with n=2 stub points', () => {
    // Trigger over-range via zoom (modeViewport-derived path). Uses a far-past
    // realistic timestamp (Nov 2023) — verifies placeholder startTime comes from
    // modeViewport, not a dataViewport that might saturate to 1n on aggressive
    // wheel-zoom-out.
    renderContainer([1]);
    const end = 1_700_000_000_000n;
    const start = end - (MAX_VIEWPORT_SPAN_MS + 1n);
    act(() => {
      capturedOnXRangeChange?.(start, end);
      vi.runAllTimers();
    });

    expect(capturedData).toBeDefined();
    // n=2 with one series entry per tagId — gives uPlot two x-values to auto-fit on.
    expect(capturedData!.n).toBe(2);
    expect(capturedData!.series!.size).toBe(1);
    // Bounds must match the zoom target (modeViewport), not a saturated dataViewport.
    expect(capturedData!.startTime).toBe(start);
    expect(capturedData!.endTime).toBe(end);
  });

  it('modeViewport over-range: placeholderData x-values span exactly modeViewport bounds', () => {
    // The x-values uPlot derives from AggregateSeriesData:
    //   xs[k] = startTime/1000 + k * (bucketSMs/1000)  (in seconds)
    // With n=2 and bucketSMs = Number(endTime - startTime):
    //   xs[0] = startTime/1000   (= modeViewport.start in seconds)
    //   xs[1] = endTime/1000     (= modeViewport.end in seconds)
    // uPlot auto-fits to this range, keeping the x-axis anchored at the
    // modeViewport rather than drifting to epoch.
    renderContainer([1]);
    const end = 1_700_000_000_000n;
    const start = end - (MAX_VIEWPORT_SPAN_MS + 1n);
    act(() => {
      capturedOnXRangeChange?.(start, end);
      vi.runAllTimers();
    });

    expect(capturedData).toBeDefined();
    const d = capturedData!;
    const startTimeMs = d.startTime;
    const endTimeMs   = d.endTime;
    const bucketSMs   = (d as { bucketSMs?: number }).bucketSMs!;
    // bucketSMs should equal the full span (endTime - startTime in ms).
    expect(BigInt(bucketSMs)).toBe(endTimeMs - startTimeMs);
    // Derived xs[0] and xs[1] in ms.
    const xs0Ms = startTimeMs;                     // k=0: startTime + 0 * bucketSMs
    const xs1Ms = startTimeMs + BigInt(bucketSMs); // k=1: startTime + 1 * bucketSMs = endTime
    expect(xs0Ms).toBe(startTimeMs);
    expect(xs1Ms).toBe(endTimeMs);
  });

  it('uxRangeTooNarrow: narrow modeViewport span shows "Range too narrow" and placeholderData, independent of hook', () => {
    // Verify the container derives rangeTooNarrow from modeViewport, not the hook
    // flag — the hook mock returns rangeTooNarrow: false (default makeResult).
    renderContainer([1]);
    // Trigger narrow span via zoom: 999ms < MIN_VIEWPORT_SPAN_MS (1000ms).
    const end = 1_700_000_000_000n;
    const start = end - (MIN_VIEWPORT_SPAN_MS - 1n);
    act(() => {
      capturedOnXRangeChange?.(start, end);
      vi.runAllTimers();
    });

    expect(screen.getByText('Range too narrow. Zoom out or pick a wider preset.')).toBeTruthy();
    expect(capturedData!.n).toBe(2);
    expect(capturedData!.series!.size).toBe(1);
    expect(capturedData!.startTime).toBe(start);
    expect(capturedData!.endTime).toBe(end);
  });

  it('uxRangeTooNarrow → preset click clears message and restores real data', () => {
    renderContainer([1]);
    // Enter narrow state.
    const end = 1_700_000_000_000n;
    const start = end - (MIN_VIEWPORT_SPAN_MS - 1n);
    act(() => {
      capturedOnXRangeChange?.(start, end);
      vi.runAllTimers();
    });
    expect(screen.getByText('Range too narrow. Zoom out or pick a wider preset.')).toBeTruthy();

    // Click 1h preset → modeViewport span becomes 1h → uxRangeTooNarrow clears.
    fireEvent.click(screen.getByText('1h'));
    expect(screen.queryByText('Range too narrow. Zoom out or pick a wider preset.')).toBeNull();
    // Real data from hook mock (n=500) restored — placeholder discarded.
    expect(capturedData!.n).toBe(500);
  });

  // ── EndPicker integration ─────────────────────────────────────────────────

  it('committing a far-past End → fixed mode, Live button shows "Go Live"', () => {
    renderContainer([1]);
    const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2020-01-02T00:00:00' } });
    expect(screen.getByText('Go Live')).toBeTruthy();
  });

  it('committing End ≈ now → goes fixed (End picker never enters tailing), shows "Go Live"', () => {
    renderContainer([1]);
    vi.setSystemTime(new Date('2024-06-01T12:00:00Z'));
    // endPickerCommitted always goes fixed — user must click Live to enter tailing.
    const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2024-06-01T12:00:00' } });
    expect(screen.getByText('Go Live')).toBeTruthy();
  });

  it('SpanBucketIndicator renders span and bucket size in the footer', () => {
    renderContainer();
    // Default sizeMs = 1h; bucketSMs = 3600ms = 3.6 s
    expect(screen.getByText('Span: 1 h')).toBeTruthy();
    expect(screen.getByText('Bucket Size: 3.6 s')).toBeTruthy();
  });

  it('after preset click, SpanBucketIndicator span line updates to match the new span', () => {
    renderContainer();
    fireEvent.click(screen.getByText('4h'));
    expect(screen.getByText('Span: 4 h')).toBeTruthy();
  });

  // ── showLastWhenIdle plumbing ─────────────────────────────────────────────

  it('tailing mode: showLastWhenIdle=true so legend shows latest values at rest', () => {
    renderContainer([1]);
    // Initial state is tailing.
    expect(screen.getByTestId('idle-mode').textContent).toBe('live');
  });

  it('fixed mode after past End commit: showLastWhenIdle=false so legend shows -- at rest', () => {
    renderContainer([1]);
    const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2020-01-02T00:00:00' } });
    expect(screen.getByTestId('idle-mode').textContent).toBe('fixed');
  });

  it('cursor row renders above the footer (preset buttons row)', () => {
    renderContainer();
    const cursorEl = screen.getByText(/^Cursor:/, { selector: 'span' });
    const firstPreset = screen.getByText('1m');
    // DOCUMENT_POSITION_FOLLOWING (4) means firstPreset comes after cursorEl in DOM.
    expect(cursorEl.compareDocumentPosition(firstPreset) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('endPickerCommitted preserves preset highlight when sizeMs is unchanged', () => {
    renderContainer([1]);
    // Click a preset to set lastIntent = 'preset'.
    fireEvent.click(screen.getByText('4h'));
    expect(screen.getByText('4h').style.background).toBe('rgb(37, 99, 235)');

    // Commit a far-past End via the hidden picker input → endPickerCommitted sets
    // lastIntent = 'endPicker' while preserving sizeMs = 4h, so highlight stays.
    const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2020-06-15T10:00:00' } });
    expect(screen.getByText('4h').style.background).toBe('rgb(37, 99, 235)');
  });

  it('onXRangeChange clears preset highlight and updates span without a CAG-level switch', () => {
    renderContainer([1]);
    // Click 1h preset — lastIntent = 'preset', button highlights.
    fireEvent.click(screen.getByText('1h'));
    expect(screen.getByText('1h').style.background).toBe('rgb(37, 99, 235)');

    // Simulate a sub-threshold wheel zoom to a far-past 45-min window.
    const farPastEnd = 1_700_000_000_000n; // Nov 2023
    const farPastStart = farPastEnd - 2_700_000n; // 45 min earlier
    act(() => {
      capturedOnXRangeChange?.(farPastStart, farPastEnd);
      vi.runAllTimers(); // flush the coalescing RAF
    });

    // Preset highlight should clear (lastIntent = 'zoom').
    expect(screen.getByText('1h').style.background).not.toBe('rgb(37, 99, 235)');
    // Mode flips to fixed → Live button shows "Go Live".
    expect(screen.getByText('Go Live')).toBeTruthy();
    // SpanBucketIndicator reflects the new 45-min span.
    expect(screen.getByText('Span: 45 min')).toBeTruthy();
  });

  it('onXPan after preset click preserves preset highlight and span', () => {
    renderContainer([1]);
    fireEvent.click(screen.getByText('1h'));
    expect(screen.getByText('1h').style.background).toBe('rgb(37, 99, 235)');

    // Simulate a pan: same 1h span, shifted into the far past.
    const farPastEnd = 1_700_000_000_000n;
    const farPastStart = farPastEnd - 3_600_000n; // same 1h width
    act(() => {
      capturedOnXPan?.(farPastStart, farPastEnd);
      vi.runAllTimers(); // flush coalescing RAF
    });

    // Preset highlight must stay lit (lastIntent = 'pan', sizeMs still 1h).
    expect(screen.getByText('1h').style.background).toBe('rgb(37, 99, 235)');
    // Mode flips to fixed → Live button shows "Go Live".
    expect(screen.getByText('Go Live')).toBeTruthy();
    // Span unchanged at 1 h.
    expect(screen.getByText('Span: 1 h')).toBeTruthy();
  });

  it('EndPicker display text reflects modeViewport.end after commit', () => {
    renderContainer([1]);
    const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
    // Commit a far-past end: 2021-03-15T08:30:00 UTC
    fireEvent.change(input, { target: { value: '2021-03-15T08:30:00' } });
    // Display button should show the committed end in dd-mmm-yyyy HH:mm:ss format.
    const displayBtn = screen.getByRole('button', { name: /pick end time/i });
    expect(displayBtn.textContent).toContain('15-Mar-2021');
  });

  it('drag-zoom exits tailing and clears preset highlight (lastIntent becomes zoom)', () => {
    renderContainer([1]);
    // Set a known preset so the highlight is lit.
    fireEvent.click(screen.getByText('1h'));
    expect(screen.getByText('1h').style.background).toBe('rgb(37, 99, 235)');

    // Simulate drag-zoom: 30-min selection well in the past (different span from 1h preset).
    const farPastEnd = 1_700_000_000_000n;
    const farPastStart = farPastEnd - 1_800_000n;
    act(() => {
      // zoomApplied dispatches synchronously inside handleDragZoom — no RAF flush needed.
      capturedOnDragZoom?.(farPastStart, farPastEnd);
    });

    // Mode flips to fixed → "Go Live" appears.
    expect(screen.getByText('Go Live')).toBeTruthy();
    // Preset highlight clears: lastIntent = 'zoom' and sizeMs no longer matches 1h.
    expect(screen.getByText('1h').style.background).not.toBe('rgb(37, 99, 235)');
  });

  // ── live tail integration ─────────────────────────────────────────────────

  describe('live tail integration', () => {
    let mockResult: UseTrendDataResult;

    beforeEach(() => {
      liveHoisted.setTail(null);
      mockResult = makeResult([1, 2]);
      mockUseTrendData.mockReturnValue(mockResult);
    });

    it('initial render passes isTailing=true to useLiveSubscription', () => {
      renderContainer();
      expect(liveHoisted.getLastOpts()?.isLive).toBe(true);
    });

    it('after End commit, isTailing=false passed to useLiveSubscription', () => {
      renderContainer([1]);
      const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '2020-01-02T00:00:00' } });
      expect(liveHoisted.getLastOpts()?.isLive).toBe(false);
    });

    it('onDataReceived dispatches tick when mode is tailing (re-renders useTrendData)', () => {
      renderContainer([1]);
      const beforeCount = mockUseTrendData.mock.calls.length;

      act(() => {
        (liveHoisted.getLastOpts()?.onDataReceived as ((ts: number) => void) | undefined)?.(
          1_700_000_000_000,
        );
      });

      // Tick advances nowMs → modeViewport changes → useTrendData re-called.
      expect(mockUseTrendData.mock.calls.length).toBeGreaterThan(beforeCount);
    });

    it('onDataReceived does not dispatch tick when mode is fixed', () => {
      renderContainer([1]);
      // Enter fixed mode.
      const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '2020-01-02T00:00:00' } });

      const beforeCount = mockUseTrendData.mock.calls.length;

      act(() => {
        (liveHoisted.getLastOpts()?.onDataReceived as ((ts: number) => void) | undefined)?.(
          1_700_000_000_000,
        );
      });

      // No tick dispatched in fixed mode → call count unchanged.
      expect(mockUseTrendData.mock.calls.length).toBe(beforeCount);
    });

    it('pan in tailing → calls commitAndDrain, mode goes fixed, no evictAll', () => {
      // Live mode never writes to cache, so no eviction is needed on tailing→fixed.
      renderContainer([1]);

      const farPastEnd = 1_700_000_000_000n;
      const farPastStart = farPastEnd - 3_600_000n;
      act(() => {
        capturedOnXPan?.(farPastStart, farPastEnd);
        vi.runAllTimers();
      });

      expect(liveHoisted.commitAndDrain).toHaveBeenCalledOnce();
      expect(mockResult.refetchHistory).toHaveBeenCalledOnce();
      expect(mockResult.evictAll).not.toHaveBeenCalled();
      expect(screen.getByText('Go Live')).toBeTruthy();
    });

    it('zoom (onXRangeChange) in tailing → calls commitAndDrain, no evictAll', () => {
      renderContainer([1]);

      const farPastEnd = 1_700_000_000_000n;
      const farPastStart = farPastEnd - 2_700_000n;
      act(() => {
        capturedOnXRangeChange?.(farPastStart, farPastEnd);
        vi.runAllTimers();
      });

      expect(liveHoisted.commitAndDrain).toHaveBeenCalledOnce();
      expect(mockResult.refetchHistory).toHaveBeenCalledOnce();
      expect(mockResult.evictAll).not.toHaveBeenCalled();
      expect(screen.getByText('Go Live')).toBeTruthy();
    });

    it('drag-zoom in tailing → calls commitAndDrain, no evictAll', () => {
      renderContainer([1]);

      const farPastEnd = 1_700_000_000_000n;
      const farPastStart = farPastEnd - 1_800_000n;
      act(() => {
        capturedOnDragZoom?.(farPastStart, farPastEnd);
      });

      expect(liveHoisted.commitAndDrain).toHaveBeenCalledOnce();
      expect(mockResult.refetchHistory).toHaveBeenCalledOnce();
      expect(mockResult.evictAll).not.toHaveBeenCalled();
      expect(screen.getByText('Go Live')).toBeTruthy();
    });

    it('EndPicker commit in tailing → calls commitAndDrain, no evictAll', () => {
      renderContainer([1]);

      const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '2020-01-02T00:00:00' } });

      expect(liveHoisted.commitAndDrain).toHaveBeenCalledOnce();
      expect(mockResult.refetchHistory).toHaveBeenCalledOnce();
      expect(mockResult.evictAll).not.toHaveBeenCalled();
      expect(screen.getByText('Go Live')).toBeTruthy();
    });

    it('preset click in tailing → no commitAndDrain (stays tailing)', () => {
      renderContainer([1]);
      fireEvent.click(screen.getByText('4h'));

      expect(liveHoisted.commitAndDrain).not.toHaveBeenCalled();
      expect(mockResult.evictAll).not.toHaveBeenCalled();
      expect(screen.getByText('● Live')).toBeTruthy();
    });

    it('Live button click in tailing → no commitAndDrain (stays tailing)', () => {
      renderContainer([1]);
      fireEvent.click(screen.getByText('● Live'));

      expect(liveHoisted.commitAndDrain).not.toHaveBeenCalled();
      expect(mockResult.evictAll).not.toHaveBeenCalled();
    });

    it('tailing→fixed: commitAndDrain + refetchHistory fire; evictAll never fires', () => {
      renderContainer([1]);

      const farPastEnd = 1_700_000_000_000n;
      const farPastStart = farPastEnd - 3_600_000n;
      act(() => {
        capturedOnXPan?.(farPastStart, farPastEnd);
        vi.runAllTimers();
      });

      expect(liveHoisted.commitAndDrain).toHaveBeenCalledOnce();
      expect(mockResult.refetchHistory).toHaveBeenCalledOnce();
      expect(mockResult.evictAll).not.toHaveBeenCalled();
    });

    it('tailing→fixed: commitAndDrain fires BEFORE refetchHistory (TG-5 ordering)', () => {
      renderContainer([1]);

      const farPastEnd = 1_700_000_000_000n;
      const farPastStart = farPastEnd - 3_600_000n;
      act(() => {
        capturedOnXPan?.(farPastStart, farPastEnd);
        vi.runAllTimers();
      });

      // Order matters: commitAndDrain must clear live state BEFORE refetchHistory
      // triggers the post-transition history fetch. Inversion would let live-buffer
      // residue leak into the fetched range (spec §10.6).
      expectCallOrder(liveHoisted.commitAndDrain, mockResult.refetchHistory);
    });

    it('Live click in fixed → evictAll called once to clear stale cache; mode returns to tailing', () => {
      // evictAll on fixed→tailing ensures every subsequent live exit fetches
      // fresh tiles, preventing Gap B (stale CAG-lag nulls accumulating in cache).
      renderContainer([1]);

      // Pan to enter fixed mode.
      const farPastEnd = 1_700_000_000_000n;
      const farPastStart = farPastEnd - 3_600_000n;
      act(() => {
        capturedOnXPan?.(farPastStart, farPastEnd);
        vi.runAllTimers();
      });
      expect(screen.getByText('Go Live')).toBeTruthy();

      // Clear spies accumulated during the tailing→fixed transition.
      mockResult.evictAll.mockClear();
      mockResult.refetchHistory.mockClear();
      liveHoisted.commitAndDrain.mockClear();

      // Click Live: fixed → tailing → evictAll fires; no commitAndDrain; no refetchHistory.
      fireEvent.click(screen.getByText('Go Live'));

      expect(mockResult.evictAll).toHaveBeenCalledOnce();
      expect(mockResult.refetchHistory).not.toHaveBeenCalled();
      expect(liveHoisted.commitAndDrain).not.toHaveBeenCalled();
      expect(screen.getByText('● Live')).toBeTruthy();
    });

    it('spine-fetch window: bucketSMs=null during in-flight, correct after spine settles', () => {
      // Cold start: data=null (spine in flight). useLiveSubscription must see
      // tailMode=null so it accumulates in ring only (no accumulator writes).
      // When spine settles, tailMode→'aggregate' triggers ring replay with the
      // correct bucketSMs. This verifies no deltas are misrouted during the
      // spine-fetch window.
      //
      // Phase 2b: cachedData comes from getBufferSnapshot() in live mode.
      // Null snapshot simulates "no spine seeded yet" (spine in-flight).
      liveHoisted.setSnapshot(null);
      mockUseTrendData.mockReturnValue(makeResult([1], { data: null, isLoading: true, responseTailTs: null }));
      renderContainer([1]);

      // Spine in flight → tailMode=null, bucketSMs=null propagated to useLiveSubscription.
      expect(liveHoisted.getLastOpts()?.tailMode).toBeNull();
      expect(liveHoisted.getLastOpts()?.bucketSMs).toBeNull();

      // Spine settles: update snapshot to simulate seedFromSpineFetch writing to spineRef.
      liveHoisted.setSnapshot(makeAggData([1]));
      mockUseTrendData.mockReturnValue(makeResult([1]));
      // Trigger a re-render by simulating a tick (onDataReceived advances nowMs).
      act(() => {
        (liveHoisted.getLastOpts()?.onDataReceived as ((ts: number) => void) | undefined)?.(
          Date.now(),
        );
      });

      // tailMode and bucketSMs now reflect the settled spine data.
      expect(liveHoisted.getLastOpts()?.tailMode).toBe('aggregate');
      expect(liveHoisted.getLastOpts()?.bucketSMs).toBe(3600n);
    });

    // ── evictAll on Live entry (Gap B fix) ───────────────────────────────────

    it('evictAll called exactly once on fixed→tailing (Live button click)', () => {
      renderContainer([1]);

      // Pan to enter fixed mode.
      const farPastEnd = 1_700_000_000_000n;
      const farPastStart = farPastEnd - 3_600_000n;
      act(() => {
        capturedOnXPan?.(farPastStart, farPastEnd);
        vi.runAllTimers();
      });
      mockResult.evictAll.mockClear();

      fireEvent.click(screen.getByText('Go Live'));
      expect(mockResult.evictAll).toHaveBeenCalledOnce();
    });

    it('Live click: evictAll fires BEFORE the re-render with isTailing=true (TG-6 ordering)', () => {
      renderContainer([1]);

      // Pan into fixed mode first.
      const farPastEnd = 1_700_000_000_000n;
      const farPastStart = farPastEnd - 3_600_000n;
      act(() => {
        capturedOnXPan?.(farPastStart, farPastEnd);
        vi.runAllTimers();
      });

      // Reset spies so we only observe the Live-click activity.
      mockResult.evictAll.mockClear();
      mockUseTrendData.mockClear();

      // Click Live: synchronously evictAll → dispatch(liveClicked); React re-renders;
      // useTrendData is called with isTailing=true on that next render.
      act(() => {
        fireEvent.click(screen.getByText('Go Live'));
      });

      // Find the first useTrendData re-render where isTailing flipped to true.
      const tailingCallIdx = mockUseTrendData.mock.calls.findIndex(
        args => args[0].isLive === true,
      );
      expect(tailingCallIdx).toBeGreaterThanOrEqual(0);

      // Ordering: evictAll fired BEFORE the useTrendData call that has isTailing=true.
      // Raw invocationCallOrder comparison rather than expectCallOrder because the
      // two spies aren't peers — evictAll is called once in the click handler, while
      // useTrendData is called N times across re-renders; we target the Nth call.
      const evictAllOrder = mockResult.evictAll.mock.invocationCallOrder[0]!;
      const tailingCallOrder = mockUseTrendData.mock.invocationCallOrder[tailingCallIdx]!;
      expect(evictAllOrder).toBeLessThan(tailingCallOrder);
    });

    it('evictAll NOT called on tailing→fixed transitions (pan, EndPicker commit)', () => {
      renderContainer([1]);

      // Pan (tailing→fixed): no evictAll.
      const farPastEnd = 1_700_000_000_000n;
      const farPastStart = farPastEnd - 3_600_000n;
      act(() => {
        capturedOnXPan?.(farPastStart, farPastEnd);
        vi.runAllTimers();
      });
      expect(mockResult.evictAll).not.toHaveBeenCalled();
    });

    it('evictAll NOT called on same-mode transitions (preset click while fixed)', () => {
      renderContainer([1]);

      // Enter fixed mode first.
      const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '2020-01-02T00:00:00' } });
      mockResult.evictAll.mockClear();

      // Preset click stays within fixed mode — no evictAll.
      fireEvent.click(screen.getByText('4h'));
      expect(mockResult.evictAll).not.toHaveBeenCalled();
    });

    // ── D-C: bridge-data ref (Bug 3 fix) ─────────────────────────────────────

    it('D-C: <TrendChart> stays mounted when chartData briefly drops to null (bridge via lastChartDataRef)', () => {
      // First render: spine available → TrendChart rendered.
      liveHoisted.setSnapshot(makeAggData([1, 2]));
      mockUseTrendData.mockReturnValue(makeResult([1, 2]));
      const { rerender } = renderContainer([1, 2]);

      // Verify TrendChart is rendered (remove buttons present, no loading hint).
      expect(screen.queryByText('Loading…')).toBeNull();
      expect(screen.getAllByTitle('Remove trace').length).toBeGreaterThan(0);

      // Transition: snapshot drops to null (spine in-flight after mode change).
      liveHoisted.setSnapshot(null);
      mockUseTrendData.mockReturnValue(makeResult([1, 2], { data: null, isLoading: true }));
      rerender(
        <MockHmiProvider tagDefs={TAG_DEFS}>
          <TrendChartContainer tagIds={[1, 2]} siteTimezone="UTC" height={400} />
        </MockHmiProvider>,
      );

      // Bridge: lastChartDataRef holds the prior non-null data → TrendChart stays.
      expect(screen.queryByText('Loading…')).toBeNull();
      expect(screen.getAllByTitle('Remove trace').length).toBeGreaterThan(0);
    });

    it('D-C: initial load with null snapshot renders loading hint (no bridge before first data)', () => {
      // lastChartDataRef is null on first render → effectiveChartData is null → loading hint.
      liveHoisted.setSnapshot(null);
      mockUseTrendData.mockReturnValue(makeResult([1], { data: null, isLoading: true }));
      renderContainer([1]);

      expect(screen.getByText('Loading…')).toBeTruthy();
      // TrendChart NOT rendered.
      expect(screen.queryByTitle('Remove trace')).toBeNull();
    });

    it('E: Live mergedData reads spine ref fresh on every render (wide-preset staleness fix)', () => {
      // In the real hook, getBufferSnapshot is a stable useCallback ref whose
      // return value changes when spineRef is updated by seedFromSpineFetch.
      // The old useMemo had getBufferSnapshot in its dep array; since the ref
      // was stable the memo returned a stale null after a spine arrival that
      // didn't touch any other dep. The split-paths fix calls getBufferSnapshot()
      // directly in render so any re-render picks up the latest spine.

      // Initial state: spine in-flight, no data.
      liveHoisted.setSnapshot(null);
      mockUseTrendData.mockReturnValue(makeResult([1, 2], { data: null, isLoading: true }));
      renderContainer([1, 2]);

      // No spine yet → loading hint shown, TrendChart not mounted.
      expect(screen.getByText('Loading…')).toBeTruthy();

      // Spine resolves: simulate seedFromSpineFetch writing to spineRef.
      const spineData = makeAggData([1, 2]);
      liveHoisted.setSnapshot(spineData);

      // Re-render triggered by a tick (mirrors swapCounter bump from live spine fetch).
      act(() => {
        (liveHoisted.getLastOpts()?.onDataReceived as ((ts: number) => void) | undefined)?.(
          Date.now(),
        );
      });

      // mergedData now reflects the new spine — chart replaces loading hint.
      expect(screen.queryByText('Loading…')).toBeNull();
      expect(capturedData).toBeDefined();
      expect(capturedData!.startTime).toBe(spineData.startTime);
      expect(capturedData!.endTime).toBe(spineData.endTime);
    });

  });
});

// ── computeDragZoomViewport (pure snap-and-center math) ───────────────────────

describe('computeDragZoomViewport', () => {
  // Constants matching production defaults: 2 visible tiles × 500 buckets = 1000
  const VT = 2;
  const BC = 500;

  it('~1/4 selection span → 2 zoom-in levels (bucketSMs halved twice)', () => {
    const currentBucket = 3_600_000n;
    const selStart = 0n;
    const selEnd = 3_600_000n * 1000n / 4n;
    const result = computeDragZoomViewport(currentBucket, selStart, selEnd, VT, BC);
    expect(result).not.toBeNull();
    expect(result!.newBucketSMs).toBe(3_600_000n >> 2n);
  });

  it('~1/8 selection span → 3 zoom-in levels (bucketSMs >> 3)', () => {
    const currentBucket = 3_600_000n;
    const fullSpan = currentBucket * BigInt(VT * BC);
    const selStart = 0n;
    const selEnd = fullSpan / 8n;
    const result = computeDragZoomViewport(currentBucket, selStart, selEnd, VT, BC);
    expect(result).not.toBeNull();
    expect(result!.newBucketSMs).toBe(currentBucket >> 3n);
  });

  it('full-span selection (N=0) → bucketSMs unchanged', () => {
    const currentBucket = 3_600_000n;
    const fullSpan = currentBucket * BigInt(VT * BC);
    const result = computeDragZoomViewport(currentBucket, 0n, fullSpan, VT, BC);
    expect(result).not.toBeNull();
    expect(result!.newBucketSMs).toBe(currentBucket);
  });

  it('recenters correctly: newStart = center - newSpan/2, newEnd = newStart + newSpan', () => {
    const currentBucket = 3_600_000n;
    const selStart = 1_000_000n;
    const selEnd = 3_000_000n;
    const result = computeDragZoomViewport(currentBucket, selStart, selEnd, VT, BC);
    expect(result).not.toBeNull();
    const { newStart, newEnd, newBucketSMs } = result!;
    const newSpan = newBucketSMs * BigInt(VT * BC);
    const center = (selStart + selEnd) / 2n;
    expect(newStart).toBe(center - newSpan / 2n);
    expect(newEnd).toBe(newStart + newSpan);
  });

  it('zero-width selection → returns null', () => {
    expect(computeDragZoomViewport(3_600_000n, 1_000n, 1_000n, VT, BC)).toBeNull();
  });

  it('negative-span selection → returns null', () => {
    expect(computeDragZoomViewport(3_600_000n, 5_000n, 1_000n, VT, BC)).toBeNull();
  });

  it('selection too narrow (targetBucketSMs rounds to 0) → returns null', () => {
    expect(computeDragZoomViewport(3_600_000n, 0n, 1n, VT, BC)).toBeNull();
  });

  it('extreme zoom-in: clamps newBucketSMs to 1n floor when shift overflows', () => {
    const result = computeDragZoomViewport(3n, 0n, 1000n, VT, BC);
    expect(result).not.toBeNull();
    expect(result!.newBucketSMs).toBe(1n);
  });
});
