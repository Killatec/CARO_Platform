import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SpanBucketIndicator } from '../src/SpanBucketIndicator.js';

describe('SpanBucketIndicator', () => {
  it('renders Span line with formatted span', () => {
    render(<SpanBucketIndicator spanMs={3_600_000n} bucketSMs={3_600n} />);
    expect(screen.getByText('Span: 1 h')).toBeTruthy();
  });

  it('renders Bucket Size line with formatted bucket', () => {
    render(<SpanBucketIndicator spanMs={3_600_000n} bucketSMs={3_600n} />);
    expect(screen.getByText('Bucket Size: 3.6 s')).toBeTruthy();
  });

  it('shows "Bucket Size: --" when bucketSMs is null', () => {
    render(<SpanBucketIndicator spanMs={3_600_000n} bucketSMs={null} />);
    expect(screen.getByText('Bucket Size: --')).toBeTruthy();
  });

  it('formats minute-range buckets correctly', () => {
    render(<SpanBucketIndicator spanMs={86_400_000n} bucketSMs={60_000n} />);
    expect(screen.getByText('Bucket Size: 1 min')).toBeTruthy();
  });

  it('formats hour-range buckets correctly', () => {
    render(<SpanBucketIndicator spanMs={604_800_000n} bucketSMs={3_600_000n} />);
    expect(screen.getByText('Bucket Size: 1 h')).toBeTruthy();
  });

  it('updates both lines when props change', () => {
    const { rerender } = render(<SpanBucketIndicator spanMs={3_600_000n} bucketSMs={3_600n} />);
    expect(screen.getByText('Span: 1 h')).toBeTruthy();
    rerender(<SpanBucketIndicator spanMs={14_400_000n} bucketSMs={14_400n} />);
    expect(screen.getByText('Span: 4 h')).toBeTruthy();
    expect(screen.getByText('Bucket Size: 14.4 s')).toBeTruthy();
  });
});
