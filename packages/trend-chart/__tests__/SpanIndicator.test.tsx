import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SpanIndicator } from '../src/SpanIndicator.js';

describe('SpanIndicator', () => {
  it('renders the formatted span', () => {
    render(<SpanIndicator spanMs={3_600_000n} />);
    expect(screen.getByText('Span: 1 h')).toBeTruthy();
  });

  it('formats minutes correctly', () => {
    render(<SpanIndicator spanMs={2_700_000n} />);
    expect(screen.getByText('Span: 45 min')).toBeTruthy();
  });

  it('updates when spanMs prop changes', () => {
    const { rerender } = render(<SpanIndicator spanMs={3_600_000n} />);
    expect(screen.getByText('Span: 1 h')).toBeTruthy();
    rerender(<SpanIndicator spanMs={14_400_000n} />);
    expect(screen.getByText('Span: 4 h')).toBeTruthy();
  });
});
