import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import type { TagDef } from '@caro/hmi-context';
import type { LkvCache } from './lkv.js';
import type { DbPipeline } from './db-pipeline.js';

export interface MqttBridgeConfig {
  mqttUrl: string;
  watchdogTimeoutMs: number;
  heartbeatIntervalMs: number;
}

export interface MqttBridgeDeps {
  lkv: LkvCache;
  tagMap: Map<number, TagDef>;
  moduleTagIds: Map<string, number[]>;
  trendableTagIds: Set<number>;
  dbPipeline: DbPipeline;
  config: MqttBridgeConfig;
}

interface TelemetryMessage {
  timestamp: number;
  status: string;
  tags: { tag_id: number; value: number | boolean | string | null }[];
}

export class MqttBridge {
  private client: MqttClient | null = null;
  private lastSeen = new Map<string, number>();
  private timedOutModules = new Set<string>();
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  private readonly lkv: LkvCache;
  private readonly tagMap: Map<number, TagDef>;
  private readonly moduleTagIds: Map<string, number[]>;
  private readonly trendableTagIds: Set<number>;
  private readonly dbPipeline: DbPipeline;
  private readonly config: MqttBridgeConfig;

  constructor(deps: MqttBridgeDeps) {
    this.lkv = deps.lkv;
    this.tagMap = deps.tagMap;
    this.moduleTagIds = deps.moduleTagIds;
    this.trendableTagIds = deps.trendableTagIds;
    this.dbPipeline = deps.dbPipeline;
    this.config = deps.config;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client = mqtt.connect(this.config.mqttUrl);

      this.client.on('connect', () => {
        this.client!.subscribe('caro/+/telemetry', () => {});
        this.client!.subscribe('caro/+/cmd_ack', () => {});

        this.watchdogTimer = setInterval(
          () => this.watchdogTick(),
          this.config.watchdogTimeoutMs
        );
        this.heartbeatTimer = setInterval(
          () => this.heartbeatTick(),
          this.config.heartbeatIntervalMs
        );

        for (const moduleId of this.moduleTagIds.keys()) {
          this.sendRequestSnapshot(moduleId);
        }

        resolve();
      });

      this.client.on('error', reject);

      this.client.on('message', (topic: string, payload: Buffer) => {
        this.handleMessage(topic, payload);
      });
    });
  }

  stop(): Promise<void> {
    if (this.watchdogTimer !== null) clearInterval(this.watchdogTimer);
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    return new Promise((resolve) => {
      if (!this.client) { resolve(); return; }
      this.client.end(false, () => resolve());
    });
  }

  watchdogTick(): void {
    const now = Date.now();
    for (const [moduleId, tagIds] of this.moduleTagIds) {
      const last = this.lastSeen.get(moduleId) ?? 0;
      const timedOut = now - last > this.config.watchdogTimeoutMs;

      if (timedOut && !this.timedOutModules.has(moduleId)) {
        this.timedOutModules.add(moduleId);
        for (const tagId of tagIds) {
          this.lkv.set(tagId, null);
        }
      }
    }
  }

  heartbeatTick(): void {
    for (const moduleId of this.moduleTagIds.keys()) {
      this.client?.publish(
        `caro/${moduleId}/beat`,
        JSON.stringify({ ts_utc_ms: Date.now() })
      );
    }
  }

  publishCommand(moduleId: string, command: object): void {
    this.client?.publish(
      `caro/${moduleId}/cmd`,
      JSON.stringify(command),
      { qos: 1 }
    );
  }

  sendRequestSnapshot(moduleId: string): void {
    this.publishCommand(moduleId, {
      command_id: crypto.randomUUID(),
      command_type: 'REQUEST_SNAPSHOT',
      ts_utc_ms: Date.now(),
      payload: {},
    });
  }

  private handleMessage(topic: string, payload: Buffer): void {
    const parts = topic.split('/');
    const moduleId = parts[1];

    let message: TelemetryMessage;
    try {
      message = JSON.parse(payload.toString()) as TelemetryMessage;
    } catch {
      return;
    }

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
}
