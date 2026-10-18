import type { MqttBridge, CmdAck } from './mqtt-bridge.js';
import type { HmiTagSource } from './hmi-tag-source.js';
import type { TagDef } from '@caro/hmi-context';
import { upsertPendingSetpoints, upsertCommandedSetpoints, getCommandedSetpointsByTagIds } from '@caro/db';
import type { CommandedSetpointEntry, SetpointAckStatus } from '@caro/db';

export type { CmdAck };

export interface WriteResult {
  devices: Array<{
    module_id: string;
    command_id: string;
    results: Array<{ tag_id: number; accepted: boolean; rejection_code?: string }>;
  }>;
}

type TagResult = { tag_id: number; accepted: boolean; rejection_code?: string };

/** One Set of a module as the store holds it; value null = unpopulated (also when there is no row). */
export interface ModuleSetpoint {
  tag_id:     number;
  value:      number | boolean | null;
  ack_status: SetpointAckStatus | null;
  set_by:     string | null;
}

export type SetpointPushResult =
  | { outcome: 'acked'; results: TagResult[] }
  | { outcome: 'timeout' };

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
        // No ACK: the module may still have applied the values, and they remain the
        // operator's intent, so they are what the next post-CONFIRM push sends.
        this.storeCommandedSetpoints(moduleValues.map(v => ({ ...v, ack_status: 'timeout' })));
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
            this.storeCommandedSetpoints(accepted.map(a => ({ ...a, ack_status: 'accepted' })));
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

  private storeCommandedSetpoints(entries: CommandedSetpointEntry[]): void {
    upsertCommandedSetpoints(entries).catch((err: unknown) =>
      console.error('[CmdController] commanded setpoint upsert failed:', (err as Error).message),
    );
  }

  /** Every Set of the module, ordered by tag_id, with its stored value or null. */
  async getModuleSetpoints(moduleId: string): Promise<ModuleSetpoint[]> {
    const tagIds = this.setpointTagIds(moduleId);
    if (tagIds.length === 0) return [];

    const rows = new Map((await getCommandedSetpointsByTagIds(tagIds)).map(r => [r.tag_id, r]));
    return tagIds.map(tag_id => {
      const row = rows.get(tag_id);
      return {
        tag_id,
        value:      row?.value ?? null,
        ack_status: row?.ack_status ?? null,
        set_by:     row?.set_by ?? null,
      };
    });
  }

  /**
   * Publishes every given Set, nulls included, as one SET_VALUES and waits for its
   * CMD_ACK (the handshake's post-CONFIRM push). The SET_VALUES is published
   * before this returns, so a command sent next follows it on the wire.
   *
   * The values come from the store, so an ACK changes nothing except that a value
   * stored as 'timeout' and now accepted is upgraded to 'accepted', keeping its
   * set_by. pending_setpoint_values is not written.
   */
  pushSetpoints(moduleId: string, setpoints: ModuleSetpoint[]): Promise<SetpointPushResult> {
    const commandId = crypto.randomUUID();

    return new Promise<SetpointPushResult>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(commandId);
        resolve({ outcome: 'timeout' });
      }, this.ackTimeoutMs);

      this.pending.set(commandId, {
        resolve: (results) => {
          const confirmed = results
            .filter(r => r.accepted)
            .flatMap(r => {
              const s = setpoints.find(sp => sp.tag_id === r.tag_id);
              return s && s.value !== null && s.ack_status === 'timeout'
                ? [{ tag_id: s.tag_id, value: s.value, ack_status: 'accepted' as const, set_by: s.set_by }]
                : [];
            });
          if (confirmed.length > 0) this.storeCommandedSetpoints(confirmed);
          resolve({ outcome: 'acked', results });
        },
        timer,
      });

      this.mqttBridge.publishCommand(moduleId, {
        command_id:   commandId,
        command_type: 'SET_VALUES',
        ts_utc_ms:    Date.now(),
        payload:      { values: setpoints.map(s => ({ tag_id: s.tag_id, value: s.value })) },
      });
    });
  }

  private setpointTagIds(moduleId: string): number[] {
    return [...this.tagMap.values()]
      .filter(t => t.module_id === moduleId && t.is_setpoint)
      .map(t => t.tag_id)
      .sort((a, b) => a - b);
  }
}
