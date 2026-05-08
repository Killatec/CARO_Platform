import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SpanPresets } from '../src/SpanPresets.js';
import type { ModeState } from '../src/useTrendMode.js';

const NOW = 1_700_000_000_000n;

const TAILING_1H: ModeState = {
  mode: 'tailing',
  sizeMs: 3_600_000n,
  nowMs: NOW,
  lastIntent: null,
};

const FIXED_1H: ModeState = {
  mode: 'fixed',
  from: NOW - 7_200_000n,
  to: NOW - 3_600_000n,
  sizeMs: 3_600_000n,
  lastIntent: null,
};

describe('SpanPresets', () => {
  it('renders all eight preset buttons', () => {
    render(<SpanPresets state={TAILING_1H} onPreset={vi.fn()} />);
    expect(screen.getByText('1m')).toBeTruthy();
    expect(screen.getByText('5m')).toBeTruthy();
    expect(screen.getByText('15m')).toBeTruthy();
    expect(screen.getByText('1h')).toBeTruthy();
    expect(screen.getByText('4h')).toBeTruthy();
    expect(screen.getByText('24h')).toBeTruthy();
    expect(screen.getByText('7d')).toBeTruthy();
    expect(screen.getByText('14d')).toBeTruthy();
  });

  it('calls onPreset with 1m sizeMs for the 1m button', () => {
    const onPreset = vi.fn();
    render(<SpanPresets state={TAILING_1H} onPreset={onPreset} />);
    fireEvent.click(screen.getByText('1m'));
    expect(onPreset).toHaveBeenCalledWith(60_000n);
  });

  it('calls onPreset with 5m sizeMs for the 5m button', () => {
    const onPreset = vi.fn();
    render(<SpanPresets state={TAILING_1H} onPreset={onPreset} />);
    fireEvent.click(screen.getByText('5m'));
    expect(onPreset).toHaveBeenCalledWith(300_000n);
  });

  it('calls onPreset with correct sizeMs when a button is clicked', () => {
    const onPreset = vi.fn();
    render(<SpanPresets state={TAILING_1H} onPreset={onPreset} />);
    fireEvent.click(screen.getByText('4h'));
    expect(onPreset).toHaveBeenCalledWith(4n * 60n * 60_000n);
  });

  it('calls onPreset with 14d sizeMs for the 14d button', () => {
    const onPreset = vi.fn();
    render(<SpanPresets state={TAILING_1H} onPreset={onPreset} />);
    fireEvent.click(screen.getByText('14d'));
    expect(onPreset).toHaveBeenCalledWith(14n * 24n * 60n * 60_000n);
  });

  // ── Highlight rule: lastIntent === 'preset' && sizeMs matches ────────────────

  it('no highlight when lastIntent is null (initial state)', () => {
    render(<SpanPresets state={TAILING_1H} onPreset={vi.fn()} />);
    const btn = screen.getByText('1h');
    // Default button has white background, not the active blue.
    expect(btn.style.background).not.toBe('rgb(37, 99, 235)');
  });

  it('highlights the matching preset when lastIntent is "preset"', () => {
    const state: ModeState = { ...TAILING_1H, lastIntent: 'preset' };
    render(<SpanPresets state={state} onPreset={vi.fn()} />);
    const btn1h = screen.getByText('1h');
    expect(btn1h.style.background).toBe('rgb(37, 99, 235)');
  });

  it('does not highlight a non-matching preset even when lastIntent is "preset"', () => {
    const state: ModeState = { ...TAILING_1H, lastIntent: 'preset' }; // sizeMs = 1h
    render(<SpanPresets state={state} onPreset={vi.fn()} />);
    const btn4h = screen.getByText('4h');
    expect(btn4h.style.background).not.toBe('rgb(37, 99, 235)');
  });

  it('highlights the matching preset when lastIntent is "pan" and sizeMs matches', () => {
    const state: ModeState = { ...TAILING_1H, lastIntent: 'pan' }; // sizeMs = 1h
    render(<SpanPresets state={state} onPreset={vi.fn()} />);
    expect(screen.getByText('1h').style.background).toBe('rgb(37, 99, 235)');
  });

  it('does not highlight when lastIntent is "pan" but sizeMs does not match any preset', () => {
    const state: ModeState = { ...TAILING_1H, sizeMs: 999_999n, lastIntent: 'pan' };
    render(<SpanPresets state={state} onPreset={vi.fn()} />);
    expect(screen.getByText('1h').style.background).not.toBe('rgb(37, 99, 235)');
    expect(screen.getByText('4h').style.background).not.toBe('rgb(37, 99, 235)');
  });

  it('clears highlight when lastIntent is "zoom" (zoom derives size from drag, not a preset)', () => {
    // Even if sizeMs coincidentally matches a preset, zoom must not highlight.
    const state: ModeState = { ...TAILING_1H, lastIntent: 'zoom' }; // sizeMs = 1h
    render(<SpanPresets state={state} onPreset={vi.fn()} />);
    expect(screen.getByText('1h').style.background).not.toBe('rgb(37, 99, 235)');
  });

  it('highlights when lastIntent is "live" and sizeMs matches (Live button preserves sizeMs)', () => {
    const state: ModeState = { ...TAILING_1H, lastIntent: 'live' }; // sizeMs = 1h
    render(<SpanPresets state={state} onPreset={vi.fn()} />);
    expect(screen.getByText('1h').style.background).toBe('rgb(37, 99, 235)');
  });

  it('does not highlight "live" when sizeMs does not match any preset', () => {
    const state: ModeState = { ...TAILING_1H, sizeMs: 999_999n, lastIntent: 'live' };
    render(<SpanPresets state={state} onPreset={vi.fn()} />);
    expect(screen.getByText('1h').style.background).not.toBe('rgb(37, 99, 235)');
  });

  it('highlights when lastIntent is "endPicker" and sizeMs is preserved from a prior preset', () => {
    const state: ModeState = { ...FIXED_1H, lastIntent: 'endPicker' }; // sizeMs = 1h
    render(<SpanPresets state={state} onPreset={vi.fn()} />);
    expect(screen.getByText('1h').style.background).toBe('rgb(37, 99, 235)');
  });

  it('does not highlight "endPicker" when sizeMs does not match any preset', () => {
    const state: ModeState = { ...FIXED_1H, sizeMs: 999_999n, lastIntent: 'endPicker' };
    render(<SpanPresets state={state} onPreset={vi.fn()} />);
    expect(screen.getByText('1h').style.background).not.toBe('rgb(37, 99, 235)');
  });

  // ── Highlight works in fixed mode ────────────────────────────────────────────

  it('highlights preset in fixed mode when lastIntent is "preset" and sizeMs matches', () => {
    const state: ModeState = { ...FIXED_1H, lastIntent: 'preset' }; // sizeMs = 1h
    render(<SpanPresets state={state} onPreset={vi.fn()} />);
    expect(screen.getByText('1h').style.background).toBe('rgb(37, 99, 235)');
  });

  it('no highlight in fixed mode when lastIntent is null', () => {
    render(<SpanPresets state={FIXED_1H} onPreset={vi.fn()} />);
    expect(screen.getByText('1h').style.background).not.toBe('rgb(37, 99, 235)');
  });
});
