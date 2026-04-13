import mqtt from 'mqtt';
import type { MqttClient } from 'mqtt';
import type { TelemetryIntake, TelemetryMessage } from './telemetry-intake.js';
import type { DutyTracker } from './duty-tracker.js';

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

        this.heartbeatTimer = setInterval(
          () => this.heartbeatTick(),
          this.config.heartbeatIntervalMs
        );

        for (const moduleId of this.moduleIds) {
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

  private handleMessage(topic: string, payload: Buffer): void {
    this.dutyTracker.track(() => {
      const parts = topic.split('/');
      const moduleId = parts[1];

      let message: TelemetryMessage;
      try {
        message = JSON.parse(payload.toString()) as TelemetryMessage;
      } catch {
        return;
      }

      this.intake.ingest(moduleId, message);
    });
  }
}
