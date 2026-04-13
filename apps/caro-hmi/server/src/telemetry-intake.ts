import type { TagDef } from '@caro/hmi-context';
import type { LkvCache } from './lkv.js';
import type { DbPipeline } from './db-pipeline.js';

export interface TelemetryMessage {
  timestamp: number;
  status: string;
  tags: { tag_id: number; value: number | boolean | string | null }[];
}

export interface TelemetryIntakeDeps {
  lkv: LkvCache;
  tagMap: Map<number, TagDef>;
  moduleTagIds: Map<string, number[]>;
  trendableTagIds: Set<number>;
  dbPipeline: DbPipeline;
  watchdogTimeoutMs: number;
}

export class TelemetryIntake {
  private readonly lkv: LkvCache;
  private readonly tagMap: Map<number, TagDef>;
  private readonly moduleTagIds: Map<string, number[]>;
  private readonly trendableTagIds: Set<number>;
  private readonly dbPipeline: DbPipeline;
  private readonly watchdogTimeoutMs: number;

  private lastSeen = new Map<string, number>();
  private timedOutModules = new Set<string>();
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: TelemetryIntakeDeps) {
    this.lkv = deps.lkv;
    this.tagMap = deps.tagMap;
    this.moduleTagIds = deps.moduleTagIds;
    this.trendableTagIds = deps.trendableTagIds;
    this.dbPipeline = deps.dbPipeline;
    this.watchdogTimeoutMs = deps.watchdogTimeoutMs;
  }

  ingest(moduleId: string, message: TelemetryMessage): void {
    this.lastSeen.set(moduleId, Date.now());
    this.timedOutModules.delete(moduleId);

    if (message.status === 'FAULT') {
      for (const tagId of this.moduleTagIds.get(moduleId) ?? []) {
        this.lkv.set(tagId, null);
      }
      return;
    }

    const changedTrendable: { tagId: number; value: number | boolean | string | null }[] = [];

    for (const { tag_id, value } of message.tags) {
      if (!this.tagMap.has(tag_id)) continue;
      const changed = this.lkv.set(tag_id, value);
      if (changed && this.trendableTagIds.has(tag_id)) {
        changedTrendable.push({ tagId: tag_id, value });
      }
    }

    if (changedTrendable.length > 0) {
      this.dbPipeline.enqueue({ moduleTs: message.timestamp, tags: changedTrendable });
    }
  }

  watchdogTick(): void {
    const now = Date.now();
    for (const [moduleId, tagIds] of this.moduleTagIds) {
      const last = this.lastSeen.get(moduleId) ?? 0;
      const timedOut = now - last > this.watchdogTimeoutMs;

      if (timedOut && !this.timedOutModules.has(moduleId)) {
        this.timedOutModules.add(moduleId);
        for (const tagId of tagIds) {
          this.lkv.set(tagId, null);
        }
      }
    }
  }

  startWatchdog(): void {
    this.watchdogTimer = setInterval(() => this.watchdogTick(), this.watchdogTimeoutMs);
  }

  stopWatchdog(): void {
    if (this.watchdogTimer !== null) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }
}
