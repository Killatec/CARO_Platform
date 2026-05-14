import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SpanBucketIndicator } from '../src/SpanBucketIndicator.js';

describe('SpanBucketIndicator', () => {
  it('renders Span line with formatted span', () => {
    render(<SpanBucketIndicator spanMs={3_600_000n} bucketSMs={3_600n} lastFetchMs={null} />);
    expect(screen.getByText('Span: 1 h')).toBeTruthy();
  });

  it('renders Bucket Size line with formatted bucket', () => {
    render(<SpanBucketIndicator spanMs={3_600_000n} bucketSMs={3_600n} lastFetchMs={null} />);
    expect(screen.getByText('Bucket Size: 3.6 s buckets')).toBeTruthy();
  });

  it('shows em-dash for Bucket Size when bucketSMs is null', () => {
    render(<SpanBucketIndicator spanMs={3_600_000n} bucketSMs={null} lastFetchMs={null} />);
    expect(screen.getByText('Bucket Size: —')).toBeTruthy();
  });

  it('formats minute-range buckets correctly', () => {
    render(<SpanBucketIndicator spanMs={86_400_000n} bucketSMs={60_000n} lastFetchMs={null} />);
    expect(screen.getByText('Bucket Size: 1 min buckets')).toBeTruthy();
  });

  it('formats hour-range buckets correctly', () => {
    render(<SpanBucketIndicator spanMs={604_800_000n} bucketSMs={3_600_000n} lastFetchMs={null} />);
    expect(screen.getByText('Bucket Size: 1 h buckets')).toBeTruthy();
  });

  it('updates both lines when props change', () => {
    const { rerender } = render(<SpanBucketIndicator spanMs={3_600_000n} bucketSMs={3_600n} lastFetchMs={null} />);
    expect(screen.getByText('Span: 1 h')).toBeTruthy();
    rerender(<SpanBucketIndicator spanMs={14_400_000n} bucketSMs={14_400n} lastFetchMs={null} />);
    expect(screen.getByText('Span: 4 h')).toBeTruthy();
    expect(screen.getByText('Bucket Size: 14.4 s buckets')).toBeTruthy();
  });

  // ── Last Fetch line ─────────────────────────────────────────────────────────

  it('shows em-dash for Last Fetch when lastFetchMs is null', () => {
    render(<SpanBucketIndicator spanMs={3_600_000n} bucketSMs={3_600n} lastFetchMs={null} />);
    expect(screen.getByText('Last Fetch: —')).toBeTruthy();
  });

  it('renders all three lines with non-null lastFetchMs', () => {
    render(<SpanBucketIndicator spanMs={3_600_000n} bucketSMs={3_600n} lastFetchMs={234} />);
    expect(screen.getByText('Span: 1 h')).toBeTruthy();
    expect(screen.getByText('Bucket Size: 3.6 s buckets')).toBeTruthy();
    expect(screen.getByText('Last Fetch: 234 ms')).toBeTruthy();
  });

  it('formats Last Fetch in seconds when ≥ 1000 ms', () => {
    render(<SpanBucketIndicator spanMs={3_600_000n} bucketSMs={3_600n} lastFetchMs={1230} />);
    expect(screen.getByText('Last Fetch: 1.23 s')).toBeTruthy();
  });

  it('formats Last Fetch in minutes when ≥ 60 000 ms', () => {
    render(<SpanBucketIndicator spanMs={3_600_000n} bucketSMs={3_600n} lastFetchMs={90_000} />);
    expect(screen.getByText('Last Fetch: 1.5 min')).toBeTruthy();
  });

  it('updates Last Fetch line when lastFetchMs prop changes', () => {
    const { rerender } = render(
      <SpanBucketIndicator spanMs={3_600_000n} bucketSMs={3_600n} lastFetchMs={null} />,
    );
    expect(screen.getByText('Last Fetch: —')).toBeTruthy();
    rerender(<SpanBucketIndicator spanMs={3_600_000n} bucketSMs={3_600n} lastFetchMs={88} />);
    expect(screen.getByText('Last Fetch: 88 ms')).toBeTruthy();
  });
});
