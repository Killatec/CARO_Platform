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
import { HandshakeStatus } from '@caro/tag-registry-shared';

/** Consecutive Set-push timeouts answered with a REHANDSHAKE before giving up until the next bind. */
export const MAX_PUSH_RETRIES = 3;

/**
 * Last handshake of a module as the backend saw it — served by GET /api/v1/handshake/:moduleId.
 * `ts_ms` fields are backend receive/send times; request fields are as the module sent them.
 */
export interface HandshakeDetails {
  module_id: string;
  status:    number;   // HandshakeStatus code
  request: {
    ts_ms: number;
    ts_utc_ms: unknown;
    instance_id: unknown;
    ip: unknown;
    fw_hash: unknown;
    tag_registry_template: unknown;
    tag_registry_rev: unknown;
  } | null;
  tag_list: { ts_ms: number; tags: number; bytes: number } | null;
  confirm:  { ts_ms: number; missing_ids: string[]; unknown_tags: string[]; truncated: boolean } | null;
  push: {
    ts_ms: number;
    outcome: 'acked' | 'timeout' | 'no_sets' | 'store_error';
    sets: number;
    unpopulated: number;
    rejected: { tag_id: number; rejection_code: string | null }[];
    consecutive_timeouts: number;
  } | null;
}

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
  details: HandshakeDetails;
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

function emptyDetails(moduleId: string): HandshakeDetails {
  return { module_id: moduleId, status: HandshakeStatus.NONE, request: null, tag_list: null, confirm: null, push: null };
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

  /** HandshakeStatus code for the Module_Info.Handshake tag: N/A for a non-MQTT module, NONE before any request. */
  getStatus(moduleId: string): number {
    if (!this.mqttModuleIds.has(moduleId)) return HandshakeStatus.NA;
    return this.state.get(moduleId)?.details.status ?? HandshakeStatus.NONE;
  }

  /** Details for the HMI modal, or null for a module that is not an MQTT module in the registry. */
  getDetails(moduleId: string): HandshakeDetails | null {
    if (!this.mqttModuleIds.has(moduleId)) return null;
    return this.state.get(moduleId)?.details ?? emptyDetails(moduleId);
  }

  handleMessage(moduleId: string, message: unknown): void {
    if (!isObject(message) || typeof message.message_type !== 'string') {
      this.warnOnce(moduleId, 'malformed', 'malformed handshake message ignored');
      return;
    }
    switch (message.message_type) {
      case 'HANDSHAKE_REQUEST':
        this.handleRequest(moduleId, message.payload, message.ts_utc_ms);
        return;
      case 'CONFIRM':
        this.handleConfirm(moduleId, message.payload);
        return;
      default:
        this.warnOnce(moduleId, `type:${message.message_type}`, `unknown message_type '${message.message_type}' ignored`);
    }
  }

  private handleRequest(moduleId: string, payload: unknown, tsUtcMs: unknown): void {
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
    const now = Date.now();
    state.details.status = HandshakeStatus.REQUESTED;
    state.details.request = {
      ts_ms: now,
      ts_utc_ms:             tsUtcMs ?? null,
      instance_id:           request.instance_id ?? null,
      ip:                    request.ip ?? null,
      fw_hash:               request.fw_hash ?? null,
      tag_registry_template: request.tag_registry_template ?? null,
      tag_registry_rev:      request.tag_registry_rev ?? null,
    };
    state.details.tag_list = { ts_ms: now, tags: tags.length, bytes: Buffer.byteLength(JSON.stringify(tagList)) };
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

    state.details.status = HandshakeStatus.PUSHING;
    state.details.confirm = { ts_ms: Date.now(), missing_ids: missing, unknown_tags: unknown, truncated };
    state.details.push = null;

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
      this.recordPush(state, 'store_error', 0, 0, []);
      return;
    }

    if (setpoints.length === 0) {
      this.cmdController.requestSnapshot(moduleId);
      this.recordPush(state, 'no_sets', 0, 0, []);
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
      this.recordPush(state, 'acked', setpoints.length, unpopulated,
        rejected.map(r => ({ tag_id: r.tag_id, rejection_code: r.rejection_code ?? null })));
      return;
    }

    state.pushTimeouts++;
    this.recordPush(state, 'timeout', setpoints.length, unpopulated, []);
    if (state.pushTimeouts <= MAX_PUSH_RETRIES) {
      console.warn(`[Handshake] ${moduleId}: Set push not acknowledged — REHANDSHAKE (${state.pushTimeouts}/${MAX_PUSH_RETRIES})`);
      this.mqttBridge.sendRehandshake(moduleId);
    } else {
      // Later CONFIRMs still push; only the REHANDSHAKE retries stop, until a push is acked.
      console.error(`[Handshake] ${moduleId}: Set push not acknowledged after ${MAX_PUSH_RETRIES} re-binds — no more REHANDSHAKE retries until a push is acknowledged`);
    }
  }

  /**
   * Records the push outcome and settles the status. A request that arrived while the
   * push was in flight has already moved the status on; the push record is still kept.
   */
  private recordPush(
    state: ModuleState,
    outcome: NonNullable<HandshakeDetails['push']>['outcome'],
    sets: number,
    unpopulated: number,
    rejected: { tag_id: number; rejection_code: string | null }[],
  ): void {
    const d = state.details;
    d.push = { ts_ms: Date.now(), outcome, sets, unpopulated, rejected, consecutive_timeouts: state.pushTimeouts };
    if (d.status !== HandshakeStatus.PUSHING) return;
    if (outcome === 'timeout' || outcome === 'store_error') d.status = HandshakeStatus.PUSH_FAILED;
    else if ((d.confirm?.missing_ids.length ?? 0) > 0)       d.status = HandshakeStatus.MISSING_IDS;
    else                                                     d.status = HandshakeStatus.BOUND;
  }

  private moduleState(moduleId: string): ModuleState {
    let s = this.state.get(moduleId);
    if (!s) {
      s = { awaitingConfirm: false, pushTimeouts: 0, details: emptyDetails(moduleId) };
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
