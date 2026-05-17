import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EndPicker } from '../src/EndPicker.js';
import { formatDateTime } from '@caro/ui';
import type { ModeState } from '../src/useTrendMode.js';
import type { Viewport } from '../src/types.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000_000n;
const ONE_HOUR = 3_600_000n;

// 2023-11-14T22:13:20.000Z
const VIEWPORT: Viewport = { start: NOW - ONE_HOUR, end: NOW };

const LIVE_TRAILING: ModeState = { mode: 'live-trailing', sizeMs: ONE_HOUR, nowMs: NOW, lastIntent: null };
const FIXED: ModeState = { mode: 'fixed', from: NOW - ONE_HOUR, to: NOW, sizeMs: ONE_HOUR, lastIntent: null };

function renderPicker(opts: {
  state?: ModeState;
  viewport?: Viewport;
  onEndCommitted?: (to: bigint) => void;
  onLive?: () => void;
} = {}) {
  const onEndCommitted = opts.onEndCommitted ?? vi.fn();
  const onLive = opts.onLive ?? vi.fn();
  return {
    onEndCommitted,
    onLive,
    ...render(
      <EndPicker
        state={opts.state ?? LIVE_TRAILING}
        viewport={opts.viewport ?? VIEWPORT}
        siteTimezone="UTC"
        onEndCommitted={onEndCommitted}
        onLive={onLive}
      />,
    ),
  };
}

function getHiddenInput() {
  return document.querySelector('input[type="datetime-local"]') as HTMLInputElement;
}

// ── showPicker mock ───────────────────────────────────────────────────────────

let mockShowPicker: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockShowPicker = vi.fn();
  Object.defineProperty(HTMLInputElement.prototype, 'showPicker', {
    value: mockShowPicker,
    writable: true,
    configurable: true,
  });
});

// ── Initial render ─────────────────────────────────────────────────────────────

describe('EndPicker — initial render', () => {
  it('display button shows viewport.end in dd-mmm-yyyy HH:mm:ss format', () => {
    renderPicker();
    const expected = formatDateTime(VIEWPORT.end, { timezone: 'UTC' });
    const btn = screen.getByRole('button', { name: /pick end time/i });
    expect(btn.textContent).toContain(expected);
  });

  it('display text includes seconds', () => {
    renderPicker();
    const btn = screen.getByRole('button', { name: /pick end time/i });
    // dd-mmm-yyyy HH:mm:ss — must contain two colons (HH:mm:ss)
    const matches = btn.textContent?.match(/:/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it('shows "● Live" button in tailing mode', () => {
    renderPicker({ state: LIVE_TRAILING });
    expect(screen.getByText('● Live')).toBeTruthy();
  });

  it('shows "Go Live" button in fixed mode', () => {
    renderPicker({ state: FIXED });
    expect(screen.getByText('Go Live')).toBeTruthy();
  });

  it('hidden input is in the DOM (off-screen, not display:none)', () => {
    renderPicker();
    const input = getHiddenInput();
    expect(input).not.toBeNull();
    expect(input.type).toBe('datetime-local');
    expect(input.step).toBe('1');
  });
});

// ── Picker open ───────────────────────────────────────────────────────────────

describe('EndPicker — opening the picker', () => {
  it('clicking the display button calls showPicker on the hidden input', () => {
    renderPicker();
    const btn = screen.getByRole('button', { name: /pick end time/i });
    fireEvent.click(btn);
    expect(mockShowPicker).toHaveBeenCalledOnce();
  });

  it('sets hidden input value to viewport.end before calling showPicker', () => {
    renderPicker();
    const btn = screen.getByRole('button', { name: /pick end time/i });
    fireEvent.click(btn);
    const input = getHiddenInput();
    // Value must be "YYYY-MM-DDTHH:mm:ss" (jsdom may append ".000" milliseconds with step=1).
    expect(input.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/);
  });

  it('Enter key on display button calls showPicker', () => {
    renderPicker();
    const btn = screen.getByRole('button', { name: /pick end time/i });
    fireEvent.keyDown(btn, { key: 'Enter' });
    expect(mockShowPicker).toHaveBeenCalledOnce();
  });

  it('Space key on display button calls showPicker', () => {
    renderPicker();
    const btn = screen.getByRole('button', { name: /pick end time/i });
    fireEvent.keyDown(btn, { key: ' ' });
    expect(mockShowPicker).toHaveBeenCalledOnce();
  });
});

// ── Commit on change ──────────────────────────────────────────────────────────

describe('EndPicker — commit on picker change', () => {
  it('change on hidden input → onEndCommitted called with a bigint', () => {
    const { onEndCommitted } = renderPicker();
    fireEvent.change(getHiddenInput(), { target: { value: '2020-01-01T00:00:00' } });
    expect(onEndCommitted).toHaveBeenCalledOnce();
    expect(typeof onEndCommitted.mock.calls[0]![0]).toBe('bigint');
  });

  it('change with far-past value → onEndCommitted called', () => {
    const { onEndCommitted } = renderPicker();
    fireEvent.change(getHiddenInput(), { target: { value: '2010-06-15T08:30:00' } });
    expect(onEndCommitted).toHaveBeenCalledOnce();
  });

  it('change with empty value → onEndCommitted NOT called', () => {
    const { onEndCommitted } = renderPicker();
    fireEvent.change(getHiddenInput(), { target: { value: '' } });
    expect(onEndCommitted).not.toHaveBeenCalled();
  });

  it('change with short invalid value → onEndCommitted NOT called', () => {
    const { onEndCommitted } = renderPicker();
    fireEvent.change(getHiddenInput(), { target: { value: '2020' } });
    expect(onEndCommitted).not.toHaveBeenCalled();
  });
});

// ── viewport.end sync ─────────────────────────────────────────────────────────

describe('EndPicker — viewport.end sync', () => {
  it('re-syncs display text when viewport.end changes via rerender', () => {
    const { rerender } = render(
      <EndPicker
        state={LIVE_TRAILING}
        viewport={VIEWPORT}
        siteTimezone="UTC"
        onEndCommitted={vi.fn()}
        onLive={vi.fn()}
      />,
    );
    const newEnd = NOW + 600_000n; // 10 min later
    rerender(
      <EndPicker
        state={LIVE_TRAILING}
        viewport={{ start: VIEWPORT.start + 600_000n, end: newEnd }}
        siteTimezone="UTC"
        onEndCommitted={vi.fn()}
        onLive={vi.fn()}
      />,
    );
    const btn = screen.getByRole('button', { name: /pick end time/i });
    expect(btn.textContent).toContain(formatDateTime(newEnd, { timezone: 'UTC' }));
  });
});

// ── Live button ───────────────────────────────────────────────────────────────

describe('EndPicker — Live button', () => {
  it('calls onLive when "● Live" clicked', () => {
    const { onLive } = renderPicker({ state: LIVE_TRAILING });
    fireEvent.click(screen.getByText('● Live'));
    expect(onLive).toHaveBeenCalledOnce();
  });

  it('calls onLive when "Go Live" clicked in fixed mode', () => {
    const { onLive } = renderPicker({ state: FIXED });
    fireEvent.click(screen.getByText('Go Live'));
    expect(onLive).toHaveBeenCalledOnce();
  });
});
