// simulatorService.ts
// Simulates field modules publishing telemetry per CARO_MQTT_Spec v1.8 §5.1 (JSON mode).
// Tags are loaded from PostgreSQL at start() time via registry.ts.

import { connect, getClient } from './mqttClient.js';
import { loadTagRegistry, SimTag } from './registry.js';
import { loadProto, encodeProto, ProtoTag } from './protobuf.js';
import { initBoolValue, advanceBoolValue, advanceF32Value, advanceI16Value } from './simGenerators.js';

// ---------------------------------------------------------------------------
// Log buffer
// ---------------------------------------------------------------------------
const LOG_BUFFER_SIZE = Number(process.env.LOG_BUFFER_SIZE) || 200;

export interface LogEntry {
  ts: string;
  level: string;
  msg: string;
}

const logBuffer: LogEntry[] = [];

export function log(level: string, msg: string): void {
  const entry: LogEntry = { ts: new Date().toISOString(), level, msg };
  logBuffer.push(entry);
  if (logBuffer.length > LOG_BUFFER_SIZE) logBuffer.shift();
  if (level === 'ERROR') console.error(msg);
  else if (level === 'WARN') console.warn(msg);
  else console.log(msg);
}

// ---------------------------------------------------------------------------
// Runtime state — populated by start()
// ---------------------------------------------------------------------------
export interface SimTagState {
  simValue: number | boolean;
  simT: number;
  lastPublishedValue: number | boolean | undefined;
  previousValue: number | boolean | undefined;
}

export interface ModuleStatus {
  module_id: string;
  active: boolean;
  tag_count: number;
  bytes: number;
  delta: boolean;
  protobuf: boolean;
  acceptSets: boolean;
  skipAck: boolean;
  fault: boolean;
}

export interface SimulatorStatus {
  running: boolean;
  intervalMs: number | null;
  modules: ModuleStatus[];
  uptime_s: number;
  tickCount: number;
}

let tags: SimTag[]      = [];   // flat SimTag[] loaded from DB
let moduleIds: string[] = [];   // derived unique module_ids

// { tag_id -> { simValue, simT, lastPublishedValue } }
const simState: Map<number, SimTagState> = new Map();

// module_ids currently transmitting telemetry — populated at start(), cleared at stop()
const activeModules: Set<string>      = new Set();

// module_ids publishing only changed tags — empty on startup (full publish mode)
const deltaMode: Set<string>          = new Set();

// module_ids publishing in Protobuf encoding — empty on startup (JSON mode)
const protobufMode: Set<string>       = new Set();

// module_ids that reject SET_VALUES commands — empty on startup (accept writes)
const acceptSetsDisabled: Set<string> = new Set();

// module_ids that silently drop all incoming commands — empty on startup (ACKs sent normally)
const skipAckEnabled: Set<string>     = new Set();

// module_ids publishing FAULT status in telemetry — empty on startup (ONLINE)
const faultMode: Set<string>          = new Set();

// module_id -> number of tags included in the last telemetry publish
const lastPublishedCount: Map<string, number> = new Map();

// module_id -> byte size of last published telemetry payload
const lastPublishedBytes: Map<string, number> = new Map();

// module_id -> cumulative RESET command count
const resetCount: Map<string, number> = new Map();

// command_id deduplication — 60s rolling TTL
const DEDUP_TTL_MS   = 60_000;
const seenCommandIds: Set<string> = new Set();

let timer: ReturnType<typeof setInterval> | null = null;
let tickCount       = 0;
let startedAt: number | null = null;
let currentInterval: number | null = null;

// ---------------------------------------------------------------------------
// Init simulation values for each tag
// ---------------------------------------------------------------------------
function initSimState(): void {
  simState.clear();
  resetCount.clear();
  for (const tag of tags) {
    let simValue: number | boolean;
    if (tag.tag_path.endsWith('.Reset_Count')) {
      simValue = 0;
    } else if (tag.is_setpoint) {
      simValue = tag.data_type === 'bool' ? false : 0;
    } else if (tag.data_type === 'f32') {
      const simT = Math.random() * 30_000;
      const { value } = advanceF32Value(simT, 0);
      simState.set(tag.tag_id, { simValue: value, simT, lastPublishedValue: undefined, previousValue: undefined });
      continue;
    } else if (tag.data_type === 'i16') {
      const simT = Math.random() * 30_000;
      const { value } = advanceI16Value(simT, 0);
      simState.set(tag.tag_id, { simValue: value, simT, lastPublishedValue: undefined, previousValue: undefined });
      continue;
    } else {
      simValue = tag.data_type === 'bool' ? initBoolValue() : 50.0;
    }
    simState.set(tag.tag_id, { simValue, simT: 0, lastPublishedValue: undefined, previousValue: undefined });
  }
}

// ---------------------------------------------------------------------------
// Per-tick value update (monitor tags only — setpoints change via SET_VALUES)
// ---------------------------------------------------------------------------
export function advanceTag(tag: SimTag, state: SimTagState, deltaMs: number): void {
  if (tag.is_setpoint) return;
  if (tag.tag_path.endsWith('.Reset_Count')) return;

  switch (tag.data_type) {
    case 'f32': {
      const result = advanceF32Value(state.simT, deltaMs);
      state.simT    = result.simT;
      state.simValue = result.value;
      break;
    }
    case 'i16': {
      const result = advanceI16Value(state.simT, deltaMs);
      state.simT    = result.simT;
      state.simValue = result.value;
      break;
    }
    case 'bool':
      state.simValue = advanceBoolValue(state.simValue as boolean);
      break;
  }
}

// ---------------------------------------------------------------------------
// Build telemetry message for one module
// All tags (monitor and setpoint) are published on every tick.
// NOTE: Spec (Bootstrap v1.13 §8) says setpoints should publish on-change only,
// but publishing every tick simplifies the simulator for dev use and ensures
// consumers always have the current setpoint value.
// ---------------------------------------------------------------------------
function buildMessage(moduleId: string): { timestamp: number; status: string; tags: { tag_id: number; value: number | boolean | string }[] } {
  const tagValues: { tag_id: number; value: number | boolean | string }[] = [];
  for (const tag of tags) {
    if (tag.module_id !== moduleId) continue;
    const state = simState.get(tag.tag_id)!;

    // Publish all tags unconditionally.
    // On-change-only for setpoints commented out per 2026-04-03 decision:
    // if (tag.is_setpoint) {
    //   if (state.simValue !== state.lastPublishedValue) {
    //     tagValues.push({ tag_id: tag.tag_id, value: state.simValue });
    //     state.lastPublishedValue = state.simValue;
    //   }
    // } else {
    //   tagValues.push({ tag_id: tag.tag_id, value: state.simValue });
    // }
    tagValues.push({ tag_id: tag.tag_id, value: state.simValue });
  }

  return { timestamp: Date.now(), status: faultMode.has(moduleId) ? 'FAULT' : 'ONLINE', tags: tagValues };
}

// ---------------------------------------------------------------------------
// Immediate publish for one module (used by command handler)
// ---------------------------------------------------------------------------
function publishNow(moduleId: string): void {
  const client = getClient();
  if (!client?.connected) return;

  if (protobufMode.has(moduleId)) {
    const richTags: ProtoTag[] = tags
      .filter(t => t.module_id === moduleId)
      .map(t => ({ tag_id: t.tag_id, data_type: t.data_type, simValue: simState.get(t.tag_id)!.simValue }));
    lastPublishedCount.set(moduleId, richTags.length);
    try {
      const buf = encodeProto(moduleId, richTags, faultMode.has(moduleId) ? 'FAULT' : 'ONLINE');
      lastPublishedBytes.set(moduleId, buf.length);
      client.publish(`caro/${moduleId}/telemetry`, buf, { qos: 0, retain: false });
    } catch (err) {
      log('ERROR', `[SIM] Proto encode failed for ${moduleId}: ${(err as Error).message}`);
    }
  } else {
    const msg = buildMessage(moduleId);
    const json = JSON.stringify(msg);
    lastPublishedCount.set(moduleId, msg.tags.length);
    lastPublishedBytes.set(moduleId, Buffer.byteLength(json));
    client.publish(`caro/${moduleId}/telemetry`, json, { qos: 0, retain: false });
  }
}

// ---------------------------------------------------------------------------
// Command handler — SET_VALUES, REQUEST_SNAPSHOT, RESET (§6)
// Spec: caro/{module_id}/cmd QoS1; ACK to caro/{module_id}/cmd_ack QoS1
// ---------------------------------------------------------------------------
function handleCommand(topic: string, rawMessage: Buffer): void {
  const parts = topic.split('/');
  if (parts.length !== 3 || parts[2] !== 'cmd') return;
  const moduleId = parts[1];

  if (skipAckEnabled.has(moduleId)) {
    log('INFO', `[SIM] Module ${moduleId} skip-ack enabled — dropping command (no ACK)`);
    return;
  }

  if (!activeModules.has(moduleId)) {
    log('INFO', `[SIM] Module ${moduleId} not transmitting — dropping command (no ACK)`);
    return;
  }

  let cmd: { command_id?: string; command_type?: string; payload?: { values?: { tag_id: number; value: number | boolean }[] } };
  try {
    cmd = JSON.parse(rawMessage.toString());
  } catch {
    log('WARN', `[SIM] Unparseable command on ${topic}`);
    return;
  }

  const { command_id, command_type, payload } = cmd;

  if (command_id != null) {
    if (seenCommandIds.has(command_id)) {
      log('WARN', `[SIM] Duplicate command_id ${command_id} — dropping`);
      return;
    }
    seenCommandIds.add(command_id);
    setTimeout(() => seenCommandIds.delete(command_id), DEDUP_TTL_MS);
  }

  if (!command_type) {
    log('WARN', `[SIM] Invalid command envelope on ${topic}`);
    return;
  }

  log('INFO', `[SIM] CMD ${command_type} ← ${moduleId} (id: ${command_id})`);

  const results: { tag_id: number; accepted: boolean; rejection_code?: string }[] = [];

  if (command_type === 'SET_VALUES') {
    if (acceptSetsDisabled.has(moduleId)) {
      log('WARN', `[SIM] SET_VALUES rejected — acceptSets disabled for ${moduleId}`);
      for (const { tag_id } of payload?.values ?? []) {
        results.push({ tag_id, accepted: false, rejection_code: 'MODULE_FAULT' });
      }
    } else {
      for (const { tag_id, value } of payload?.values ?? []) {
        const tag = tags.find(t => t.tag_id === tag_id);
        if (!tag) {
          log('WARN', `[SIM] SET_VALUES: unknown tag_id ${tag_id}`);
          results.push({ tag_id, accepted: false, rejection_code: 'UNKNOWN_TAG' });
          continue;
        }
        if (!tag.is_setpoint) {
          log('WARN', `[SIM] SET_VALUES: tag_id ${tag_id} (${tag.tag_path}) is not a setpoint — rejected`);
          results.push({ tag_id, accepted: false, rejection_code: 'UNKNOWN_TAG' });
          continue;
        }
        simState.get(tag.tag_id)!.simValue = value;
        log('INFO', `[SIM] SET_VALUES: tag_id ${tag_id} (${tag.tag_path}) → ${value}`);
        results.push({ tag_id, accepted: true });
      }
    }

  } else if (command_type === 'REQUEST_SNAPSHOT') {
    publishNow(moduleId);

  } else if (command_type === 'RESET') {
    const count = (resetCount.get(moduleId) ?? 0) + 1;
    resetCount.set(moduleId, count);
    log('INFO', `[SIM] RESET for module ${moduleId} — count: ${count}`);
    const resetCountTag = tags.find(t => t.module_id === moduleId && t.tag_path.endsWith('.Reset_Count'));
    if (resetCountTag) {
      simState.get(resetCountTag.tag_id)!.simValue = count;
    }
  }

  // CMD_ACK — §6.2
  const ack = {
    command_id,
    command_type,
    ts_utc_ms: Date.now(),
    results,
  };
  getClient()!.publish(`caro/${moduleId}/cmd_ack`, JSON.stringify(ack), { qos: 1, retain: false });
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------
function tick(intervalMs: number): void {
  tickCount++;

  for (const tag of tags) {
    advanceTag(tag, simState.get(tag.tag_id)!, intervalMs);
  }

  const client = getClient();
  if (!client?.connected) {
    log('WARN', '[SIM] MQTT not connected — skipping tick');
    return;
  }

  for (const moduleId of moduleIds) {
    if (!activeModules.has(moduleId)) continue;

    if (deltaMode.has(moduleId)) {
      const tagValues: { tag_id: number; value: number | boolean | string }[] = [];
      const richTags: ProtoTag[]  = [];
      for (const tag of tags) {
        if (tag.module_id !== moduleId) continue;
        const state = simState.get(tag.tag_id)!;
        if (state.simValue !== state.previousValue) {
          tagValues.push({ tag_id: tag.tag_id, value: state.simValue });
          richTags.push({ tag_id: tag.tag_id, data_type: tag.data_type, simValue: state.simValue });
        }
      }
      for (const tag of tags) {
        if (tag.module_id !== moduleId) continue;
        simState.get(tag.tag_id)!.previousValue = simState.get(tag.tag_id)!.simValue;
      }
      lastPublishedCount.set(moduleId, tagValues.length);
      if (protobufMode.has(moduleId)) {
        try {
          const buf = encodeProto(moduleId, richTags, faultMode.has(moduleId) ? 'FAULT' : 'ONLINE');
          lastPublishedBytes.set(moduleId, buf.length);
          client.publish(`caro/${moduleId}/telemetry`, buf, { qos: 0, retain: false });
        } catch (err) { log('ERROR', `[SIM] Proto encode failed for ${moduleId}: ${(err as Error).message}`); }
      } else {
        const json = JSON.stringify({ timestamp: Date.now(), status: faultMode.has(moduleId) ? 'FAULT' : 'ONLINE', tags: tagValues });
        lastPublishedBytes.set(moduleId, Buffer.byteLength(json));
        client.publish(`caro/${moduleId}/telemetry`, json, { qos: 0, retain: false });
      }
    } else {
      if (protobufMode.has(moduleId)) {
        const richTags: ProtoTag[] = tags
          .filter(t => t.module_id === moduleId)
          .map(t => ({ tag_id: t.tag_id, data_type: t.data_type, simValue: simState.get(t.tag_id)!.simValue }));
        lastPublishedCount.set(moduleId, richTags.length);
        try {
          const buf = encodeProto(moduleId, richTags, faultMode.has(moduleId) ? 'FAULT' : 'ONLINE');
          lastPublishedBytes.set(moduleId, buf.length);
          client.publish(`caro/${moduleId}/telemetry`, buf, { qos: 0, retain: false });
        } catch (err) { log('ERROR', `[SIM] Proto encode failed for ${moduleId}: ${(err as Error).message}`); }
      } else {
        const msg = buildMessage(moduleId);
        const json = JSON.stringify(msg);
        lastPublishedCount.set(moduleId, msg.tags.length);
        lastPublishedBytes.set(moduleId, Buffer.byteLength(json));
        client.publish(`caro/${moduleId}/telemetry`, json, { qos: 0, retain: false });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load tags from DB, connect to MQTT, start telemetry loop.
 * Throws if the DB query fails or returns no tags.
 */
export async function start(intervalMs = 1000): Promise<void> {
  if (timer) { log('WARN', '[SIM] Already running.'); return; }

  try {
    await loadProto();
  } catch (err) {
    log('ERROR', `[SIM] Failed to load Protobuf schema: ${(err as Error).message}`);
    throw err;
  }

  log('INFO', '[SIM] Loading tag registry from database…');
  tags      = await loadTagRegistry();
  moduleIds = [...new Set(tags.map(t => t.module_id))];
  log('INFO', `[SIM] Loaded ${tags.length} tags across modules: ${moduleIds.join(', ')}`);

  activeModules.clear();
  for (const id of moduleIds) activeModules.add(id);

  initSimState();
  tickCount = 0;

  const client = connect();

  const doStart = () => {
    client.subscribe('caro/+/cmd', { qos: 1 }, (err) => {
      if (err) log('ERROR', `[SIM] Failed to subscribe to cmd topics: ${(err as Error).message}`);
      else log('INFO', '[SIM] Subscribed to caro/+/cmd');
    });
    client.on('message', handleCommand);
    startedAt       = Date.now();
    currentInterval = intervalMs;
    log('INFO', `[SIM] Started — interval: ${intervalMs}ms`);
    timer = setInterval(() => tick(intervalMs), intervalMs);
  };

  if (client.connected) {
    doStart();
  } else {
    client.once('connect', doStart);
  }
}

export function stop(): void {
  if (!timer) return;
  clearInterval(timer);
  const client = getClient();
  if (client?.connected) {
    client.unsubscribe('caro/+/cmd');
    client.removeListener('message', handleCommand);
  }
  timer           = null;
  startedAt       = null;
  currentInterval = null;
  tags            = [];
  moduleIds       = [];
  simState.clear();
  activeModules.clear();
  deltaMode.clear();
  protobufMode.clear();
  acceptSetsDisabled.clear();
  skipAckEnabled.clear();
  faultMode.clear();
  lastPublishedCount.clear();
  lastPublishedBytes.clear();
  resetCount.clear();
  log('INFO', '[SIM] Stopped.');
}

export function getStatus(): SimulatorStatus {
  return {
    running:     timer !== null,
    intervalMs:  currentInterval,
    modules:     moduleIds.map(id => ({
      module_id:  id,
      active:     activeModules.has(id),
      tag_count:  lastPublishedCount.get(id) ?? 0,
      bytes:      lastPublishedBytes.get(id) ?? 0,
      delta:      deltaMode.has(id),
      protobuf:   protobufMode.has(id),
      acceptSets: !acceptSetsDisabled.has(id),
      skipAck:    skipAckEnabled.has(id),
      fault:      faultMode.has(id),
    })),
    uptime_s:    startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0,
    tickCount,
  };
}

export function getLogs(): LogEntry[] {
  return logBuffer.slice();
}

export function isKnownModule(moduleId: string): boolean {
  return moduleIds.includes(moduleId);
}

export function activateModule(moduleId: string): void {
  activeModules.add(moduleId);
}

export function deactivateModule(moduleId: string): void {
  activeModules.delete(moduleId);
}

export function activateDeltaMode(moduleId: string): void {
  deltaMode.add(moduleId);
}

export function deactivateDeltaMode(moduleId: string): void {
  deltaMode.delete(moduleId);
}

export function activateProtobuf(moduleId: string): void {
  protobufMode.add(moduleId);
}

export function deactivateProtobuf(moduleId: string): void {
  protobufMode.delete(moduleId);
}

export function activateAcceptSets(moduleId: string): void {
  acceptSetsDisabled.delete(moduleId);
}

export function deactivateAcceptSets(moduleId: string): void {
  acceptSetsDisabled.add(moduleId);
}

export function activateSkipAck(moduleId: string): void {
  skipAckEnabled.add(moduleId);
}

export function deactivateSkipAck(moduleId: string): void {
  skipAckEnabled.delete(moduleId);
}

export function activateFault(moduleId: string): void {
  faultMode.add(moduleId);
}

export function deactivateFault(moduleId: string): void {
  faultMode.delete(moduleId);
}

export function publishSnapshot(moduleId: string): void {
  if (!isKnownModule(moduleId)) {
    throw new Error(`Module ${moduleId} not found.`);
  }
  publishNow(moduleId);
  log('INFO', `[SIM] Snapshot published → ${moduleId}`);
}

export function injectSetValues(moduleId: string): void {
  if (!isKnownModule(moduleId)) {
    throw new Error(`Module ${moduleId} not found.`);
  }

  const setpointTags = tags.filter(t => t.module_id === moduleId && t.is_setpoint);
  if (setpointTags.length === 0) {
    throw new Error(`Module ${moduleId} has no setpoint tags.`);
  }

  const values = setpointTags.map(tag => {
    let value: number | boolean;
    switch (tag.data_type) {
      case 'bool': value = Math.random() > 0.5; break;
      case 'i16':  value = Math.round(Math.random() * 200 - 100); break;
      default:     value = Math.round(Math.random() * 10000) / 100; break; // f32
    }
    return { tag_id: tag.tag_id, value };
  });

  for (const { tag_id, value } of values) {
    simState.get(tag_id)!.simValue = value;
  }

  log('INFO', `[SIM] Change Sets → ${moduleId}: ${values.length} setpoint tags randomized`);
}
