import { getTimescaleDatabaseSizeBytes } from '@caro/db';

export interface TimescaleSizeMonitorOptions {
  pollMs?: number;
}

export class TimescaleSizeMonitor {
  private _sizeBytes = 0n;
  private _lastSuccessMs = 0;
  private _lastWarnMs = 0;
  private timer: NodeJS.Timeout | undefined;
  readonly pollMs: number;

  constructor(options?: TimescaleSizeMonitorOptions) {
    this.pollMs = options?.pollMs
      ?? Number(process.env.TIMESCALE_SIZE_POLL_MS ?? 30_000);
  }

  // Both getters return null until the first successful poll completes,
  // so consumers (telemetry channel, etc.) can distinguish "no reading yet"
  // from a true zero. After the first success they return the latest value
  // (held across subsequent failures).
  get sizeBytes(): bigint | null {
    return this._lastSuccessMs === 0 ? null : this._sizeBytes;
  }
  get sizeGB(): number | null {
    return this._lastSuccessMs === 0 ? null : Number(this._sizeBytes) / 1e9;
  }
  get lastSuccessMs(): number { return this._lastSuccessMs; }

  start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.pollMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async poll(): Promise<void> {
    try {
      this._sizeBytes = await getTimescaleDatabaseSizeBytes();
      this._lastSuccessMs = Date.now();
    } catch (err) {
      // Hold previous value on error; suppress repeated logs to once per hour.
      const now = Date.now();
      if (now - this._lastWarnMs > 3_600_000) {
        console.warn('[TimescaleSizeMonitor] poll failed:', (err as Error).message);
        this._lastWarnMs = now;
      }
    }
  }
}
