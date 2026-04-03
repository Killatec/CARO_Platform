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
// Setpoints: only included when value changed since last publish
// Monitor tags: always included
// ---------------------------------------------------------------------------
function buildMessage(moduleId) {
  const tagValues = [];
  for (const tag of tags) {
    if (tag.module_id !== moduleId) continue;
    const state = simState.get(tag.tag_id);

    if (tag.is_setpoint) {
      if (state.simValue !== state.lastPublishedValue) {
        tagValues.push({ tag_id: tag.tag_id, value: state.simValue });
        state.lastPublishedValue = state.simValue;
      }
    } else {
      tagValues.push({ tag_id: tag.tag_id, value: state.simValue });
    }
  }

  return { timestamp: Date.now(), status: 'ONLINE', tags: tagValues };
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
    console.log(`[SIM] tick #${String(tickCount).padStart(3)} → ${topic} (${msg.tags.length} tags)`);
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
