import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BucketFetchIndicator } from '../src/BucketFetchIndicator.js';

describe('BucketFetchIndicator', () => {
  it('shows em-dash for Bucket Size when bucketSMs is null', () => {
    render(<BucketFetchIndicator bucketSMs={null} lastFetchMs={null} />);
    expect(screen.getByText('Bucket Size: —')).toBeTruthy();
  });

  it('shows formatted bucket size when bucketSMs is provided', () => {
    render(<BucketFetchIndicator bucketSMs={3_600n} lastFetchMs={null} />);
    expect(screen.getByText('Bucket Size: 3.6 s')).toBeTruthy();
  });

  it('formats minute-range buckets correctly', () => {
    render(<BucketFetchIndicator bucketSMs={60_000n} lastFetchMs={null} />);
    expect(screen.getByText('Bucket Size: 1 min')).toBeTruthy();
  });

  it('shows em-dash for Last Fetch when lastFetchMs is null', () => {
    render(<BucketFetchIndicator bucketSMs={null} lastFetchMs={null} />);
    expect(screen.getByText('Last Fetch: —')).toBeTruthy();
  });

  it('renders Last Fetch with non-null lastFetchMs', () => {
    render(<BucketFetchIndicator bucketSMs={3_600n} lastFetchMs={234} />);
    expect(screen.getByText('Bucket Size: 3.6 s')).toBeTruthy();
    expect(screen.getByText('Last Fetch: 234 ms')).toBeTruthy();
  });

  it('formats Last Fetch in seconds when ≥ 1000 ms', () => {
    render(<BucketFetchIndicator bucketSMs={null} lastFetchMs={1230} />);
    expect(screen.getByText('Last Fetch: 1.23 s')).toBeTruthy();
  });

  it('updates when props change', () => {
    const { rerender } = render(<BucketFetchIndicator bucketSMs={null} lastFetchMs={null} />);
    expect(screen.getByText('Bucket Size: —')).toBeTruthy();
    expect(screen.getByText('Last Fetch: —')).toBeTruthy();
    rerender(<BucketFetchIndicator bucketSMs={60_000n} lastFetchMs={88} />);
    expect(screen.getByText('Bucket Size: 1 min')).toBeTruthy();
    expect(screen.getByText('Last Fetch: 88 ms')).toBeTruthy();
  });
});
