import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CursorDisplay } from '../src/CursorDisplay.js';

describe('CursorDisplay', () => {
  it('renders nothing visible when no rangeMessage', () => {
    render(<CursorDisplay />);
    expect(screen.queryByText(/Range too wide/)).toBeNull();
    expect(screen.queryByText(/Range too narrow/)).toBeNull();
  });

  it('renders the over-range message when provided', () => {
    const msg = 'Range too wide. Zoom in or pick a smaller preset.';
    render(<CursorDisplay rangeMessage={msg} />);
    expect(screen.getByText(msg)).toBeTruthy();
  });

  it('renders the under-range message when provided', () => {
    const msg = 'Range too narrow. Zoom out or pick a wider preset.';
    render(<CursorDisplay rangeMessage={msg} />);
    expect(screen.getByText(msg)).toBeTruthy();
  });

  it('rangeMessage=null: message span absent', () => {
    render(<CursorDisplay rangeMessage={null} />);
    expect(screen.queryByText(/Range too wide/)).toBeNull();
    expect(screen.queryByText(/Range too narrow/)).toBeNull();
  });

  it('row lineHeight is 16px — no layout reflow when message toggles', () => {
    const { container } = render(<CursorDisplay />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.style.lineHeight).toBe('16px');
  });
});
