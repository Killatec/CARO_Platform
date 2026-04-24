import type { TagDef } from '@caro/hmi-context';
import type { LkvCache } from './lkv.js';
import type { DbPipeline } from './db-pipeline.js';
import type { DutyTracker } from './duty-tracker.js';

export interface TelemetryMessage {
  timestamp: number;
  status: string;
  tags: { tag_id: number; value: number | boolean | string | number[] | null }[];
}

export interface TelemetryIntakeDeps {
  lkv: LkvCache;
  tagMap: Map<number, TagDef>;
  moduleTagIds: Map<string, number[]>;
  trendableTagIds: Set<number>;
  dbPipeline: DbPipeline;
  watchdogTimeoutMs: number;
  dutyTracker: DutyTracker;
}

export interface ModuleStats {
  module_id: string;
  status: string;
  packets_per_sec: number;
  bytes_per_sec: number;
  tags_in_last_packet: number;
  stalled: boolean;
  last_seen_ms: number;
}

export class TelemetryIntake {
  private readonly lkv: LkvCache;
  private readonly tagMap: Map<number, TagDef>;
  private readonly moduleTagIds: Map<string, number[]>;
  private readonly trendableTagIds: Set<number>;
  private readonly dbPipeline: DbPipeline;
  private readonly watchdogTimeoutMs: number;
  private readonly dutyTracker: DutyTracker;

  private trendSnapshotPending = new Set<string>();

  private lastSeen = new Map<string, number>();
  private timedOutModules = new Set<string>();   // non-latching: auto-clears when comms resume
  private watchdogLatched = new Set<string>();   // latching: cleared only by manual reset
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private rateTimer: ReturnType<typeof setInterval> | null = null;

  private packetCount = new Map<string, number>();
  private byteAccumulator = new Map<string, number>();
  private tagCountLast = new Map<string, number>();
  private packetsInWindow = new Map<string, number>();
  private lastRateSnapshot = new Map<string, { packetsPerSec: number; bytesPerSec: number }>();
  private moduleStatus = new Map<string, string>();
  private lastDutyCycle: number = 0;

  constructor(deps: TelemetryIntakeDeps) {
    this.lkv = deps.lkv;
    this.tagMap = deps.tagMap;
    this.moduleTagIds = deps.moduleTagIds;
    this.trendableTagIds = deps.trendableTagIds;
    this.dbPipeline = deps.dbPipeline;
    this.watchdogTimeoutMs = deps.watchdogTimeoutMs;
    this.dutyTracker = deps.dutyTracker;
  }

  ingest(moduleId: string, message: TelemetryMessage): void {
    const isSnapshot = this.consumeTrendSnapshotPending(moduleId);

    this.lastSeen.set(moduleId, Date.now());

    this.packetCount.set(moduleId, (this.packetCount.get(moduleId) ?? 0) + 1);
    this.packetsInWindow.set(moduleId, (this.packetsInWindow.get(moduleId) ?? 0) + 1);
    this.byteAccumulator.set(moduleId, (this.byteAccumulator.get(moduleId) ?? 0) + JSON.stringify(message).length);
    this.tagCountLast.set(moduleId, message.tags.length);
    this.moduleStatus.set(moduleId, message.status);

    if (message.status === 'FAULT') {
      for (const tagId of this.moduleTagIds.get(moduleId) ?? []) {
        this.lkv.set(tagId, null);
      }
      // No early return: tag values carried in a FAULT frame are real telemetry
      // and must flow to the historian via the COV loop below.
    }

    const changedTrendable: { tagId: number; value: number | boolean | string | null }[] = [];

    for (const { tag_id, value } of message.tags) {
      if (!this.tagMap.has(tag_id)) continue;
      const changed = this.lkv.set(tag_id, value);
      // Defense in depth: the resolved-tag validator already excludes array types
      // from trendable tags, but this guard ensures that if validation is ever bypassed
      // (e.g. direct DB writes), an array value still cannot reach the db-pipeline queue.
      if (changed && this.trendableTagIds.has(tag_id) && !Array.isArray(value)) {
        changedTrendable.push({ tagId: tag_id, value });
      }
    }

    if (isSnapshot) {
      const snapshot = this.buildModuleSnapshot(moduleId);
      if (snapshot.length > 0) {
        this.dbPipeline.enqueue({ moduleTs: message.timestamp, tags: snapshot });
      }
    } else if (changedTrendable.length > 0) {
      this.dbPipeline.enqueue({ moduleTs: message.timestamp, tags: changedTrendable });
    }
  }

  markTrendSnapshotPending(moduleId: string): void {
    this.trendSnapshotPending.add(moduleId);
  }

  consumeTrendSnapshotPending(moduleId: string): boolean {
    return this.trendSnapshotPending.delete(moduleId);
  }

  forceTrendSnapshot(moduleId: string): void {
    const snapshot = this.buildModuleSnapshot(moduleId);
    if (snapshot.length === 0) return;
    this.dbPipeline.enqueue({ moduleTs: Date.now(), tags: snapshot });
  }

  private buildModuleSnapshot(moduleId: string): { tagId: number; value: number | boolean | string | null }[] {
    const tagIds = this.moduleTagIds.get(moduleId) ?? [];
    return tagIds
      .filter(tagId => this.trendableTagIds.has(tagId))
      .map(tagId => {
        const v = this.lkv.getValue(tagId);
        const value = Array.isArray(v) ? null : (v as number | boolean | string | null);
        return { tagId, value };
      });
  }

  watchdogTick(): void {
    this.dutyTracker.track(() => {
      const now = Date.now();
      for (const [moduleId, tagIds] of this.moduleTagIds) {
        const last = this.lastSeen.get(moduleId) ?? 0;
        const timedOut = now - last > this.watchdogTimeoutMs;

        if (timedOut) {
          if (!this.timedOutModules.has(moduleId)) {
            // Transition into stalled — null LKV, set status, enqueue sentinel
            this.timedOutModules.add(moduleId);
            for (const tagId of tagIds) {
              this.lkv.set(tagId, null);
            }
            this.moduleStatus.set(moduleId, 'STALLED');
            this.enqueueWatchdogStallSentinel(moduleId);
          }
          // Latch the watchdog indicator (survives comms resumption until manual reset)
          this.watchdogLatched.add(moduleId);
        } else {
          // Comms are live — auto-clear the real-time stall flag
          this.timedOutModules.delete(moduleId);
        }
      }
    });
  }

  private enqueueWatchdogStallSentinel(moduleKey: string): void {
    if (!this.moduleTagIds.has(moduleKey)) {
      console.warn(`[TelemetryIntake] watchdog stall: module '${moduleKey}' not in registry, skipping sentinel`);
      return;
    }
    const allTagIds = this.moduleTagIds.get(moduleKey)!;
    const trendingTagIds = allTagIds.filter(id => this.trendableTagIds.has(id));
    if (trendingTagIds.length === 0) return;
    this.dbPipeline.enqueue({
      moduleTs: Date.now(),
      tags: trendingTagIds.map(tagId => ({ tagId, value: null })),
    });
  }

  startWatchdog(): void {
    this.watchdogTimer = setInterval(() => this.watchdogTick(), Math.min(this.watchdogTimeoutMs, 500));
    this.startRateTimer();
  }

  stopWatchdog(): void {
    if (this.watchdogTimer !== null) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    this.stopRateTimer();
  }

  startRateTimer(): void {
    this.rateTimer = setInterval(() => {
      this.dutyTracker.track(() => {
        for (const moduleId of this.moduleTagIds.keys()) {
          this.lastRateSnapshot.set(moduleId, {
            packetsPerSec: this.packetsInWindow.get(moduleId) ?? 0,
            bytesPerSec: this.byteAccumulator.get(moduleId) ?? 0,
          });
          this.packetsInWindow.set(moduleId, 0);
          this.byteAccumulator.set(moduleId, 0);
        }
      });
      this.lastDutyCycle = this.dutyTracker.snapshot(1000);
    }, 1000);
  }

  getDutyCycle(): number {
    return this.lastDutyCycle;
  }

  stopRateTimer(): void {
    if (this.rateTimer !== null) {
      clearInterval(this.rateTimer);
      this.rateTimer = null;
    }
  }

  resetWatchdog(moduleId: string): void {
    const now = Date.now();
    const last = this.lastSeen.get(moduleId) ?? 0;
    if (now - last <= this.watchdogTimeoutMs) {
      this.watchdogLatched.delete(moduleId);
    }
  }

  resetAllWatchdogs(): void {
    const now = Date.now();
    for (const moduleId of [...this.watchdogLatched]) {
      const last = this.lastSeen.get(moduleId) ?? 0;
      if (now - last <= this.watchdogTimeoutMs) {
        this.watchdogLatched.delete(moduleId);
      }
    }
  }

  getModuleStats(): ModuleStats[] {
    const result: ModuleStats[] = [];
    for (const moduleId of this.moduleTagIds.keys()) {
      const snapshot = this.lastRateSnapshot.get(moduleId) ?? { packetsPerSec: 0, bytesPerSec: 0 };
      result.push({
        module_id: moduleId,
        status: this.moduleStatus.get(moduleId) ?? 'UNKNOWN',
        packets_per_sec: snapshot.packetsPerSec,
        bytes_per_sec: snapshot.bytesPerSec,
        tags_in_last_packet: this.tagCountLast.get(moduleId) ?? 0,
        stalled: this.watchdogLatched.has(moduleId),
        last_seen_ms: this.lastSeen.get(moduleId) ?? 0,
      });
    }
    return result;
  }
}
