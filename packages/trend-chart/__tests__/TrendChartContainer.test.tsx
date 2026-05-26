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

// ── useLiveSubscription mock (hoisted so vi.mock factory can close over it) ───

const liveHoisted = vi.hoisted(() => {
  const drainBuffers = vi.fn();
  let _tail: unknown = null;
  let _lastOpts: Record<string, unknown> | null = null;
  let _latestSampleTs: bigint | null = null;

  return {
    drainBuffers,
    setTail: (t: unknown) => { _tail = t; },
    getTail: () => _tail,
    setLastOpts: (o: Record<string, unknown>) => { _lastOpts = o; },
    getLastOpts: () => _lastOpts,
    setLatestSampleTs: (ts: bigint | null) => { _latestSampleTs = ts; },
    getLatestSampleTs: () => _latestSampleTs,
  };
});

vi.mock('../src/useLiveSubscription.js', () => ({
  useLiveSubscription: vi.fn((opts: Record<string, unknown>) => {
    liveHoisted.setLastOpts(opts);
    return {
      tail: liveHoisted.getTail(),
      drainBuffers: liveHoisted.drainBuffers,
      getLatestSampleTs: vi.fn().mockImplementation(() => liveHoisted.getLatestSampleTs()),
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
    swapCounter: 0,
    activeTileCount: 0,
    lastFetchMs: null,
    committedThroughTs: null,
    activeTilesRef: { current: [] },
    invalidateNonTerminalTiles: vi.fn(),
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
    liveHoisted.setLatestSampleTs(null);
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
    mockUseTrendData.mockReturnValue(makeResult([1, 2], { data: null, isLoading: true }));
    renderContainer();
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('shows no-tags hint when tagIds is empty', () => {
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

    it('pan in tailing → calls drainBuffers, mode goes fixed', () => {
      renderContainer([1]);

      const farPastEnd = 1_700_000_000_000n;
      const farPastStart = farPastEnd - 3_600_000n;
      act(() => {
        capturedOnXPan?.(farPastStart, farPastEnd);
        vi.runAllTimers();
      });

      expect(liveHoisted.drainBuffers).toHaveBeenCalledOnce();
      expect(screen.getByText('Go Live')).toBeTruthy();
    });

    it('zoom (onXRangeChange) in tailing → calls drainBuffers', () => {
      renderContainer([1]);

      const farPastEnd = 1_700_000_000_000n;
      const farPastStart = farPastEnd - 2_700_000n;
      act(() => {
        capturedOnXRangeChange?.(farPastStart, farPastEnd);
        vi.runAllTimers();
      });

      expect(liveHoisted.drainBuffers).toHaveBeenCalledOnce();
      expect(screen.getByText('Go Live')).toBeTruthy();
    });

    it('drag-zoom in tailing → calls drainBuffers', () => {
      renderContainer([1]);

      const farPastEnd = 1_700_000_000_000n;
      const farPastStart = farPastEnd - 1_800_000n;
      act(() => {
        capturedOnDragZoom?.(farPastStart, farPastEnd);
      });

      expect(liveHoisted.drainBuffers).toHaveBeenCalledOnce();
      expect(screen.getByText('Go Live')).toBeTruthy();
    });

    it('EndPicker commit in tailing → calls drainBuffers', () => {
      renderContainer([1]);

      const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '2020-01-02T00:00:00' } });

      expect(liveHoisted.drainBuffers).toHaveBeenCalledOnce();
      expect(screen.getByText('Go Live')).toBeTruthy();
    });

    it('preset click in tailing → no drainBuffers (stays tailing)', () => {
      renderContainer([1]);
      fireEvent.click(screen.getByText('4h'));

      expect(liveHoisted.drainBuffers).not.toHaveBeenCalled();
      expect(screen.getByText('● Live')).toBeTruthy();
    });

    it('Live button click in tailing → no drainBuffers (stays tailing)', () => {
      renderContainer([1]);
      fireEvent.click(screen.getByText('● Live'));

      expect(liveHoisted.drainBuffers).not.toHaveBeenCalled();
    });

    it('tailing→fixed: drainBuffers fires', () => {
      renderContainer([1]);

      const farPastEnd = 1_700_000_000_000n;
      const farPastStart = farPastEnd - 3_600_000n;
      act(() => {
        capturedOnXPan?.(farPastStart, farPastEnd);
        vi.runAllTimers();
      });

      expect(liveHoisted.drainBuffers).toHaveBeenCalledOnce();
      expect(screen.getByText('Go Live')).toBeTruthy();
    });

    it('Live click in fixed → mode returns to tailing; no drainBuffers (wasLive=false)', () => {
      renderContainer([1]);

      // Pan to enter fixed mode.
      const farPastEnd = 1_700_000_000_000n;
      const farPastStart = farPastEnd - 3_600_000n;
      act(() => {
        capturedOnXPan?.(farPastStart, farPastEnd);
        vi.runAllTimers();
      });
      expect(screen.getByText('Go Live')).toBeTruthy();
      liveHoisted.drainBuffers.mockClear();

      // Click Live: fixed → tailing; no drainBuffers (wasLive=false).
      fireEvent.click(screen.getByText('Go Live'));

      expect(liveHoisted.drainBuffers).not.toHaveBeenCalled();
      expect(screen.getByText('● Live')).toBeTruthy();
    });

    // ── D-C: bridge-data ref (Bug 3 fix) ─────────────────────────────────────

    it('D-C: <TrendChart> stays mounted when chartData briefly drops to null (bridge via lastChartDataRef)', () => {
      mockUseTrendData.mockReturnValue(makeResult([1, 2]));
      const { rerender } = renderContainer([1, 2]);

      // Verify TrendChart is rendered (remove buttons present, no loading hint).
      expect(screen.queryByText('Loading…')).toBeNull();
      expect(screen.getAllByTitle('Remove trace').length).toBeGreaterThan(0);

      // Transition: data drops to null (e.g. in-flight after mode change).
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

    it('D-C: initial load with null data renders loading hint (no bridge before first data)', () => {
      mockUseTrendData.mockReturnValue(makeResult([1], { data: null, isLoading: true }));
      renderContainer([1]);

      expect(screen.getByText('Loading…')).toBeTruthy();
      // TrendChart NOT rendered.
      expect(screen.queryByTitle('Remove trace')).toBeNull();
    });

    // ── Phase 3: live-fixed routing ───────────────────────────────────────────

    // LTS shared by all Phase 3 container tests (5 000 s before farPastEnd).
    const PHASE3_LTS = 1_700_000_000_000n - 5_000_000n;
    const PHASE3_PAN_END = 1_700_000_000_000n;
    const PHASE3_PAN_START = PHASE3_PAN_END - 3_600_000n;

    /** Helper: enter live-fixed by panning to PHASE3_PAN_END (> PHASE3_LTS). */
    function enterLiveFixed() {
      act(() => {
        capturedOnXPan?.(PHASE3_PAN_START, PHASE3_PAN_END);
        vi.runAllTimers();
      });
    }

    it('Phase 3: pan within Live (to > latestSampleTs) → live-fixed; no drainBuffers', () => {
      liveHoisted.setLatestSampleTs(PHASE3_LTS);
      const mockR = makeResult([1]);
      mockUseTrendData.mockReturnValue(mockR);
      renderContainer([1]);

      enterLiveFixed();

      expect(liveHoisted.drainBuffers).not.toHaveBeenCalled();
      // Still in Live mode (live-fixed shows "● Live" same as live-trailing)
      expect(screen.getByText('● Live')).toBeTruthy();
    });

    it('Phase 3: live-fixed shows isLive=true to useLiveSubscription (data subscription stays active)', () => {
      liveHoisted.setLatestSampleTs(PHASE3_LTS);
      renderContainer([1]);
      enterLiveFixed();
      expect(liveHoisted.getLastOpts()?.isLive).toBe(true);
    });

    it('Phase 3: preset click from live-fixed → live-trailing: no drainBuffers (both live)', () => {
      liveHoisted.setLatestSampleTs(PHASE3_LTS);
      const mockR = makeResult([1]);
      mockUseTrendData.mockReturnValue(mockR);
      renderContainer([1]);

      enterLiveFixed();
      liveHoisted.drainBuffers.mockClear();

      // Preset click: live-fixed → live-trailing (wasLive && willBeLive → no drainBuffers).
      fireEvent.click(screen.getByText('4h'));

      expect(liveHoisted.drainBuffers).not.toHaveBeenCalled();
      expect(screen.getByText('● Live')).toBeTruthy();
    });

    it('Phase 3: Live button from live-fixed → live-trailing: no drainBuffers (both live)', () => {
      liveHoisted.setLatestSampleTs(PHASE3_LTS);
      const mockR = makeResult([1]);
      mockUseTrendData.mockReturnValue(mockR);
      renderContainer([1]);

      enterLiveFixed();
      liveHoisted.drainBuffers.mockClear();

      // Click "● Live" in live-fixed → live-trailing: wasLive && willBeLive → no drainBuffers.
      fireEvent.click(screen.getByText('● Live'));

      expect(liveHoisted.drainBuffers).not.toHaveBeenCalled();
    });

    it('Phase 3: live-fixed → fixed via pan past LTS: drainBuffers fires', () => {
      liveHoisted.setLatestSampleTs(PHASE3_LTS);
      const mockR = makeResult([1]);
      mockUseTrendData.mockReturnValue(mockR);
      renderContainer([1]);

      enterLiveFixed();
      liveHoisted.drainBuffers.mockClear();

      // Second pan: to < LTS → panApplied returns 'fixed' from 'live-fixed'
      const fixedEnd = PHASE3_LTS - 1_000_000n;
      const fixedStart = fixedEnd - 3_600_000n;
      act(() => {
        capturedOnXPan?.(fixedStart, fixedEnd);
        vi.runAllTimers();
      });

      // wasLive && !willBeLive → drain only
      expect(liveHoisted.drainBuffers).toHaveBeenCalledOnce();
      expect(screen.getByText('Go Live')).toBeTruthy();
    });

    it('Phase 3: onDataReceived in live-fixed auto-promotes when nowMs >= state.to', () => {
      liveHoisted.setLatestSampleTs(PHASE3_LTS);
      renderContainer([1]);
      enterLiveFixed(); // state.to = PHASE3_PAN_END = 1_700_000_000_000n

      // In live-fixed: showLastWhenIdle=true (isLive) → "live"
      expect(screen.getByTestId('idle-mode').textContent).toBe('live');
      expect(screen.getByText('● Live')).toBeTruthy();

      // Dispatch tick with nowMs > state.to → auto-promote to live-trailing
      act(() => {
        (liveHoisted.getLastOpts()?.onDataReceived as ((ts: number) => void) | undefined)?.(
          2_000_000_000_000, // >> PHASE3_PAN_END → triggers auto-promote
        );
      });

      // Auto-promoted to live-trailing: still showLastWhenIdle=true → "live"
      expect(screen.getByTestId('idle-mode').textContent).toBe('live');
    });

    it('Phase 3: onDataReceived in live-fixed no-op when nowMs < state.to (no auto-promote)', () => {
      liveHoisted.setLatestSampleTs(PHASE3_LTS);
      renderContainer([1]);
      enterLiveFixed(); // state.to = 1_700_000_000_000n

      // Dispatch tick with nowMs < state.to → no-op (reducer returns same state ref)
      act(() => {
        (liveHoisted.getLastOpts()?.onDataReceived as ((ts: number) => void) | undefined)?.(
          1_600_000_000_000, // < state.to = 1_700_000_000_000n → no-op
        );
      });

      // No state change: still in live-fixed → idle-mode "live" (isLive), button "● Live"
      expect(screen.getByTestId('idle-mode').textContent).toBe('live');
      expect(screen.getByText('● Live')).toBeTruthy();
    });

    // ── Phase 4: symmetric window-vs-live-edge from container ────────────────

    it('Phase 4: zoom from live-trailing with Window_End > LastTS → live-fixed; no teardown', () => {
      liveHoisted.setLatestSampleTs(PHASE3_LTS);
      const mockR = makeResult([1]);
      mockUseTrendData.mockReturnValue(mockR);
      renderContainer([1]);

      // Wheel-zoom to PHASE3_PAN_END > PHASE3_LTS → live-trailing stays Live (live-fixed).
      act(() => {
        capturedOnXRangeChange?.(PHASE3_PAN_START, PHASE3_PAN_END);
        vi.runAllTimers();
      });

      // live-trailing → live-fixed: internal Live flip — no teardown.
      expect(liveHoisted.drainBuffers).not.toHaveBeenCalled();
      expect(screen.getByText('● Live')).toBeTruthy();
    });

    it('Phase 4: zoom from live-trailing with Window_End < LastTS → fixed; drainBuffers fires', () => {
      liveHoisted.setLatestSampleTs(PHASE3_LTS);
      const mockR = makeResult([1]);
      mockUseTrendData.mockReturnValue(mockR);
      renderContainer([1]);

      // Zoom to a window ending well before PHASE3_LTS → wasLive && !willBeLive → drain.
      const fixedEnd = PHASE3_LTS - 1_000_000n;
      const fixedStart = fixedEnd - 2_700_000n;
      act(() => {
        capturedOnXRangeChange?.(fixedStart, fixedEnd);
        vi.runAllTimers();
      });

      expect(liveHoisted.drainBuffers).toHaveBeenCalledOnce();
      expect(screen.getByText('Go Live')).toBeTruthy();
    });

    // ── Phase 5: dataViewport synced on mode transitions ─────────────────────

    it('Phase 5: pan from fixed past LastTS → live-fixed; useTrendData receives new viewport', () => {
      const mockR = makeResult([1]);
      mockUseTrendData.mockReturnValue(mockR);
      renderContainer([1]);

      const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '2020-01-02T00:00:00' } });
      expect(screen.getByText('Go Live')).toBeTruthy();

      liveHoisted.setLatestSampleTs(PHASE3_LTS);
      const callsBefore = mockUseTrendData.mock.calls.length;

      act(() => {
        capturedOnXPan?.(PHASE3_PAN_START, PHASE3_PAN_END);
        vi.runAllTimers();
      });

      expect(screen.getByText('● Live')).toBeTruthy();

      const newCalls = mockUseTrendData.mock.calls.slice(callsBefore);
      const synced = newCalls.some(([opts]) => opts.viewport.end === PHASE3_PAN_END);
      expect(synced).toBe(true);
    });

    it('Phase 5: fixed → live-trailing via liveClicked; no drainBuffers; useTrendData re-called', () => {
      const mockR = makeResult([1]);
      mockUseTrendData.mockReturnValue(mockR);
      renderContainer([1]);

      const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '2020-01-02T00:00:00' } });
      expect(screen.getByText('Go Live')).toBeTruthy();

      liveHoisted.drainBuffers.mockClear();
      const callsBefore = mockUseTrendData.mock.calls.length;

      fireEvent.click(screen.getByText('Go Live'));

      expect(liveHoisted.drainBuffers).not.toHaveBeenCalled();
      expect(screen.getByText('● Live')).toBeTruthy();
      // Reset effect fires on mode transition: useTrendData re-called with new viewport.
      expect(mockUseTrendData.mock.calls.length).toBeGreaterThan(callsBefore);
    });

    // ── Phase 6: pan-driven mode transitions update useTrendData viewport ───────

    it('Phase 6: live→fixed (wasLive && !willBeLive); pan triggers reset effect, useTrendData sees new viewport', () => {
      liveHoisted.setLatestSampleTs(PHASE3_LTS);
      const mockR = makeResult([1]);
      mockUseTrendData.mockReturnValue(mockR);
      renderContainer([1]);

      // Pan to before LTS → live-trailing → fixed.
      const fixedEnd = PHASE3_LTS - 1_000_000n;
      const fixedStart = fixedEnd - 3_600_000n;
      const callsBefore = mockUseTrendData.mock.calls.length;
      act(() => {
        capturedOnXPan?.(fixedStart, fixedEnd);
        vi.runAllTimers();
      });

      expect(liveHoisted.drainBuffers).toHaveBeenCalledOnce();
      expect(screen.getByText('Go Live')).toBeTruthy();

      // Reset effect fires on pan (non-zoom intent): useTrendData sees the new viewport.
      const newCalls = mockUseTrendData.mock.calls.slice(callsBefore);
      const synced = newCalls.some(([opts]) => opts.viewport.end === fixedEnd);
      expect(synced).toBe(true);
    });

    it('Phase 6: fixed→live (!wasLive && willBeLive); pan triggers reset effect, useTrendData sees new viewport', () => {
      const mockR = makeResult([1]);
      mockUseTrendData.mockReturnValue(mockR);
      renderContainer([1]);

      const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '2020-01-02T00:00:00' } });
      expect(screen.getByText('Go Live')).toBeTruthy();

      liveHoisted.setLatestSampleTs(PHASE3_LTS);
      const callsBefore = mockUseTrendData.mock.calls.length;

      act(() => {
        capturedOnXPan?.(PHASE3_PAN_START, PHASE3_PAN_END);
        vi.runAllTimers();
      });

      expect(screen.getByText('● Live')).toBeTruthy();

      // Reset effect fires on pan (non-zoom intent): useTrendData sees the new viewport.
      const newCalls = mockUseTrendData.mock.calls.slice(callsBefore);
      const synced = newCalls.some(([opts]) => opts.viewport.end === PHASE3_PAN_END);
      expect(synced).toBe(true);
    });

    // ── Zoom isolation — modeViewport tracks zoom; bucketSMs stays constant within level ───

    it('within-mode zoomApplied (fixed→fixed): modeViewport flows to useTrendData, bucketSMs unchanged', () => {
      renderContainer([1]);
      const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '2020-06-01T12:00:00' } });

      // Capture bucketSMs before the zoom (currentBucketSMs is stable within a level).
      const callsBefore = mockUseTrendData.mock.calls.length;
      const bucketSmsBefore = mockUseTrendData.mock.calls[callsBefore - 1]?.[0]?.bucketSMs;

      // zoomApplied within same level: modeViewport changes, but no level switch fires.
      const zoomEnd = 1_578_000_000_000n; // 2020-01-03
      const zoomStart = zoomEnd - 2_700_000n;
      act(() => {
        capturedOnXRangeChange?.(zoomStart, zoomEnd);
        vi.runAllTimers();
      });

      const newCalls = mockUseTrendData.mock.calls.slice(callsBefore);
      // modeViewport IS passed through — useTrendData sees the zoomed viewport.
      const viewportUpdated = newCalls.some(([opts]) => opts.viewport.end === zoomEnd);
      expect(viewportUpdated).toBe(true);
      // bucketSMs must NOT change within a level (no zoom-level switch triggered).
      const anyBucketSMsChange = newCalls.some(([opts]) =>
        opts.bucketSMs !== undefined && opts.bucketSMs !== bucketSmsBefore,
      );
      expect(anyBucketSMsChange).toBe(false);
    });

    it('FIX 3: mode-crossing panApplied (live-trailing→fixed) triggers reset effect; useTrendData sees new viewport', () => {
      liveHoisted.setLatestSampleTs(PHASE3_LTS);
      renderContainer([1]);
      const callsBefore = mockUseTrendData.mock.calls.length;

      // Pan to before LTS → live-trailing → fixed; reset effect fires on pan intent.
      const fixedEnd = PHASE3_LTS - 1_000_000n;
      const fixedStart = fixedEnd - 3_600_000n;
      act(() => {
        capturedOnXPan?.(fixedStart, fixedEnd);
        vi.runAllTimers();
      });

      expect(screen.getByText('Go Live')).toBeTruthy();
      const newCalls = mockUseTrendData.mock.calls.slice(callsBefore);
      const synced = newCalls.some(([opts]) => opts.viewport.end === fixedEnd);
      expect(synced).toBe(true);
    });

    // ── Storm regression ────────────────────────────────────────────────────────
    //
    // Before the render-time derivation fix, a wide preset click after a zoomed-in
    // state produced one render where modeViewport = wide AND currentBucketSMs = old
    // narrow value. tilesForViewport(wide, tinyTileSpanMs) emitted hundreds of tiles and
    // runTileFetch fired them all. The fix: derive currentBucketSMs at render time for
    // non-zoom intents so it is always consistent with modeViewport in the same render.

    it('storm regression: preset after zoom-in never passes stale tiny bucketSMs to useTrendData', () => {
      renderContainer([1]);

      // Enter a tight resolution via 1m preset.
      fireEvent.click(screen.getByText('1m'));
      const tinyBucketSMs = mockUseTrendData.mock.calls.at(-1)![0]?.bucketSMs;
      // tinyBucketSMs = 60_000n / (2 * 500) = 60n

      const callsBefore = mockUseTrendData.mock.calls.length;

      // Jump to 24h preset — should immediately use wide resolution, never the stale tiny value.
      fireEvent.click(screen.getByText('24h'));

      const newCalls = mockUseTrendData.mock.calls.slice(callsBefore);

      // useTrendData must never be called with the stale 1m bucket size.
      const hasStale = newCalls.some(([opts]) => opts.bucketSMs === tinyBucketSMs);
      expect(hasStale).toBe(false);

      // At least one call must use a bucketSMs consistent with the 24h span.
      const expected24hBucketSMs = 24n * 3_600_000n / 1000n; // 86_400n
      const hasCorrect = newCalls.some(([opts]) => opts.bucketSMs === expected24hBucketSMs);
      expect(hasCorrect).toBe(true);
    });

    it('FIX 3: presetClicked (non-zoom intent) triggers reset effect; useTrendData sees new span', () => {
      renderContainer([1]);
      const callsBefore = mockUseTrendData.mock.calls.length;

      // presetClicked: lastIntent not 'zoom' → reset effect runs, useTrendData gets new viewport.
      fireEvent.click(screen.getByText('4h'));

      const expected4hMs = 4n * 60n * 60n * 1000n;
      const newCalls = mockUseTrendData.mock.calls.slice(callsBefore);
      const synced = newCalls.some(([opts]) => {
        const span = opts.viewport.end - opts.viewport.start;
        return span === expected4hMs;
      });
      expect(synced).toBe(true);
    });

    // ── Phase 4 refinement: liveEdgeBehindWindow button colour ──────────────

    describe('Phase 4 refinement: liveEdgeBehindWindow', () => {
      // JSDOM normalises hex colours to rgb on inline styles.
      const GREEN  = 'rgb(220, 252, 231)'; // LIVE_BTN.background (#dcfce7)
      const ORANGE = 'rgb(234, 88, 12)';   // LIVE_BTN_ORANGE.background (#ea580c)

      it('live-trailing: button is highlighted (green) regardless of latestSampleTs', () => {
        // LTS is well before the viewport start — in live-trailing the button is
        // never orange; liveEdgeBehindWindow only applies in live-fixed.
        liveHoisted.setLatestSampleTs(PHASE3_LTS);
        renderContainer([1]);
        expect(screen.getByText('● Live').style.background).toBe(GREEN);
      });

      it('live-fixed with lts < state.from: button is orange', () => {
        // PHASE3_LTS < PHASE3_PAN_START (= state.from after enterLiveFixed).
        liveHoisted.setLatestSampleTs(PHASE3_LTS);
        renderContainer([1]);
        enterLiveFixed();
        expect(screen.getByText('● Live').style.background).toBe(ORANGE);
      });

      it('live-fixed with lts >= state.from: button is highlighted (green)', () => {
        // Set lts = PHASE3_PAN_START (= state.from exactly → edge is at window left → not behind).
        liveHoisted.setLatestSampleTs(PHASE3_PAN_START);
        renderContainer([1]);
        enterLiveFixed();
        expect(screen.getByText('● Live').style.background).toBe(GREEN);
      });

      it('live-fixed with lts === null: button is highlighted (no data yet, treat as visible)', () => {
        // Enter live-fixed with PHASE3_LTS so the button starts orange.
        liveHoisted.setLatestSampleTs(PHASE3_LTS);
        const { rerender } = renderContainer([1]);
        enterLiveFixed();
        expect(screen.getByText('● Live').style.background).toBe(ORANGE); // sanity

        // Now null out lts and force a re-render — button must become green.
        liveHoisted.setLatestSampleTs(null);
        rerender(
          <MockHmiProvider tagDefs={TAG_DEFS}>
            <TrendChartContainer tagIds={[1]} siteTimezone="UTC" height={400} />
          </MockHmiProvider>,
        );
        expect(screen.getByText('● Live').style.background).toBe(GREEN);
      });

      it('fixed mode: "Go Live" button shown (liveEdgeBehindWindow not applicable)', () => {
        renderContainer([1]);
        const input = document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
        fireEvent.change(input, { target: { value: '2020-01-02T00:00:00' } });
        expect(screen.queryByText('● Live')).toBeNull();
        expect(screen.getByText('Go Live')).toBeTruthy();
      });
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
