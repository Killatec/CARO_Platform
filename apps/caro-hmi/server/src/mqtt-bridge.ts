import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import type { TelemetryIntake } from './telemetry-intake.js';
import type { DutyTracker } from './duty-tracker.js';
import { parseTelemetry, parseCmdAck } from './mqtt-payloads.js';

/** A dropped-payload reason is logged at most once per this interval per module, with a count. */
const DROP_LOG_INTERVAL_MS = 60_000;

export interface CmdAck {
  command_id:   string;
  command_type: string;
  ts_utc_ms:    number;
  error?:       string;
  results?:     Array<{ tag_id: number; accepted: boolean; rejection_code?: string }>;
}

export interface MqttBridgeConfig {
  mqttUrl: string;
  heartbeatIntervalMs: number;
}

export interface MqttBridgeDeps {
  intake: TelemetryIntake;
  moduleIds: string[];
  config: MqttBridgeConfig;
  dutyTracker: DutyTracker;
}

export class MqttBridge {
  private client: MqttClient | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private cmdAckHandler: ((moduleId: string, ack: CmdAck) => void) | null = null;
  private handshakeHandler: ((moduleId: string, message: unknown) => void) | null = null;
  /** "<module>|<what>" → drops since the last log line, and when that line was written. */
  private readonly drops = new Map<string, { count: number; loggedAt: number }>();

  private readonly intake: TelemetryIntake;
  private readonly moduleIds: string[];
  private readonly config: MqttBridgeConfig;
  private readonly dutyTracker: DutyTracker;

  constructor(deps: MqttBridgeDeps) {
    this.intake = deps.intake;
    this.moduleIds = deps.moduleIds;
    this.config = deps.config;
    this.dutyTracker = deps.dutyTracker;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client = mqtt.connect(this.config.mqttUrl);

      this.client.on('connect', () => {
        this.client!.subscribe('caro/+/telemetry', () => {});
        this.client!.subscribe('caro/+/cmd_ack', () => {});
        this.client!.subscribe('caro/+/handshake_module', () => {});

        this.heartbeatTimer = setInterval(
          () => this.heartbeatTick(),
          this.config.heartbeatIntervalMs
        );

        // Beats never stop, so a module would not notice a backend restart shorter
        // than its beat timeout: ask every module to re-bind. A bound module requests
        // a new TAG_LIST and keeps its binding; an unbound one is requesting anyway.
        // The snapshot follows the bind (HandshakeController), not the connect.
        for (const moduleId of this.moduleIds) {
          this.sendRehandshake(moduleId);
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
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    return new Promise((resolve) => {
      if (!this.client) { resolve(); return; }
      this.client.end(false, () => resolve());
    });
  }

  heartbeatTick(): void {
    for (const moduleId of this.moduleIds) {
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

  onCmdAck(handler: (moduleId: string, ack: CmdAck) => void): void {
    this.cmdAckHandler = handler;
  }

  /** Publishes a handshake message to caro/{module_id}/handshake_backend (QoS 1). */
  publishHandshake(moduleId: string, message: object): void {
    this.client?.publish(
      `caro/${moduleId}/handshake_backend`,
      JSON.stringify(message),
      { qos: 1 }
    );
  }

  sendRehandshake(moduleId: string): void {
    this.publishHandshake(moduleId, { message_type: 'REHANDSHAKE', ts_utc_ms: Date.now() });
  }

  /** Receives every parsed message on caro/{module_id}/handshake_module, unvalidated. */
  onHandshake(handler: (moduleId: string, message: unknown) => void): void {
    this.handshakeHandler = handler;
  }

  private handleMessage(topic: string, payload: Buffer): void {
    const parts    = topic.split('/');
    const moduleId = parts[1];
    const channel  = parts[2];

    if (channel === 'telemetry') {
      this.dutyTracker.track(() => {
        let raw: unknown;
        try {
          raw = JSON.parse(payload.toString());
        } catch {
          return;
        }
        const parsed = parseTelemetry(raw);
        if (!parsed.ok) {
          this.reportDrop(moduleId, `telemetry dropped: ${parsed.reason}`);
          return;
        }
        if (parsed.skipped > 0) {
          this.reportDrop(moduleId, 'telemetry entries skipped (bad tag_id or value)', parsed.skipped);
        }
        this.intake.ingest(moduleId, parsed.message);
      });
      return;
    }

    if (channel === 'cmd_ack') {
      let raw: unknown;
      try {
        raw = JSON.parse(payload.toString());
      } catch {
        return;
      }
      const parsed = parseCmdAck(raw);
      if (!parsed.ok) {
        this.reportDrop(moduleId, `CMD_ACK dropped: ${parsed.reason}`);
        return;
      }
      this.cmdAckHandler?.(moduleId, parsed.message);
      return;
    }

    if (channel === 'handshake_module') {
      let message: unknown;
      try {
        message = JSON.parse(payload.toString());
      } catch {
        return;
      }
      this.handshakeHandler?.(moduleId, message);
      return;
    }

    // unknown channels — ignore
  }

  /** Logs the first drop of a kind at once, then at most one line per DROP_LOG_INTERVAL_MS with the count since. */
  private reportDrop(moduleId: string, what: string, count = 1): void {
    const key = `${moduleId}|${what}`;
    const now = Date.now();
    const entry = this.drops.get(key);
    if (!entry) {
      this.drops.set(key, { count: 0, loggedAt: now });
      console.warn(`[MqttBridge] ${moduleId}: ${what}${count > 1 ? ` (${count})` : ''}`);
      return;
    }
    entry.count += count;
    if (now - entry.loggedAt >= DROP_LOG_INTERVAL_MS) {
      console.warn(`[MqttBridge] ${moduleId}: ${what} — ${entry.count} since last report`);
      entry.count = 0;
      entry.loggedAt = now;
    }
  }
}
