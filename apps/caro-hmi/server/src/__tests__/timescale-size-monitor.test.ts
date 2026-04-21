import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@caro/db', () => ({
  getTimescaleDatabaseSizeBytes: vi.fn(),
}));

import { getTimescaleDatabaseSizeBytes } from '@caro/db';
import { TimescaleSizeMonitor } from '../timescale-size-monitor.js';

const mockGetSize = vi.mocked(getTimescaleDatabaseSizeBytes);

beforeEach(() => {
  mockGetSize.mockResolvedValue(1_000_000_000n);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

// ── Initial state ─────────────────────────────────────────────────────────────

describe('TimescaleSizeMonitor — initial state', () => {
  it('sizeBytes is 0n and sizeGB is 0 before first poll', () => {
    const monitor = new TimescaleSizeMonitor({ pollMs: 60_000 });
    expect(monitor.sizeBytes).toBe(0n);
    expect(monitor.sizeGB).toBe(0);
  });
});

// ── start() primes immediately ────────────────────────────────────────────────

describe('TimescaleSizeMonitor — start() primes immediately', () => {
  it('sizeBytes reflects the first poll before the first interval fires', async () => {
    mockGetSize.mockResolvedValue(5_000_000_000n);
    const monitor = new TimescaleSizeMonitor({ pollMs: 60_000 });
    monitor.start();
    await Promise.resolve(); // tick 1: mock promise resolves
    await Promise.resolve(); // tick 2: async function body after await settles
    await monitor.stop();
    expect(monitor.sizeBytes).toBe(5_000_000_000n);
  });
});

// ── Interval polling ──────────────────────────────────────────────────────────

describe('TimescaleSizeMonitor — interval polling', () => {
  it('calls getTimescaleDatabaseSizeBytes 4 times (1 prime + 3 intervals)', async () => {
    vi.useFakeTimers();
    mockGetSize.mockResolvedValue(1n);
    const monitor = new TimescaleSizeMonitor({ pollMs: 1_000 });
    monitor.start();
    await Promise.resolve(); // prime resolves
    await vi.advanceTimersByTimeAsync(3_000); // fires 3 interval ticks
    await monitor.stop();
    expect(mockGetSize).toHaveBeenCalledTimes(4);
  });
});

// ── Error handling ────────────────────────────────────────────────────────────

describe('TimescaleSizeMonitor — error handling', () => {
  it('holds previous value on poll error and logs warn once', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      mockGetSize
        .mockResolvedValueOnce(3_000_000_000n)   // prime succeeds
        .mockRejectedValueOnce(new Error('connection refused')); // interval fails

      const monitor = new TimescaleSizeMonitor({ pollMs: 1_000 });
      monitor.start();
      await Promise.resolve(); // prime resolves

      await vi.advanceTimersByTimeAsync(1_000); // fires failing interval

      expect(monitor.sizeBytes).toBe(3_000_000_000n); // previous value held
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('[TimescaleSizeMonitor]'),
        expect.stringContaining('connection refused'),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ── stop() ────────────────────────────────────────────────────────────────────

describe('TimescaleSizeMonitor — stop()', () => {
  it('clears the interval — no further polls after stop', async () => {
    vi.useFakeTimers();
    mockGetSize.mockResolvedValue(1n);
    const monitor = new TimescaleSizeMonitor({ pollMs: 100 });
    monitor.start();
    await Promise.resolve(); // prime resolves

    await monitor.stop();
    vi.clearAllMocks(); // reset call count

    vi.advanceTimersByTime(1_000); // advance past several intervals
    await Promise.resolve();

    expect(mockGetSize).not.toHaveBeenCalled();
  });
});

// ── sizeGB conversion ─────────────────────────────────────────────────────────

describe('TimescaleSizeMonitor — sizeGB', () => {
  it('sizeGB equals Number(sizeBytes) / 1e9', async () => {
    mockGetSize.mockResolvedValue(2_500_000_000n);
    const monitor = new TimescaleSizeMonitor({ pollMs: 60_000 });
    monitor.start();
    await Promise.resolve(); // tick 1: mock promise resolves
    await Promise.resolve(); // tick 2: async function body after await settles
    await monitor.stop();
    expect(monitor.sizeGB).toBeCloseTo(2.5);
  });
});
