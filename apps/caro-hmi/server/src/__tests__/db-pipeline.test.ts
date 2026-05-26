import { describe, it, expect, vi, afterEach } from 'vitest';
import { DbPipeline, NullDbWriter } from '../db-pipeline.js';
import type { DbWriteEntry, DbWriter } from '../db-pipeline.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEntry(moduleTs: number, tagIds: number[] = []): DbWriteEntry {
  return { moduleTs, tags: tagIds.map(id => ({ tagId: id, value: id })) };
}

function makeWriter() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const write = vi.fn<any[], Promise<void>>().mockResolvedValue(undefined);
  return { write, name: 'test' } satisfies DbWriter;
}

function makeFailWriter(name = 'fail'): DbWriter {
  return {
    write: vi.fn<[DbWriteEntry[]], Promise<void>>().mockRejectedValue(new Error('disk full')),
    name,
  };
}

// ── NullDbWriter ──────────────────────────────────────────────────────────────

describe('NullDbWriter', () => {
  it('write throws with a no-historian error', async () => {
    const writer = new NullDbWriter();
    await expect(writer.write([])).rejects.toThrow('No historian configured');
  });
});

// ── Enqueue / backpressure ────────────────────────────────────────────────────

describe('DbPipeline — enqueue / backpressure', () => {
  it('enqueue up to queueMax is lossless', () => {
    const p = new DbPipeline(makeWriter(), { queueMax: 10 });
    for (let i = 0; i < 10; i++) p.enqueue(makeEntry(i, [i]));
    expect(p.queueLength).toBe(10);
    expect(p.droppedPkgsTotal).toBe(0);
  });

  it('drops oldest entry and increments droppedPkgsTotal when over cap', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = new DbPipeline(makeWriter(), { queueMax: 3 });
    for (let i = 0; i < 5; i++) p.enqueue(makeEntry(i, [i]));
    expect(p.queueLength).toBe(3);
    expect(p.droppedPkgsTotal).toBe(2);
    warnSpy.mockRestore();
  });

  it('clips droppedPkgsTotal at 9999', () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const p = new DbPipeline(makeWriter(), { queueMax: 1 });
      for (let i = 0; i < 10001; i++) {
        if (i % 100 === 0) vi.advanceTimersByTime(5000);
        p.enqueue(makeEntry(i));
      }
      expect(p.droppedPkgsTotal).toBe(9999);
    } finally {
      vi.useRealTimers();
      warnSpy.mockRestore();
    }
  });

  it('clips errorCountTotal at 9999', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const p = new DbPipeline(makeFailWriter());
    p.enqueue(makeEntry(1, [1]));
    for (let i = 0; i < 10001; i++) {
      await p.flushOnce();
    }
    expect(p.errorCountTotal).toBe(9999);
    errSpy.mockRestore();
  });
});

// ── flushOnce semantics ───────────────────────────────────────────────────────

describe('DbPipeline — flushOnce semantics', () => {
  it('flush calls writer.write with a batch of up to maxEntriesPerFlush', async () => {
    const writer = makeWriter();
    const p = new DbPipeline(writer, { maxEntriesPerFlush: 3 });
    for (let i = 0; i < 10; i++) p.enqueue(makeEntry(i, [i]));

    await p.flushOnce();

    expect(writer.write).toHaveBeenCalledTimes(1);
    expect(writer.write.mock.calls[0][0]).toHaveLength(3);
    expect(p.queueLength).toBe(7);
  });

  it('rowsWrittenTotal counts tag rows not entries', async () => {
    const writer = makeWriter();
    const p = new DbPipeline(writer);
    p.enqueue(makeEntry(1, [1, 2, 3]));
    p.enqueue(makeEntry(2, [4]));
    p.enqueue(makeEntry(3, [5, 6]));

    await p.flushOnce();

    expect(p.rowsWrittenTotal).toBe(6);
  });

  it('peek-then-consume leaves queue intact on writer failure', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const p = new DbPipeline(makeFailWriter());
    p.enqueue(makeEntry(1, [1]));
    p.enqueue(makeEntry(2, [2]));

    await p.flushOnce();

    expect(p.queueLength).toBe(2);
    errSpy.mockRestore();
  });

  it('inFlight guard skips an overlapping tick', async () => {
    vi.useFakeTimers();
    try {
      let resolveFirst!: () => void;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const write = vi.fn<any[], Promise<void>>()
        .mockImplementationOnce(() => new Promise<void>(r => { resolveFirst = r; }))
        .mockResolvedValue(undefined);
      const writer = { write, name: 'slow' } satisfies DbWriter;
      const p = new DbPipeline(writer, { tickMs: 100 });
      p.enqueue(makeEntry(1, [1]));
      p.start();

      vi.advanceTimersByTime(100);
      vi.advanceTimersByTime(100);

      expect(writer.write).toHaveBeenCalledTimes(1);

      resolveFirst();
      await p.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('historianHealthy latches false on error and recovers on next success', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let shouldFail = false;
    const writer: DbWriter = {
      write: vi.fn<[DbWriteEntry[]], Promise<void>>().mockImplementation(() =>
        shouldFail ? Promise.reject(new Error('fail')) : Promise.resolve(),
      ),
      name: 'conditional',
    };
    const p = new DbPipeline(writer);

    p.enqueue(makeEntry(1, [1]));
    await p.flushOnce();
    expect(p.historianHealthy).toBe(true);

    shouldFail = true;
    p.enqueue(makeEntry(2, [2]));
    await p.flushOnce();
    expect(p.historianHealthy).toBe(false);

    await p.flushOnce();
    expect(p.historianHealthy).toBe(false);

    shouldFail = false;
    await p.flushOnce();
    expect(p.historianHealthy).toBe(true);

    errSpy.mockRestore();
  });

  it('lastFlushMs is 0 before first success and >= 0 after', async () => {
    const writer = makeWriter();
    const p = new DbPipeline(writer);
    expect(p.lastFlushMs).toBe(0);
    p.enqueue(makeEntry(1, [1]));
    await p.flushOnce();
    expect(p.lastFlushMs).toBeGreaterThanOrEqual(0);
  });
});

// ── Start / stop lifecycle ────────────────────────────────────────────────────

describe('DbPipeline — start / stop lifecycle', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('stop awaits any in-flight flush before resolving', async () => {
    let resolveWrite!: () => void;
    const slowWriter: DbWriter = {
      write: vi.fn<[DbWriteEntry[]], Promise<void>>()
        .mockImplementationOnce(() => new Promise<void>(r => { resolveWrite = r; })),
      name: 'slow',
    };
    const p = new DbPipeline(slowWriter, { tickMs: 100 });
    p.enqueue(makeEntry(1, [1]));

    const flushPromise = p.flushOnce();
    expect(p.inFlight).toBe(true);

    const stopPromise = p.stop();

    let stopResolved = false;
    void stopPromise.then(() => { stopResolved = true; });
    await Promise.resolve();
    expect(stopResolved).toBe(false);

    resolveWrite();
    await flushPromise;
    await stopPromise;
    expect(stopResolved).toBe(true);
  });

  it('start is idempotent — stop after two starts halts all ticks', async () => {
    vi.useFakeTimers();
    const writer = makeWriter();
    const p = new DbPipeline(writer, { tickMs: 100 });
    for (let i = 0; i < 5; i++) p.enqueue(makeEntry(i, [i]));

    p.start();
    p.start();

    vi.advanceTimersByTime(100);
    await Promise.resolve();
    await Promise.resolve();
    const countAfterOneTick = writer.write.mock.calls.length;

    await p.stop();

    vi.advanceTimersByTime(500);
    await Promise.resolve();
    expect(writer.write.mock.calls.length).toBe(countAfterOneTick);
  });
});

// ── Tick-evaluated metrics: trending ─────────────────────────────────────────

describe('DbPipeline — trending', () => {
  it('is false on first boot before any flush', () => {
    const p = new DbPipeline(makeWriter());
    expect(p.trending).toBe(false);
  });

  it('is true after a successful flush that wrote rows', async () => {
    const p = new DbPipeline(makeWriter());
    p.enqueue(makeEntry(1, [1, 2]));
    await p.flushOnce();
    expect(p.trending).toBe(true);
  });

  it('drops to false immediately on the next idle flush tick', async () => {
    const p = new DbPipeline(makeWriter());
    p.enqueue(makeEntry(1, [1]));
    await p.flushOnce();
    expect(p.trending).toBe(true);

    await p.flushOnce(); // queue empty — idle tick
    expect(p.trending).toBe(false);
  });

  it('is false after a failed flush', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const p = new DbPipeline(makeFailWriter());
    p.enqueue(makeEntry(1, [1]));
    await p.flushOnce();
    expect(p.trending).toBe(false);
    errSpy.mockRestore();
  });

  it('is false under NullDbWriter across multiple ticks', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const p = new DbPipeline(new NullDbWriter());
    p.enqueue(makeEntry(1, [1]));
    await p.flushOnce();
    expect(p.trending).toBe(false);
    await p.flushOnce();
    expect(p.trending).toBe(false);
    errSpy.mockRestore();
  });

  it('holds steady (previous value) when an inFlight tick is skipped', async () => {
    let resolveFirst!: () => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const write = vi.fn<any[], Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>(r => { resolveFirst = r; }))
      .mockResolvedValue(undefined);
    const writer = { write, name: 'test' } satisfies DbWriter;
    const p = new DbPipeline(writer);
    p.enqueue(makeEntry(1, [1]));

    const flush1 = p.flushOnce(); // in-flight
    expect(p.inFlight).toBe(true);

    p.flushOnce(); // skipped — trending still at initial false
    expect(p.trending).toBe(false);

    resolveFirst();
    await flush1;
    expect(p.trending).toBe(true); // now evaluated after success
  });

  it('is stable across multiple reads between flush ticks', async () => {
    const p = new DbPipeline(makeWriter());
    p.enqueue(makeEntry(1, [1]));
    await p.flushOnce();
    const reads = [p.trending, p.trending, p.trending, p.trending];
    expect(new Set(reads).size).toBe(1);
    expect(reads[0]).toBe(true);
  });
});

// ── Tick-evaluated metrics: rowsPerSec ───────────────────────────────────────

describe('DbPipeline — rowsPerSec', () => {
  it('is 0 on first boot', () => {
    expect(new DbPipeline(makeWriter()).rowsPerSec).toBe(0);
  });

  it('equals deltaRows / (tickMs / 1000) after a successful flush', async () => {
    const p = new DbPipeline(makeWriter(), { tickMs: 500 });
    p.enqueue(makeEntry(1, [1, 2, 3, 4, 5])); // 5 tag rows
    await p.flushOnce();
    // deltaRows=5, secondsPerTick=0.5 → rowsPerSec=10
    expect(p.rowsPerSec).toBe(10);
  });

  it('is 0 after an idle tick (empty queue)', async () => {
    const p = new DbPipeline(makeWriter(), { tickMs: 500 });
    p.enqueue(makeEntry(1, [1, 2]));
    await p.flushOnce(); // rowsPerSec = 4 (2 rows / 0.5s)
    await p.flushOnce(); // idle — deltaRows=0 → rowsPerSec=0
    expect(p.rowsPerSec).toBe(0);
  });

  it('is 0 after a failed flush', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const p = new DbPipeline(makeFailWriter(), { tickMs: 500 });
    p.enqueue(makeEntry(1, [1, 2]));
    await p.flushOnce();
    expect(p.rowsPerSec).toBe(0); // no rows written
    errSpy.mockRestore();
  });
});

// ── Tick-evaluated metrics: queueDepth ───────────────────────────────────────

describe('DbPipeline — queueDepth (tick-held)', () => {
  it('is 0 on first boot', () => {
    expect(new DbPipeline(makeWriter()).queueDepth).toBe(0);
  });

  it('reflects pre-peek length (arrivals faced this tick)', async () => {
    const p = new DbPipeline(makeWriter(), { maxEntriesPerFlush: 10 });
    p.enqueue(makeEntry(1, [1]));
    p.enqueue(makeEntry(2, [2]));
    await p.flushOnce();
    expect(p.queueDepth).toBe(2); // pre-peek snapshot before batch consumed
  });

  it('reflects pre-peek length when queue exceeds maxEntriesPerFlush', async () => {
    const p = new DbPipeline(makeWriter(), { maxEntriesPerFlush: 3 });
    for (let i = 0; i < 10; i++) p.enqueue(makeEntry(i, [i]));
    await p.flushOnce(); // 3 drained, 7 remain — but queueDepth is pre-peek
    expect(p.queueDepth).toBe(10);
  });

  it('reflects queue length before flush on writer failure', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const p = new DbPipeline(makeFailWriter());
    p.enqueue(makeEntry(1, [1]));
    p.enqueue(makeEntry(2, [2]));
    await p.flushOnce();
    expect(p.queueDepth).toBe(2); // nothing consumed
    errSpy.mockRestore();
  });

  it('holds at last-evaluated value during an inFlight skip', async () => {
    let resolveSecond!: () => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const write = vi.fn<any[], Promise<void>>()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => new Promise<void>(r => { resolveSecond = r; }));
    const writer = { write, name: 'test' } satisfies DbWriter;
    const p = new DbPipeline(writer);

    p.enqueue(makeEntry(1, [1]));
    await p.flushOnce(); // succeeds; pre-peek snapshot was 1
    expect(p.queueDepth).toBe(1);

    p.enqueue(makeEntry(2, [2]));
    p.enqueue(makeEntry(3, [3]));
    const flush2 = p.flushOnce(); // in-flight; pre-peek snapshot is 2
    p.flushOnce(); // skipped — queueDepth still held at pre-peek 2
    expect(p.queueDepth).toBe(2);

    resolveSecond();
    await flush2;
    expect(p.queueDepth).toBe(2); // pre-peek snapshot holds, not updated post-drain
  });

  it('climbs as NullDbWriter fails and queue stays filled', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const p = new DbPipeline(new NullDbWriter(), { queueMax: 10 });
    for (let i = 0; i < 5; i++) p.enqueue(makeEntry(i, [i]));
    await p.flushOnce();
    expect(p.queueDepth).toBe(5);
    await p.flushOnce();
    expect(p.queueDepth).toBe(5); // still full, nothing drained
    errSpy.mockRestore();
  });

  it('errorCountTotal increments by 1 per flush under NullDbWriter', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const p = new DbPipeline(new NullDbWriter());
    p.enqueue(makeEntry(1, [1]));
    for (let i = 0; i < 5; i++) {
      await p.flushOnce();
    }
    expect(p.errorCountTotal).toBe(5);
    errSpy.mockRestore();
  });

  it('errorCountTotal clips at 9999 under sustained NullDbWriter', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const p = new DbPipeline(new NullDbWriter());
    p.enqueue(makeEntry(1, [1]));
    for (let i = 0; i < 10001; i++) {
      await p.flushOnce();
    }
    expect(p.errorCountTotal).toBe(9999);
    errSpy.mockRestore();
  });

  it('queueDepth is pre-peek, not affected by enqueues arriving during flush', async () => {
    let resolveFlushed!: () => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const write = vi.fn<any[], Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>(r => { resolveFlushed = r; }))
      .mockResolvedValue(undefined);
    const writer = { write, name: 'test' } satisfies DbWriter;
    const p = new DbPipeline(writer, { maxEntriesPerFlush: 20 });

    for (let i = 0; i < 10; i++) p.enqueue(makeEntry(i, [i]));
    const flushPromise = p.flushOnce(); // pre-peek snapshot: 10
    expect(p.queueDepth).toBe(10);

    // Three more arrive while flush is in-flight.
    p.enqueue(makeEntry(100, [100]));
    p.enqueue(makeEntry(101, [101]));
    p.enqueue(makeEntry(102, [102]));

    resolveFlushed();
    await flushPromise;

    // queueDepth reflects the pre-peek (10), not post-splice residual (3) or total (13).
    expect(p.queueDepth).toBe(10);
    expect(p.queueLength).toBe(3); // live getter reports actual residual
  });

  it('droppedPkgsTotal climbs once queue caps under NullDbWriter', async () => {
    vi.useFakeTimers();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const p = new DbPipeline(new NullDbWriter(), { queueMax: 3 });
      for (let i = 0; i < 3; i++) p.enqueue(makeEntry(i, [i]));
      await p.flushOnce(); // fails — 3 entries remain, queue full
      vi.advanceTimersByTime(5000); // clear rate-limiter
      p.enqueue(makeEntry(10, [10])); // drops oldest
      expect(p.droppedPkgsTotal).toBe(1);
    } finally {
      vi.useRealTimers();
      errSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

// ── committedThroughMs watermark ──────────────────────────────────────────────

describe('DbPipeline — committedThroughMs watermark', () => {
  it('is 0 before the first flush tick', () => {
    const p = new DbPipeline(makeWriter());
    expect(p.committedThroughMs).toBe(0);
  });

  it('advances on an empty-queue tick (nothing to flush → complete through now)', async () => {
    vi.useFakeTimers();
    try {
      const p = new DbPipeline(makeWriter());
      const before = Date.now();
      vi.advanceTimersByTime(10);
      await p.flushOnce(); // queue empty
      expect(p.committedThroughMs).toBeGreaterThanOrEqual(before);
      expect(p.committedThroughMs).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('advances to approximately tickStartMs on successful commit', async () => {
    const writer = makeWriter();
    const p = new DbPipeline(writer);
    p.enqueue(makeEntry(1, [1]));
    const before = Date.now();
    await p.flushOnce();
    const after = Date.now();
    expect(p.committedThroughMs).toBeGreaterThanOrEqual(before);
    expect(p.committedThroughMs).toBeLessThanOrEqual(after);
  });

  it('does NOT advance on writer failure', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const p = new DbPipeline(makeFailWriter());
      p.enqueue(makeEntry(1, [1]));
      expect(p.committedThroughMs).toBe(0);
      await p.flushOnce();
      expect(p.committedThroughMs).toBe(0); // stalled — writer failed
    } finally {
      errSpy.mockRestore();
    }
  });

  it('resumes advancing after failure recovers', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let shouldFail = true;
    const writer: DbWriter = {
      write: vi.fn<[DbWriteEntry[]], Promise<void>>().mockImplementation(() =>
        shouldFail ? Promise.reject(new Error('fail')) : Promise.resolve(),
      ),
      name: 'conditional',
    };
    const p = new DbPipeline(writer);
    p.enqueue(makeEntry(1, [1]));

    await p.flushOnce(); // fails
    expect(p.committedThroughMs).toBe(0);

    shouldFail = false;
    await p.flushOnce(); // succeeds
    expect(p.committedThroughMs).toBeGreaterThan(0);

    errSpy.mockRestore();
  });

  it('is monotonically non-decreasing across successive successful ticks', async () => {
    const writer = makeWriter();
    const p = new DbPipeline(writer);
    const samples: number[] = [];

    for (let i = 0; i < 5; i++) {
      p.enqueue(makeEntry(i, [i]));
      await p.flushOnce();
      samples.push(p.committedThroughMs);
    }
    await p.flushOnce(); // empty tick
    samples.push(p.committedThroughMs);

    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]!);
    }
  });
});
