// historian-reconnect.ts — Periodically retries the TimescaleDB historian
// connection while the HMI is running on NullDbWriter, so a historian that
// wasn't ready at startup is picked up without an HMI restart.

import { pingTimescale, runTimescaleMigrations } from '@caro/db';
import { DbPipeline } from './db-pipeline.js';
import { TimescaleDbWriter } from './timescale-writer.js';
import { TimescaleSizeMonitor } from './timescale-size-monitor.js';
import type { HmiTagSource } from './hmi-tag-source.js';

export class HistorianReconnector {
  private timer: ReturnType<typeof setInterval> | null = null;
  private attempting = false;

  constructor(
    private readonly dbPipeline: DbPipeline,
    private readonly hmiTags: HmiTagSource,
    private readonly intervalMs: number,
  ) {}

  /** Idempotent — no-op if already running. */
  start(): void {
    if (this.timer !== null) return;
    console.info(`[HistorianReconnect] started: retrying every ${this.intervalMs}ms while on null writer`);
    this.timer = setInterval(() => void this.attempt(), this.intervalMs);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async attempt(): Promise<void> {
    if (this.attempting || this.dbPipeline.writerName !== 'null') return;
    this.attempting = true;
    try {
      await pingTimescale();
      await runTimescaleMigrations();
      const writer = new TimescaleDbWriter();
      const sizeMonitor = new TimescaleSizeMonitor();
      sizeMonitor.start();
      this.dbPipeline.setWriter(writer);
      this.hmiTags.attachSizeMonitor(sizeMonitor);
      console.info('[HistorianReconnect] Timescale historian reconnected — resuming persistence');
      this.stop();
    } catch {
      // Still unreachable — stay quiet here; DbPipeline's own rate-limited
      // error log already reports the ongoing outage.
    } finally {
      this.attempting = false;
    }
  }
}
