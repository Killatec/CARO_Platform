// simulatorService.js
// Simulates field modules publishing telemetry per CARO_MQTT_Spec v1.8 §5.1 (JSON mode).
// Tags are loaded from PostgreSQL at start() time via registry.js.

import { connect, getClient } from './mqttClient.js';
import { loadTagRegistry } from './registry.js';

const SINE_PERIOD_MS = 30_000; // §7: periodMs = SINE_PERIOD_S * 1000

// ---------------------------------------------------------------------------
// Runtime state — populated by start()
// ---------------------------------------------------------------------------
let tags            = [];   // flat SimTag[] loaded from DB
let moduleIds       = [];   // derived unique module_ids

// { tag_id -> { simValue, simT, lastPublishedValue } }
const simState      = new Map();

let timer           = null;
let tickCount       = 0;
let startedAt       = null;
let currentInterval = null;

// ---------------------------------------------------------------------------
// Init simulation values for each tag
// ---------------------------------------------------------------------------
function initSimState() {
  simState.clear();
  for (const tag of tags) {
    let simValue;
    if (tag.is_setpoint) {
      simValue = tag.data_type === 'bool' ? false
               : tag.data_type === 'str'  ? ''
               : 0;
    } else {
      simValue = tag.data_type === 'f64'  ? 50.0
               : tag.data_type === 'i32'  ? 50
               : tag.data_type === 'bool' ? false
               : 'sim';
    }
    simState.set(tag.tag_id, { simValue, simT: 0, lastPublishedValue: undefined });
  }
}

// ---------------------------------------------------------------------------
// Per-tick value update (monitor tags only — setpoints change via SET_VALUES)
// ---------------------------------------------------------------------------
function advanceTag(tag, state, deltaMs) {
  if (tag.is_setpoint) return;

  switch (tag.data_type) {
    case 'f64':
      state.simT += deltaMs;
      state.simValue = 50 + 25 * Math.sin((2 * Math.PI * state.simT) / SINE_PERIOD_MS);
      break;
    case 'i32':
      state.simT += deltaMs;
      state.simValue = Math.round(50 + 25 * Math.sin((2 * Math.PI * state.simT) / SINE_PERIOD_MS));
      break;
    case 'bool':
      if (Math.random() < 0.005) state.simValue = !state.simValue; // ~0.5% per tick
      break;
    case 'str':
      break; // static
  }
}

// ---------------------------------------------------------------------------
// Build telemetry message for one module
// All tags (monitor and setpoint) are published on every tick.
// NOTE: Spec (Bootstrap v1.13 §8) says setpoints should publish on-change only,
// but publishing every tick simplifies the simulator for dev use and ensures
// consumers always have the current setpoint value.
// ---------------------------------------------------------------------------
function buildMessage(moduleId) {
  const tagValues = [];
  for (const tag of tags) {
    if (tag.module_id !== moduleId) continue;
    const state = simState.get(tag.tag_id);

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

  return { timestamp: Date.now(), status: 'ONLINE', tags: tagValues };
}

// ---------------------------------------------------------------------------
// Immediate publish for one module (used by command handler)
// ---------------------------------------------------------------------------
function publishNow(moduleId) {
  const client = getClient();
  if (!client?.connected) return;
  const msg = buildMessage(moduleId);
  client.publish(`caro/${moduleId}/telemetry`, JSON.stringify(msg), { qos: 0, retain: false });
}

// ---------------------------------------------------------------------------
// Command handler — SET_VALUES, REQUEST_SNAPSHOT, RESET (§6)
// Spec: caro/{module_id}/cmd QoS1; ACK to caro/{module_id}/cmd_ack QoS1
// NOTE: duplicate command_id rejection (§6.2) not implemented — dev tool only
// ---------------------------------------------------------------------------
function handleCommand(topic, rawMessage) {
  const parts = topic.split('/');
  if (parts.length !== 3 || parts[2] !== 'cmd') return;
  const moduleId = parts[1];

  let cmd;
  try {
    cmd = JSON.parse(rawMessage.toString());
  } catch {
    console.warn(`[SIM] Unparseable command on ${topic}`);
    return;
  }

  const { command_id, command_type, payload } = cmd;
  if (!command_id || !command_type) {
    console.warn(`[SIM] Invalid command envelope on ${topic}`);
    return;
  }

  console.log(`[SIM] CMD ${command_type} ← ${moduleId} (id: ${command_id})`);

  const results = [];

  if (command_type === 'SET_VALUES') {
    for (const { tag_id, value } of payload?.values ?? []) {
      const tag = tags.find(t => t.tag_id === tag_id);
      if (!tag) {
        console.warn(`[SIM] SET_VALUES: unknown tag_id ${tag_id}`);
        results.push({ tag_id, accepted: false, rejection_code: 'UNKNOWN_TAG' });
        continue;
      }
      if (!tag.is_setpoint) {
        console.warn(`[SIM] SET_VALUES: tag_id ${tag_id} (${tag.tag_path}) is not a setpoint — rejected`);
        results.push({ tag_id, accepted: false, rejection_code: 'UNKNOWN_TAG' });
        continue;
      }
      simState.get(tag.tag_id).simValue = value;
      console.log(`[SIM] SET_VALUES: tag_id ${tag_id} (${tag.tag_path}) → ${value}`);
      results.push({ tag_id, accepted: true });
    }
    publishNow(moduleId);

  } else if (command_type === 'REQUEST_SNAPSHOT') {
    publishNow(moduleId);

  } else if (command_type === 'RESET') {
    console.log(`[SIM] RESET for module ${moduleId} — no-op`);
  }

  // CMD_ACK — §6.2
  const ack = {
    command_id,
    command_type,
    ts_utc_ms: Date.now(),
    results,
  };
  getClient().publish(`caro/${moduleId}/cmd_ack`, JSON.stringify(ack), { qos: 1, retain: false });
}

// ---------------------------------------------------------------------------
// Tick
// ---------------------------------------------------------------------------
function tick(intervalMs) {
  tickCount++;

  for (const tag of tags) {
    advanceTag(tag, simState.get(tag.tag_id), intervalMs);
  }

  const client = getClient();
  if (!client?.connected) {
    console.warn('[SIM] MQTT not connected — skipping tick');
    return;
  }

  for (const moduleId of moduleIds) {
    const msg   = buildMessage(moduleId);
    const topic = `caro/${moduleId}/telemetry`;
    client.publish(topic, JSON.stringify(msg), { qos: 0, retain: false });
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Load tags from DB, connect to MQTT, start telemetry loop.
 * Throws if the DB query fails or returns no tags.
 */
export async function start(intervalMs = 1000) {
  if (timer) { console.warn('[SIM] Already running.'); return; }

  console.log('[SIM] Loading tag registry from database…');
  tags      = await loadTagRegistry();
  moduleIds = [...new Set(tags.map(t => t.module_id))];
  console.log(`[SIM] Loaded ${tags.length} tags across modules: ${moduleIds.join(', ')}`);

  initSimState();
  tickCount = 0;

  const client = connect();

  const doStart = () => {
    client.subscribe('caro/+/cmd', { qos: 1 }, (err) => {
      if (err) console.error('[SIM] Failed to subscribe to cmd topics:', err.message);
      else console.log('[SIM] Subscribed to caro/+/cmd');
    });
    client.on('message', handleCommand);
    startedAt       = Date.now();
    currentInterval = intervalMs;
    console.log(`[SIM] Started — interval: ${intervalMs}ms`);
    timer = setInterval(() => tick(intervalMs), intervalMs);
  };

  if (client.connected) {
    doStart();
  } else {
    client.once('connect', doStart);
  }
}

export function stop() {
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
  console.log('[SIM] Stopped.');
}

export function getStatus() {
  return {
    running:     timer !== null,
    intervalMs:  currentInterval,
    tagCount:    tags.length,
    modules:     moduleIds,
    uptime_s:    startedAt ? Math.floor((Date.now() - startedAt) / 1000) : 0,
    tickCount,
  };
}
