import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CursorDisplay } from '../src/CursorDisplay.js';

describe('CursorDisplay', () => {
  it('shows "Cursor: --" when cursorTsMs is null', () => {
    render(<CursorDisplay cursorTsMs={null} />);
    expect(screen.getByText(/^Cursor:/).textContent).toBe('Cursor: --');
  });

  it('shows "Cursor: --" when cursorTsMs is undefined (omitted)', () => {
    render(<CursorDisplay cursorTsMs={undefined as unknown as null} />);
    expect(screen.getByText(/^Cursor:/).textContent).toBe('Cursor: --');
  });

  it('formats a real timestamp in dd-mmm-yyyy HH:mm:ss form', () => {
    // 2024-01-15 12:00:00 UTC
    render(<CursorDisplay cursorTsMs={1_705_320_000_000} siteTimezone="UTC" />);
    const el = screen.getByText(/^Cursor:/);
    expect(el.textContent).not.toBe('Cursor: --');
    expect(el.textContent).toContain('15-Jan-2024');
    expect(el.textContent).toContain('12:00:00');
  });

  it('produces different output for different timezones at the same timestamp', () => {
    const tsMs = 1_705_320_000_000;

    const { unmount } = render(<CursorDisplay cursorTsMs={tsMs} siteTimezone="America/Chicago" />);
    const chicagoText = screen.getByText(/^Cursor:/).textContent;
    unmount();

    render(<CursorDisplay cursorTsMs={tsMs} siteTimezone="Asia/Tokyo" />);
    const tokyoText = screen.getByText(/^Cursor:/).textContent;

    expect(chicagoText).not.toBe(tokyoText);
  });
});
