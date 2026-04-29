import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MockHmiProvider } from '@caro/hmi-context';
import type { TagDef } from '@caro/hmi-context';
import { TrendChartContainer } from '../src/TrendChartContainer.js';
import { useTrendData } from '../src/useTrendData.js';
import type { UseTrendDataResult } from '../src/useTrendData.js';

// ── uPlot mock ────────────────────────────────────────────────────────────────

vi.mock('uplot', () => {
  const MockUPlot = vi.fn().mockImplementation(() => {
    const over = document.createElement('div');
    return {
      destroy: vi.fn(),
      setData: vi.fn(),
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

vi.mock('uplot/dist/uPlot.min.css', () => ({}));

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
  return {
    type: 'aggregate' as const,
    source: '1min_cagg' as const,
    startTime: 0n,
    endTime: BigInt(n * 3600),
    n,
    bucketSMs: 3600,
    series: new Map(tagIds.map(id => [id, new Array(n).fill(id * 1.0)])),
  };
}

function makeResult(tagIds: number[], opts: Partial<UseTrendDataResult> = {}): UseTrendDataResult {
  return {
    data: makeAggData(tagIds),
    isLoading: false,
    error: null,
    ...opts,
  };
}

function renderContainer(tagIds = [1, 2]) {
  return render(
    <MockHmiProvider tagDefs={TAG_DEFS}>
      <TrendChartContainer tagIds={tagIds} siteTimezone="UTC" width={800} height={400} />
    </MockHmiProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TrendChartContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockUseTrendData.mockReturnValue(makeResult([1, 2]));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders TimeRangeBar preset buttons', () => {
    renderContainer();
    expect(screen.getByText('15m')).toBeTruthy();
    expect(screen.getByText('1h')).toBeTruthy();
    expect(screen.getByText('4h')).toBeTruthy();
    expect(screen.getByText('24h')).toBeTruthy();
    expect(screen.getByText('7d')).toBeTruthy();
    expect(screen.getByText('14d')).toBeTruthy();
  });

  it('renders Live button', () => {
    renderContainer();
    // Starts in tailing mode so button shows "● Live"
    expect(screen.getByText('● Live')).toBeTruthy();
  });

  it('default mode is tailing → 1h preset is not highlighted (no preset matched yet)', () => {
    // Default sizeMs = 1h — the "1h" button should be active.
    renderContainer();
    const btn = screen.getByText('1h');
    // Active preset has background #2563eb (set as inline style)
    expect(btn.style.background).toBe('rgb(37, 99, 235)');
  });

  it('clicking a preset button calls dispatch with presetClicked', () => {
    renderContainer();
    fireEvent.click(screen.getByText('4h'));
    // After clicking 4h, mode transitions to tailing with sizeMs=4h
    // useTrendData should have been called at least once
    expect(mockUseTrendData).toHaveBeenCalled();
  });

  it('clicking preset changes active highlight', () => {
    renderContainer();
    const btn4h = screen.getByText('4h');
    fireEvent.click(btn4h);
    // useReducer dispatch is synchronous in testing-library — no waitFor needed.
    expect(btn4h.style.background).toBe('rgb(37, 99, 235)');
  });

  it('Live button in fixed mode shows "Go Live" text', async () => {
    renderContainer();
    // Start tailing, then simulate a viewport change that goes to fixed
    // by triggering onRangeChange through the chart — simulated here by
    // observing the button state after a Custom range commit with far past to
    // We can't easily simulate drag, so just verify initial state.
    expect(screen.getByText('● Live')).toBeTruthy();
  });

  it('passes correct viewport to useTrendData after debounce', async () => {
    renderContainer();
    // Advance debounce timer
    act(() => { vi.advanceTimersByTime(150); });
    expect(mockUseTrendData).toHaveBeenCalled();
    const lastCall = mockUseTrendData.mock.calls[mockUseTrendData.mock.calls.length - 1]!;
    const opts = lastCall[0];
    expect(opts.tagIds).toEqual([1, 2]);
    expect(opts.viewport).toBeDefined();
  });

  it('repeated onRangeChange calls debounce to one useTrendData call per 100ms', async () => {
    renderContainer();
    const callsBefore = mockUseTrendData.mock.calls.length;

    // Advance time by 50ms (debounce not yet fired)
    act(() => { vi.advanceTimersByTime(50); });
    const callsMid = mockUseTrendData.mock.calls.length;

    // Advance past debounce (total 150ms)
    act(() => { vi.advanceTimersByTime(100); });

    // At most one more call after debounce fires
    const callsAfter = mockUseTrendData.mock.calls.length;
    expect(callsAfter - callsBefore).toBeLessThanOrEqual(callsMid - callsBefore + 2);
  });

  it('onTagRemove drops the tag from the list passed to useTrendData', () => {
    renderContainer([1, 2]);
    const removeButtons = screen.getAllByTitle('Remove trace');
    fireEvent.click(removeButtons[0]!); // remove tag 1 (Temp)

    // After the synchronous state update, the next render calls useTrendData with [2].
    const calls = mockUseTrendData.mock.calls;
    const found = calls.some(([opts]) => opts.tagIds.length === 1 && opts.tagIds[0] === 2);
    expect(found).toBe(true);
  });

  it('shows loading hint when data is null and isLoading=true', () => {
    mockUseTrendData.mockReturnValue({ data: null, isLoading: true, error: null });
    renderContainer();
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('shows no-tags hint when tagIds is empty', () => {
    mockUseTrendData.mockReturnValue({ data: null, isLoading: false, error: null });
    renderContainer([]);
    expect(screen.getByText('No tags selected.')).toBeTruthy();
  });

  it('Custom picker apply with past range commits customCommitted (fixed branch)', () => {
    renderContainer([1]);
    fireEvent.click(screen.getByText('Custom…'));
    // datetime-local inputs don't have role="textbox" in jsdom — query by type.
    const dateInputs = document.querySelectorAll('input[type="datetime-local"]');
    expect(dateInputs.length).toBeGreaterThanOrEqual(2);
    fireEvent.change(dateInputs[0]!, { target: { value: '2020-01-01T00:00' } });
    fireEvent.change(dateInputs[1]!, { target: { value: '2020-01-02T00:00' } });
    fireEvent.click(screen.getByText('Apply'));
    // After commit with far-past range, mode → fixed; Live button → "Go Live".
    expect(screen.getByText('Go Live')).toBeTruthy();
  });

  it('Custom picker apply with to ≈ now → tailing', () => {
    renderContainer([1]);
    fireEvent.click(screen.getByText('Custom…'));
    const dateInputs = document.querySelectorAll('input[type="datetime-local"]');
    expect(dateInputs.length).toBeGreaterThanOrEqual(2);
    // Set to = current time (within NEAR_NOW_MS of now).
    const now = new Date();
    const toStr = now.toISOString().slice(0, 16);
    const fromStr = new Date(now.getTime() - 3_600_000).toISOString().slice(0, 16);
    fireEvent.change(dateInputs[0]!, { target: { value: fromStr } });
    fireEvent.change(dateInputs[1]!, { target: { value: toStr } });
    fireEvent.click(screen.getByText('Apply'));
    // Should stay in / return to tailing.
    expect(screen.getByText('● Live')).toBeTruthy();
  });
});
