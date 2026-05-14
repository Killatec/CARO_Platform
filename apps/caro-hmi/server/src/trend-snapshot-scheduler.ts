/**
 * TrendSnapshotScheduler — historian-write snapshot ensuring every trendable
 * tag gets a DB row at least once per intervalMs.
 *
 * Distinct from the MQTT REQUEST_SNAPSHOT protocol message sent to modules on
 * connect. This scheduler writes directly to the historian via TelemetryIntake,
 * not to MQTT.
 *
 * Two complementary write paths:
 *   Piggyback (default): when the snapshot flag is armed and the next MQTT
 *     telemetry frame arrives for that module, intake.ingest() writes the full
 *     trendable-tag set from LKV instead of the COV-filtered delta.
 *   Force-write (fallback): if the flag is still set on the next tick (no
 *     telemetry arrived), the scheduler calls intake.forceTrendSnapshot() to
 *     write directly from LKV with moduleTs = Date.now().
 */

import type { TelemetryIntake } from './telemetry-intake.js';
import type { DutyTracker } from './duty-tracker.js';

export class TrendSnapshotScheduler {
  private readonly intake: TelemetryIntake;
  private readonly moduleTagIds: Map<string, number[]>;
  private readonly dutyTracker: DutyTracker;
  private readonly intervalMs: number;

  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(
    intake: TelemetryIntake,
    moduleTagIds: Map<string, number[]>,
    dutyTracker: DutyTracker,
    intervalMs: number,
  ) {
    this.intake = intake;
    this.moduleTagIds = moduleTagIds;
    this.dutyTracker = dutyTracker;
    this.intervalMs = intervalMs;
  }

  start(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
    }
    this.intervalHandle = setInterval(() => this.tick(), this.intervalMs);
    console.log(
      `[TrendSnapshot] started interval_ms=${this.intervalMs} module_count=${this.moduleTagIds.size}`,
    );
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    console.log('[TrendSnapshot] stopped');
  }

  private tick(): void {
    this.dutyTracker.track(() => {
      try {
        for (const moduleId of this.moduleTagIds.keys()) {
          if (this.intake.consumeTrendSnapshotPending(moduleId)) {
            this.intake.forceTrendSnapshot(moduleId);
          }
          this.intake.markTrendSnapshotPending(moduleId);
        }
      } catch (err) {
        console.error('[TrendSnapshot] tick error:', (err as Error).message);
      }
    });
  }
}
