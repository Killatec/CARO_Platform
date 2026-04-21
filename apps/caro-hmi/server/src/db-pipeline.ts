export interface DbWriteEntry {
  moduleTs: number;
  tags: { tagId: number; value: number | boolean | string | null }[];
}

export interface DbWriter {
  /** Persist a batch. Throw on failure. The pipeline only re-tries entries that
   *  were never successfully written — writers are NOT required to be idempotent. */
  write(entries: DbWriteEntry[]): Promise<void>;
  /** Short name for logs, e.g. "timescale" or "null". */
  readonly name: string;
}

export class NullDbWriter implements DbWriter {
  readonly name = 'null';
  async write(_entries: DbWriteEntry[]): Promise<void> {
    throw new Error('No historian configured; NullDbWriter cannot persist data');
  }
}

interface DbPipelineOptions {
  queueMax?: number;           // default: TIMESCALE_DB_QUEUE_MAX env or 5000
  maxEntriesPerFlush?: number; // default: TIMESCALE_DB_MAX_ENTRIES_PER_FLUSH env or 500
  tickMs?: number;             // default: TIMESCALE_DB_TICK_MS env or 500
}

export class DbPipeline {
  private readonly writer: DbWriter;
  private readonly _queueMax: number;
  private readonly _maxEntriesPerFlush: number;
  private readonly _tickMs: number;

  private readonly queue: DbWriteEntry[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private _inflightPromise: Promise<void> | null = null;
  private _dropWarnTimer: ReturnType<typeof setTimeout> | null = null;

  private _rowsWrittenTotal = 0;
  private _droppedPkgsTotal = 0;
  private _errorCountTotal = 0;
  private _lastFlushMs = 0;
  private _historianHealthy = true;
  private _inFlight = false;

  // ── Tick-evaluated metrics ────────────────────────────────────────────────
  private rowsWrittenAtLastTickEvaluation = 0;
  private _trending = false;
  private _rowsPerSec = 0;
  private _queueDepthAtTick = 0;

  constructor(writer: DbWriter = new NullDbWriter(), options?: DbPipelineOptions) {
    this.writer = writer;
    this._queueMax = options?.queueMax
      ?? parseInt(process.env.TIMESCALE_DB_QUEUE_MAX ?? '5000', 10);
    this._maxEntriesPerFlush = options?.maxEntriesPerFlush
      ?? parseInt(process.env.TIMESCALE_DB_MAX_ENTRIES_PER_FLUSH ?? '500', 10);
    this._tickMs = options?.tickMs
      ?? parseInt(process.env.TIMESCALE_DB_TICK_MS ?? '500', 10);
  }

  enqueue(entry: DbWriteEntry): void {
    if (this.queue.length >= this._queueMax) {
      this.queue.shift();
      this._droppedPkgsTotal = Math.min(this._droppedPkgsTotal + 1, 9999);
      // Rate-limit the warn to once per 5 s burst so logs don't flood.
      if (this._dropWarnTimer === null) {
        console.warn(`[DbPipeline:${this.writer.name}] queue full — dropping oldest entries`);
        this._dropWarnTimer = setTimeout(() => {
          this._dropWarnTimer = null;
        }, 5000);
      }
    }
    this.queue.push(entry);
  }

  /** Schedule the flush tick. Idempotent — no-op if already running. */
  start(): void {
    if (this.timer !== null) return;
    console.info(
      `[DbPipeline] started: tickMs=${this._tickMs}, queueMax=${this._queueMax}, ` +
      `maxEntriesPerFlush=${this._maxEntriesPerFlush}, writer=${this.writer.name}`,
    );
    this.timer = setInterval(() => this.flushOnce(), this._tickMs);
  }

  /** Clear the interval and await any in-flight flush. Does not drain the queue. */
  stop(): Promise<void> {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this._dropWarnTimer !== null) {
      clearTimeout(this._dropWarnTimer);
      this._dropWarnTimer = null;
    }
    return this._inflightPromise ?? Promise.resolve();
  }

  /**
   * Peek-then-consume flush.
   *
   * Skips immediately if another flush is already in-flight (backpressure).
   * On success the peeked batch is consumed from the head; on failure the queue
   * is left intact so the same entries are retried on the next tick.
   * Tick-evaluated metrics (trending, rowsPerSec, queueDepth) are updated at
   * the end of every attempt except the in-flight skip.
   */
  flushOnce(): Promise<void> {
    if (this._inFlight) return Promise.resolve();

    // Pre-peek snapshot: how many entries faced this tick.
    // Taken BEFORE any splice so it reflects arrival backlog, not post-drain residual.
    this._queueDepthAtTick = this.queue.length;

    if (this.queue.length === 0) {
      this.evaluateTrendingMetrics();
      return Promise.resolve();
    }

    this._inFlight = true;
    const startedAt = performance.now();
    const batch = this.queue.slice(0, this._maxEntriesPerFlush);

    const p = this.writer
      .write(batch)
      .then(() => {
        this.queue.splice(0, batch.length);
        this._rowsWrittenTotal += batch.reduce((sum, e) => sum + e.tags.length, 0);
        this._lastFlushMs = performance.now() - startedAt;
        this._historianHealthy = true;
      })
      .catch((err: unknown) => {
        this._errorCountTotal = Math.min(this._errorCountTotal + 1, 9999);
        this._historianHealthy = false;
        if (this.writer.name === 'null') {
          console.error(
            `[DbPipeline] No historian writer — data not being persisted (errorCount=${this._errorCountTotal})`,
          );
        } else {
          console.error(
            `[DbPipeline:${this.writer.name}] flush error:`,
            err instanceof Error ? err.message : String(err),
          );
        }
      })
      .finally(() => {
        this._inFlight = false;
        this._inflightPromise = null;
        this.evaluateTrendingMetrics();
      });

    this._inflightPromise = p;
    return p;
  }

  private evaluateTrendingMetrics(): void {
    const rows = this._rowsWrittenTotal;
    const deltaRows = rows - this.rowsWrittenAtLastTickEvaluation;
    this.rowsWrittenAtLastTickEvaluation = rows;

    const secondsPerTick = this._tickMs / 1000;
    this._rowsPerSec = secondsPerTick > 0 ? deltaRows / secondsPerTick : 0;

    this._trending = this._historianHealthy
      && this.writer.name !== 'null'
      && deltaRows > 0;
  }

  // ── Legacy sync drain ─────────────────────────────────────────────────────
  /** @deprecated use start()/stop() instead */
  flush(): DbWriteEntry[] {
    return this.queue.splice(0);
  }

  // ── Observability ─────────────────────────────────────────────────────────
  get queueLength(): number { return this.queue.length; }          // live
  get queueDepth(): number  { return this._queueDepthAtTick; }     // tick-held
  /** @deprecated prefer queueLength */
  get queueSize(): number { return this.queue.length; }
  get trending(): boolean   { return this._trending; }
  get rowsPerSec(): number  { return this._rowsPerSec; }
  get rowsWrittenTotal(): number { return this._rowsWrittenTotal; }
  get droppedPkgsTotal(): number { return this._droppedPkgsTotal; }
  get errorCountTotal(): number { return this._errorCountTotal; }
  get lastFlushMs(): number { return this._lastFlushMs; }
  get historianHealthy(): boolean { return this._historianHealthy; }
  get inFlight(): boolean { return this._inFlight; }
}
