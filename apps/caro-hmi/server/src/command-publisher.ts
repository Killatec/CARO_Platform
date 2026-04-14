import type { MqttBridge, CmdAck } from './mqtt-bridge.js';
import type { TagDef } from '@caro/hmi-context';

export type { CmdAck };

export interface WriteResult {
  devices: Array<{
    module_id: string;
    command_id: string;
    results: Array<{ tag_id: number; accepted: boolean; rejection_code?: string }>;
  }>;
}

type TagResult = { tag_id: number; accepted: boolean; rejection_code?: string };

interface PendingCommand {
  resolve: (results: TagResult[]) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface CommandPublisherDeps {
  mqttBridge: MqttBridge;
  tagMap: Map<number, TagDef>;
  ackTimeoutMs?: number;
}

export class CommandPublisher {
  private readonly mqttBridge: MqttBridge;
  private readonly tagMap: Map<number, TagDef>;
  private readonly ackTimeoutMs: number;
  private readonly pending = new Map<string, PendingCommand>();

  constructor(deps: CommandPublisherDeps) {
    this.mqttBridge = deps.mqttBridge;
    this.tagMap     = deps.tagMap;
    this.ackTimeoutMs = deps.ackTimeoutMs ?? 1000;

    this.mqttBridge.onCmdAck((_moduleId, ack) => {
      const entry = this.pending.get(ack.command_id);
      if (!entry) return;
      clearTimeout(entry.timer);
      this.pending.delete(ack.command_id);
      entry.resolve(ack.results ?? []);
    });
  }

  async writeValues(
    values: Array<{ tag_id: number; value: number | boolean }>,
  ): Promise<WriteResult> {
    // Group writes by module
    const byModule = new Map<string, Array<{ tag_id: number; value: number | boolean }>>();
    for (const v of values) {
      const tagDef = this.tagMap.get(v.tag_id);
      if (!tagDef) continue;
      if (!byModule.has(tagDef.module_id)) byModule.set(tagDef.module_id, []);
      byModule.get(tagDef.module_id)!.push(v);
    }

    const devicePromises = Array.from(byModule.entries()).map(([moduleId, moduleValues]) =>
      this.sendToModule(moduleId, moduleValues),
    );

    const devices = await Promise.all(devicePromises);
    return { devices };
  }

  private sendToModule(
    moduleId: string,
    moduleValues: Array<{ tag_id: number; value: number | boolean }>,
  ): Promise<WriteResult['devices'][number]> {
    const commandId = crypto.randomUUID();
    const tagIds    = moduleValues.map(v => v.tag_id);

    const command = {
      command_id:   commandId,
      command_type: 'SET_VALUES' as const,
      ts_utc_ms:    Date.now(),
      payload:      { values: moduleValues },
    };

    return new Promise<WriteResult['devices'][number]>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId);
        resolve({
          module_id:  moduleId,
          command_id: commandId,
          results:    tagIds.map(tag_id => ({ tag_id, accepted: false, rejection_code: 'TIMEOUT' })),
        });
      }, this.ackTimeoutMs);

      this.pending.set(commandId, {
        resolve: (results) => resolve({ module_id: moduleId, command_id: commandId, results }),
        timer,
      });

      this.mqttBridge.publishCommand(moduleId, command);
    });
  }
}
