// handshake-controller.ts — backend side of the module handshake.
//
// Contract: CARO_MQTT_Interface Docs/BACKEND_HANDSHAKE_PROMPT.md (module side, built)
// and CARO_MQTT_Spec §7 (target ICD, not yet updated to it). Every bind starts
// with the module: HANDSHAKE_REQUEST → TAG_LIST → CONFIRM → Set push + REQUEST_SNAPSHOT.
// The backend never sends a TAG_LIST unprompted; it asks for a re-bind with
// REHANDSHAKE (on every broker connect, from MqttBridge, and after a push timeout).
//
// First increment: module identity is not checked (verifyModuleIdentity is a
// placeholder until commissioned_modules exists), CONFIRM results are logged only,
// and per-module state is in memory.

import type { TagDef } from '@caro/hmi-context';
import type { MqttBridge } from './mqtt-bridge.js';
import type { CmdController } from './cmd-controller.js';
import { buildTagList } from './tag-list.js';

/** Consecutive Set-push timeouts answered with a REHANDSHAKE before giving up until the next bind. */
export const MAX_PUSH_RETRIES = 3;

interface HandshakeRequestPayload {
  module_id:              string;
  instance_id?:           unknown;
  ip?:                    unknown;
  fw_hash?:               unknown;
  tag_registry_template?: unknown;
  tag_registry_rev?:      unknown;
}

interface ModuleState {
  /** A TAG_LIST was sent since the last CONFIRM — the next CONFIRM answers it. */
  awaitingConfirm: boolean;
  /** Consecutive push timeouts; reset by an acked push. */
  pushTimeouts: number;
}

export interface HandshakeControllerDeps {
  mqttBridge:    MqttBridge;
  cmdController: CmdController;
  tagMap:        Map<number, TagDef>;
}

/**
 * Identity check placeholder (D27/B3): always accepts. Will compare fw_hash and
 * tag_registry_template (tag_registry_rev is reserved for later verification)
 * with what commissioned_modules expects for the module.
 */
export function verifyModuleIdentity(
  _moduleId: string,
  _request: HandshakeRequestPayload,
): { ok: true } | { ok: false; reason: string } {
  return { ok: true };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

export class HandshakeController {
  private readonly mqttBridge: MqttBridge;
  private readonly cmdController: CmdController;
  private readonly tagMap: Map<number, TagDef>;
  private readonly mqttModuleIds: Set<string>;
  private readonly state = new Map<string, ModuleState>();
  /** "<module>|<reason>" already warned about, so a module requesting at 1 Hz logs once. */
  private readonly warned = new Set<string>();

  constructor(deps: HandshakeControllerDeps) {
    this.mqttBridge    = deps.mqttBridge;
    this.cmdController = deps.cmdController;
    this.tagMap        = deps.tagMap;
    this.mqttModuleIds = new Set(
      [...deps.tagMap.values()].filter(t => t.module_type === 'MQTT').map(t => t.module_id),
    );
    this.mqttBridge.onHandshake((moduleId, message) => this.handleMessage(moduleId, message));
  }

  handleMessage(moduleId: string, message: unknown): void {
    if (!isObject(message) || typeof message.message_type !== 'string') {
      this.warnOnce(moduleId, 'malformed', 'malformed handshake message ignored');
      return;
    }
    switch (message.message_type) {
      case 'HANDSHAKE_REQUEST':
        this.handleRequest(moduleId, message.payload);
        return;
      case 'CONFIRM':
        this.handleConfirm(moduleId, message.payload);
        return;
      default:
        this.warnOnce(moduleId, `type:${message.message_type}`, `unknown message_type '${message.message_type}' ignored`);
    }
  }

  private handleRequest(moduleId: string, payload: unknown): void {
    if (!isObject(payload) || payload.module_id !== moduleId) {
      this.warnOnce(moduleId, 'module_id', `HANDSHAKE_REQUEST ignored: payload module_id does not match topic module '${moduleId}'`);
      return;
    }
    if (!this.mqttModuleIds.has(moduleId)) {
      this.warnOnce(moduleId, 'not-mqtt', `HANDSHAKE_REQUEST ignored: '${moduleId}' is not an MQTT module in the registry`);
      return;
    }
    const request = payload as unknown as HandshakeRequestPayload;
    const identity = verifyModuleIdentity(moduleId, request);
    if (!identity.ok) {
      this.warnOnce(moduleId, 'identity', `HANDSHAKE_REQUEST refused: ${identity.reason}`);
      return;
    }

    const { tags, skipped } = buildTagList(this.tagMap, moduleId);
    if (tags.length === 0) {
      this.warnOnce(moduleId, 'no-tags', `HANDSHAKE_REQUEST not answered: no tags with a module-relative name for '${moduleId}'`);
      return;
    }
    if (skipped.length > 0) {
      this.warnOnce(moduleId, 'skipped', `TAG_LIST leaves out ${skipped.length} tag(s) with no module-relative name: ${skipped.join(', ')}`);
    }

    const tagList = { message_type: 'TAG_LIST', ts_utc_ms: Date.now(), payload: { tags } };
    this.mqttBridge.publishHandshake(moduleId, tagList);

    const state = this.moduleState(moduleId);
    if (!state.awaitingConfirm) {
      // First answer of this requesting period — later ones (the module repeats at ~1 Hz) are silent.
      console.log(
        `[Handshake] ${moduleId}: request (instance ${String(request.instance_id)}, ip ${String(request.ip)}, ` +
        `fw ${String(request.fw_hash)}, template ${String(request.tag_registry_template)}) → ` +
        `TAG_LIST ${tags.length} tags, ${Buffer.byteLength(JSON.stringify(tagList))} B`,
      );
    }
    state.awaitingConfirm = true;
  }

  private handleConfirm(moduleId: string, payload: unknown): void {
    const state = this.state.get(moduleId);
    if (!state?.awaitingConfirm) {
      this.warnOnce(moduleId, 'unsolicited', 'CONFIRM ignored: no TAG_LIST was sent to this module');
      return;
    }
    // Repeated requests each got a TAG_LIST, so several CONFIRMs may follow; each one
    // is answered (the contract asks the backend to tolerate repeats).
    state.awaitingConfirm = false;
    this.clearWarnings(moduleId);

    const p = isObject(payload) ? payload : {};
    const missing = stringArray(p.missing_ids);
    const unknown = stringArray(p.unknown_tags);
    const truncated = p.truncated === true;
    const summary = `${moduleId}: CONFIRM — ${missing.length} missing, ${unknown.length} unknown${truncated ? ' (lists truncated)' : ''}`;
    if (missing.length > 0 || unknown.length > 0) {
      console.warn(`[Handshake] ${summary}` +
        (missing.length > 0 ? ` | missing: ${missing.join(', ')}` : '') +
        (unknown.length > 0 ? ` | unknown: ${unknown.join(', ')}` : ''));
    } else {
      console.log(`[Handshake] ${summary}`);
    }

    void this.pushAndSnapshot(moduleId, state);
  }

  /** Set push from the store (nulls included), then REQUEST_SNAPSHOT — the module publishes all tags only on request. */
  private async pushAndSnapshot(moduleId: string, state: ModuleState): Promise<void> {
    let setpoints;
    try {
      setpoints = await this.cmdController.getModuleSetpoints(moduleId);
    } catch (err) {
      console.error(`[Handshake] ${moduleId}: Set push skipped — reading the setpoint store failed: ${(err as Error).message}`);
      this.cmdController.requestSnapshot(moduleId);
      return;
    }

    if (setpoints.length === 0) {
      this.cmdController.requestSnapshot(moduleId);
      return;
    }

    const ack = this.cmdController.pushSetpoints(moduleId, setpoints);
    this.cmdController.requestSnapshot(moduleId);

    const result = await ack;
    const unpopulated = setpoints.filter(s => s.value === null).length;
    if (result.outcome === 'acked') {
      state.pushTimeouts = 0;
      const rejected = result.results.filter(r => !r.accepted);
      const line = `[Handshake] ${moduleId}: pushed ${setpoints.length} Sets (${unpopulated} unpopulated), ${rejected.length} rejected`;
      if (rejected.length > 0) {
        console.warn(`${line}: ${rejected.map(r => `${r.tag_id}:${r.rejection_code ?? '?'}`).join(', ')}`);
      } else {
        console.log(line);
      }
      return;
    }

    state.pushTimeouts++;
    if (state.pushTimeouts <= MAX_PUSH_RETRIES) {
      console.warn(`[Handshake] ${moduleId}: Set push not acknowledged — REHANDSHAKE (${state.pushTimeouts}/${MAX_PUSH_RETRIES})`);
      this.mqttBridge.sendRehandshake(moduleId);
    } else {
      // Later CONFIRMs still push; only the REHANDSHAKE retries stop, until a push is acked.
      console.error(`[Handshake] ${moduleId}: Set push not acknowledged after ${MAX_PUSH_RETRIES} re-binds — no more REHANDSHAKE retries until a push is acknowledged`);
    }
  }

  private moduleState(moduleId: string): ModuleState {
    let s = this.state.get(moduleId);
    if (!s) {
      s = { awaitingConfirm: false, pushTimeouts: 0 };
      this.state.set(moduleId, s);
    }
    return s;
  }

  private warnOnce(moduleId: string, reason: string, message: string): void {
    const key = `${moduleId}|${reason}`;
    if (this.warned.has(key)) return;
    this.warned.add(key);
    console.warn(`[Handshake] ${moduleId}: ${message}`);
  }

  private clearWarnings(moduleId: string): void {
    for (const key of this.warned) {
      if (key.startsWith(`${moduleId}|`)) this.warned.delete(key);
    }
  }
}
