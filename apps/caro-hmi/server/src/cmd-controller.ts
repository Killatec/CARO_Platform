import type { MqttBridge, CmdAck } from './mqtt-bridge.js';
import type { HmiTagSource } from './hmi-tag-source.js';
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

export interface CmdControllerDeps {
  mqttBridge: MqttBridge;
  hmiTagSource: HmiTagSource;
  tagMap: Map<number, TagDef>;
  ackTimeoutMs?: number;
}

export class CmdController {
  private readonly mqttBridge: MqttBridge;
  private readonly hmiTagSource: HmiTagSource;
  private readonly tagMap: Map<number, TagDef>;
  private readonly ackTimeoutMs: number;
  private readonly pending = new Map<string, PendingCommand>();
  private readonly moduleTypeMap: Map<string, string>;

  constructor(deps: CmdControllerDeps) {
    this.mqttBridge   = deps.mqttBridge;
    this.hmiTagSource = deps.hmiTagSource;
    this.tagMap       = deps.tagMap;
    this.ackTimeoutMs = deps.ackTimeoutMs ?? 1000;

    // O(1) module_type lookup
    this.moduleTypeMap = new Map(
      [...deps.tagMap.values()].map(t => [t.module_id, t.module_type]),
    );

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
    // Group by module_id
    const byModule = new Map<string, Array<{ tag_id: number; value: number | boolean }>>();
    for (const v of values) {
      const tagDef = this.tagMap.get(v.tag_id);
      if (!tagDef) continue;
      if (!byModule.has(tagDef.module_id)) byModule.set(tagDef.module_id, []);
      byModule.get(tagDef.module_id)!.push(v);
    }

    const devicePromises = Array.from(byModule.entries()).map(([moduleId, moduleValues]) => {
      const moduleType = this.moduleTypeMap.get(moduleId);
      if (moduleType === 'MQTT') {
        return this.sendToMqttModule(moduleId, moduleValues);
      }
      if (moduleType === 'HMI') {
        return this.writeToHmiModule(moduleId, moduleValues);
      }
      // Unknown module_type — return not-accepted for all tags
      return Promise.resolve({
        module_id:  moduleId,
        command_id: '',
        results:    moduleValues.map(v => ({
          tag_id:           v.tag_id,
          accepted:         false,
          rejection_code:   'MODULE_TYPE_NOT_SUPPORTED',
        })),
      } satisfies WriteResult['devices'][number]);
    });

    const devices = await Promise.all(devicePromises);
    return { devices };
  }

  requestSnapshot(moduleId: string): void {
    const moduleType = this.moduleTypeMap.get(moduleId);
    if (moduleType === 'MQTT') {
      this.mqttBridge.sendRequestSnapshot(moduleId);
    } else if (moduleType === 'HMI') {
      this.hmiTagSource.publishNow();
    }
    // Other module types — no-op
  }

  sendReset(moduleId: string): void {
    const moduleType = this.moduleTypeMap.get(moduleId);
    if (moduleType === 'MQTT') {
      const command = {
        command_id:   crypto.randomUUID(),
        command_type: 'RESET' as const,
        ts_utc_ms:    Date.now(),
        payload:      {},
      };
      this.mqttBridge.publishCommand(moduleId, command);
    } else if (moduleType === 'HMI') {
      this.hmiTagSource.reset();
    }
    // Unknown module type — ignore silently
  }

  sendResetAll(): void {
    for (const moduleId of this.moduleTypeMap.keys()) {
      this.sendReset(moduleId);
    }
  }

  private sendToMqttModule(
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

  private writeToHmiModule(
    moduleId: string,
    moduleValues: Array<{ tag_id: number; value: number | boolean }>,
  ): Promise<WriteResult['devices'][number]> {
    for (const { tag_id, value } of moduleValues) {
      this.hmiTagSource.setValue(tag_id, value);
    }
    return Promise.resolve({
      module_id:  moduleId,
      command_id: '',
      results:    moduleValues.map(v => ({ tag_id: v.tag_id, accepted: true })),
    });
  }
}
