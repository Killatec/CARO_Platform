import type { MqttBridge, CmdAck } from './mqtt-bridge.js';
import type { HmiTagSource } from './hmi-tag-source.js';
import type { TagDef } from '@caro/hmi-context';
import { upsertPendingSetpoints, getPendingSetpointsByTagIds } from '@caro/db';

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

interface PendingVoidCommand {
  resolve: () => void;
  reject:  (e: Error) => void;
  timer:   ReturnType<typeof setTimeout>;
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
  private readonly pending     = new Map<string, PendingCommand>();
  private readonly pendingVoid = new Map<string, PendingVoidCommand>();
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
      const voidEntry = this.pendingVoid.get(ack.command_id);
      if (voidEntry) {
        clearTimeout(voidEntry.timer);
        this.pendingVoid.delete(ack.command_id);
        const topLevelError = ack.error;
        const rejected = (ack.results ?? []).find(r => !r.accepted);
        if (topLevelError) {
          const e = new Error(`Command rejected: ${topLevelError}`) as Error & { code: string };
          e.code = 'COMMAND_REJECTED';
          voidEntry.reject(e);
        } else if (rejected) {
          const e = new Error(`Command rejected: ${rejected.rejection_code ?? 'UNKNOWN'}`) as Error & { code: string };
          e.code = 'COMMAND_REJECTED';
          voidEntry.reject(e);
        } else {
          voidEntry.resolve();
        }
        return;
      }

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

  sendCommand(moduleId: string, cmdStr: string): Promise<void> {
    const moduleType = this.moduleTypeMap.get(moduleId);

    if (moduleType === 'MQTT') {
      const commandId = crypto.randomUUID();
      const command   = { command_id: commandId, command_type: cmdStr, ts_utc_ms: Date.now(), payload: {} };

      return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingVoid.delete(commandId);
          const e = new Error('Command timed out — no ACK received') as Error & { code: string; status: number };
          e.code   = 'TIMEOUT';
          e.status = 504;
          reject(e);
        }, this.ackTimeoutMs);

        this.pendingVoid.set(commandId, { resolve, reject, timer });
        this.mqttBridge.publishCommand(moduleId, command);
      });
    }

    if (moduleType === 'HMI') {
      if (cmdStr === 'RESET') {
        this.hmiTagSource.reset();
        return Promise.resolve();
      }
      const err = new Error(`Command '${cmdStr}' is not supported for HMI modules`) as Error & { code: string; status: number };
      err.code   = 'COMMAND_NOT_SUPPORTED';
      err.status = 400;
      return Promise.reject(err);
    }

    // Other module types — no-op
    return Promise.resolve();
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
        resolve: (results) => {
          const accepted = results
            .filter(r => r.accepted)
            .flatMap(r => {
              const v = moduleValues.find(mv => mv.tag_id === r.tag_id);
              return v ? [{ tag_id: r.tag_id, value: v.value }] : [];
            });
          if (accepted.length > 0) {
            upsertPendingSetpoints(accepted).catch((err: unknown) =>
              console.error('[CmdController] pending setpoint upsert failed:', (err as Error).message),
            );
          }
          resolve({ module_id: moduleId, command_id: commandId, results });
        },
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

  /**
   * Reads pending setpoints for the given MQTT module from the DB and
   * re-publishes them as a SET_VALUES command (fire-and-forget, no ACK
   * tracking). Called on startup and on STALLED→OK watchdog transition.
   */
  async restorePendingSetpoints(moduleId: string): Promise<void> {
    const moduleType = this.moduleTypeMap.get(moduleId);
    if (moduleType !== 'MQTT') return;

    const tagIds = [...this.tagMap.entries()]
      .filter(([, t]) => t.module_id === moduleId && t.is_setpoint)
      .map(([tagId]) => tagId);

    if (tagIds.length === 0) return;

    const rows = await getPendingSetpointsByTagIds(tagIds);
    if (rows.length === 0) return;

    this.mqttBridge.publishCommand(moduleId, {
      command_id:   crypto.randomUUID(),
      command_type: 'SET_VALUES',
      ts_utc_ms:    Date.now(),
      payload:      { values: rows.map(r => ({ tag_id: r.tag_id, value: r.value as number | boolean })) },
    });

    console.log(`[CmdController] restored ${rows.length} pending setpoint(s) to ${moduleId}`);
  }
}
