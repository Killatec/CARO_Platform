import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CursorDisplay } from '../src/CursorDisplay.js';

// ── Cursor text queries use { selector: 'span' } because CursorDisplay now
// renders a flex row <div> whose textContent also starts with "Cursor:".
// Restricting to span avoids the multi-match error.

describe('CursorDisplay', () => {
  it('shows "Cursor: --" when cursorTsMs is null', () => {
    render(<CursorDisplay cursorTsMs={null} />);
    expect(screen.getByText(/^Cursor:/, { selector: 'span' }).textContent).toBe('Cursor: --');
  });

  it('shows "Cursor: --" when cursorTsMs is undefined (omitted)', () => {
    render(<CursorDisplay cursorTsMs={undefined as unknown as null} />);
    expect(screen.getByText(/^Cursor:/, { selector: 'span' }).textContent).toBe('Cursor: --');
  });

  it('formats a real timestamp in dd-mmm-yyyy HH:mm:ss form', () => {
    // 2024-01-15 12:00:00 UTC
    render(<CursorDisplay cursorTsMs={1_705_320_000_000} siteTimezone="UTC" />);
    const el = screen.getByText(/^Cursor:/, { selector: 'span' });
    expect(el.textContent).not.toBe('Cursor: --');
    expect(el.textContent).toContain('15-Jan-2024');
    expect(el.textContent).toContain('12:00:00');
  });

  it('produces different output for different timezones at the same timestamp', () => {
    const tsMs = 1_705_320_000_000;

    const { unmount } = render(<CursorDisplay cursorTsMs={tsMs} siteTimezone="America/Chicago" />);
    const chicagoText = screen.getByText(/^Cursor:/, { selector: 'span' }).textContent;
    unmount();

    render(<CursorDisplay cursorTsMs={tsMs} siteTimezone="Asia/Tokyo" />);
    const tokyoText = screen.getByText(/^Cursor:/, { selector: 'span' }).textContent;

    expect(chicagoText).not.toBe(tokyoText);
  });

  // ── rangeMessage prop ─────────────────────────────────────────────────────

  it('without rangeMessage: only cursor span present, no range text', () => {
    render(<CursorDisplay cursorTsMs={null} />);
    expect(screen.queryByText(/Range too wide/)).toBeNull();
    expect(screen.getByText(/^Cursor:/, { selector: 'span' })).toBeTruthy();
  });

  it('with over-range rangeMessage: both cursor text and message text present', () => {
    const msg = 'Range too wide. Zoom in or pick a smaller preset.';
    render(<CursorDisplay cursorTsMs={null} rangeMessage={msg} />);
    expect(screen.getByText(/^Cursor:/, { selector: 'span' }).textContent).toBe('Cursor: --');
    expect(screen.getByText(msg)).toBeTruthy();
  });

  it('with under-range rangeMessage: both cursor text and message text present', () => {
    const msg = 'Range too narrow. Zoom out or pick a wider preset.';
    render(<CursorDisplay cursorTsMs={null} rangeMessage={msg} />);
    expect(screen.getByText(/^Cursor:/, { selector: 'span' }).textContent).toBe('Cursor: --');
    expect(screen.getByText(msg)).toBeTruthy();
  });

  it('rangeMessage=null: message span absent', () => {
    render(<CursorDisplay cursorTsMs={null} rangeMessage={null} />);
    expect(screen.queryByText(/Range too wide/)).toBeNull();
    expect(screen.queryByText(/Range too narrow/)).toBeNull();
  });

  it('row lineHeight is 16px — no layout reflow when message toggles', () => {
    // jsdom cannot measure layout, but locking in the computed style value
    // documents the contract: the row must not grow when the message appears.
    const { container } = render(<CursorDisplay cursorTsMs={null} />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.style.lineHeight).toBe('16px');
  });
});
