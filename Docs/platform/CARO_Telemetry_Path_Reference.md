# CARO_Platform — Telemetry Path Reference

**From telemetry producer to screen pixel.**
**Version:** 3.3 — 2026-10-18
*v3.3: Leaving FAULT calls `moduleRecoveredHandler` (REQUEST_SNAPSHOT) like a stall recovery (§2, §3.3, §4.1, §4.2).*
*v3.2: Payload shape checks in the bridge (`mqtt-payloads.ts`, §3.2); the heartbeat timer is replaced per connect and stopped on disconnect (§3.1). Both removed from §12.*
*v3.1: Module handshake (§3.4): the bridge subscribes `caro/+/handshake_module`, sends REHANDSHAKE on connect instead of REQUEST_SNAPSHOT; Sets reach a module only in the post-CONFIRM push from `commanded_setpoints`; startup and recovery re-delivery removed (§3.3, §4.2).*
*v3.0: Reconciled line by line against the implementation. Corrected the intake (FAULT no longer short-circuits; trend listener is per ingest, not per changed tag), the trend WS channel (per-ingest snapshots, no server-side boolean coercion, outbox cap), the MQTT bridge (connect behaviour, JSON-only decoding), client reconnect/PING behaviour, the trend client hook (ring of 20, `drainBuffers`) and widget field resolution (registry columns, never `meta`). Added stall/recovery handling, the trend snapshot scheduler, the outbound MQTT path, a full configuration table and §12 Known Gaps.*
*v2.2: Stage 5 (DB Pipeline) rewritten for the shipped TimescaleDB writer.*
*v2.1: trend WS channel (Step 11) coverage added.*
*Internal technical reference.*

---

## 1. Overview

This document traces every step a telemetry value takes from its producer (an MQTT module, or the HMI server itself) to a rendered pixel in the operator's browser, plus the return path for commands. Each section corresponds to one module in the codebase. Code snippets are copied from the implementation as of the version date.

The MQTT wire contract itself — topics, payloads, commands, ACKs, and which parts are implemented — is defined in [`CARO_MQTT_Spec.md`](CARO_MQTT_Spec.md) (see its §1.1 Implementation Status). The historian write path past Stage 5 is in [`../hmi/trend-viewer/hmi_trend_viewer_reference.md`](../hmi/trend-viewer/hmi_trend_viewer_reference.md).

### 1.1 End-to-End Summary

Stages 1a and 1b are alternative producers; both feed Stage 3.

| #   | Stage                       | Module                        | What happens |
|-----|-----------------------------|-------------------------------|--------------|
| 1a  | MQTT publish                | module firmware / `mqtt-simulator` | JSON telemetry published to `caro/{module_id}/telemetry`, typically 10 Hz |
| 1b  | HMI-internal publish        | `hmi-tag-source.ts`           | Proxy-based producer for `module_type='HMI'` tags; emits a full `TelemetryMessage` every 250 ms |
| 2   | MQTT receive (transport)    | `mqtt-bridge.ts`              | Subscribes `caro/+/telemetry`, `caro/+/cmd_ack` and `caro/+/handshake_module`; `JSON.parse`s telemetry and hands it to `TelemetryIntake.ingest()` |
| 3   | Universal ingestion         | `telemetry-intake.ts`         | LKV writes, FAULT handling, watchdog, rate tracking, historian enqueue, trend-listener call |
| 4   | LKV cache                   | `lkv.ts`                      | In-memory `Map<tag_id, { value, generation }>`; generation bumps only on value change |
| 5   | DB pipeline                 | `db-pipeline.ts`              | Module-timestamped queue, batch-flushed to TimescaleDB |
| 6   | WebSocket server            | `ws-server.ts`                | Live values: 125 ms (8 Hz) tick, per-client generation diff, `SUBSCRIBE → SNAPSHOT → DELTA`. Trend channel: 4 Hz `TREND_DELTA` flush |
| 7   | Client context              | `HmiContextProvider.tsx`      | Browser WS ingests `SNAPSHOT`/`DELTA`/`TREND_DELTA`, updates `valuesRef`, fans out to subscriber callbacks |
| 8   | Widget render               | `@caro/widgets`               | `useLiveValue` returns the new value; widget re-renders; `null` = bad quality renders `---` |

**Parallel trend channel.** Widgets only ever use the live-value path above. The trend chart's live tail uses a parallel branch that splits off at Stage 3: after every `ingest()`, `TelemetryIntake` calls the trend listener with `(moduleTs, moduleId)`. `WsServer.handleTrendDelta` then appends the *current* LKV value of every trendable tag of that module to the outbox of each client subscribed to it, and a separate flush at `TREND_FLUSH_HZ` (default 4 Hz) sends them as `TREND_DELTA` frames. Every sample carries its source `moduleTs`, nothing is coalesced, and a subscribed tag with no ingest in a flush window still gets one synthetic sample. See §7.6 (server) and §8.7 (client).

Two architectural rules drive everything else:

- **`TelemetryIntake` is the universal entry point.** `MqttBridge` and `HmiTagSource` are both adapters. Future transports (OPC-UA, REST pollers) plug in at the same seam.
- **Generation counters, not timestamps, drive live-value change detection.** No clock synchronization is needed for widgets, and the LKV stores no per-tag timestamp. The module timestamp is used only for historian rows and trend samples.

### 1.2 Data Shape at Each Boundary

| Boundary                | Shape                                                                      | Notes |
|-------------------------|----------------------------------------------------------------------------|-------|
| MQTT wire (§2)          | `{ timestamp, status, tags: [{ tag_id, value }] }` (JSON)                  | Module-level timestamp. `status` is `'ONLINE'` or `'FAULT'`. Value is number, boolean, string, number array, or null. |
| HmiTagSource emit (§2b) | Same `TelemetryMessage` shape, built in-process                            | `timestamp = Date.now()`, `status = 'ONLINE'`, every HMI tag every time. |
| LKV entry (§5)          | `{ value, generation }`                                                    | `value === null` ⇒ bad quality. Generation increments by one per change. |
| DB queue entry (§6)     | `{ moduleTs, tags: [{ tagId, value }] }`                                   | Trendable tags only; array values excluded. |
| WebSocket wire (§7.4)   | `{ type: 'SNAPSHOT' \| 'DELTA', values: { [tag_id]: value } }`             | Keys are stringified tag IDs. No timestamp, no generation, no quality enum. |
| Trend WS wire (§7.6)    | `{ type: 'TREND_DELTA', samples: [{ moduleTs, tagId, value }, ...] }`      | Values are raw LKV values (number, boolean, string or null). The client coerces booleans to 1/0 and strings to null. |
| React state (§8)        | `LiveValue = { value }`                                                    | `value === null` ⇒ bad quality. Drives widget re-render. |

---

## 2. Stage 1a — MQTT Publish (Module / Simulator)

External producers publish JSON to `caro/{module_id}/telemetry`, QoS 0, retain false. `module_id` is the module's `asset_name` in the Tag Registry.

```jsonc
// Published to caro/{module_id}/telemetry
{
  "timestamp": 1712617200000,   // module UTC ms at publish
  "status":    "ONLINE",        // "ONLINE" | "FAULT"
  "tags": [
    { "tag_id": 1, "value": 85.47 },
    { "tag_id": 3, "value": true },
    { "tag_id": 9, "value": [0, 1, 0] }
  ]
}
```

**JSON only.** The backend decodes telemetry with `JSON.parse` and nothing else. A Protobuf payload (the simulator can produce one per `packages/proto/tag.proto`) fails to parse and is dropped without a log line. See `CARO_MQTT_Spec.md` §1.1.

**Key points.**
- `timestamp` is the only timestamp in the pipeline. It is module-level and is used for historian rows and trend samples only. It is not validated (tracked in `Docs/platform/platform_todo.md`).
- `status: 'FAULT'` nulls every tag of the module in the LKV before the message's values are applied, and the first non-FAULT message afterwards triggers a REQUEST_SNAPSHOT (§4.1).
- `tags[]` may carry every tag (full publish, the simulator default) or only changed tags (change-only mode); the backend handles both identically. An empty `tags` array is valid and still counts as a sign of life for the watchdog.
- Values have no per-tag timestamp and no metadata.

### 2.1 Scope

The HMI server treats a module as an MQTT module when its tags have `tag_registry.module_type = 'MQTT'`. The list is computed at startup in `index.ts` and used for heartbeats and the REHANDSHAKE sent on connect:

```ts
const mqttModuleIds = [...new Set(
  [...tagMap.values()]
    .filter(t => t.module_type === 'MQTT')
    .map(t => t.module_id),
)];
```

`module_id` comes from `tag-map.ts`: the `name` of the tag's `meta` level whose `type` is `'module'`, or `'unknown'` if there is none.

The *subscriptions* are wildcards (`caro/+/telemetry`), so telemetry from any `module_id` is ingested. A module that isn't in the registry only updates its own `lastSeen`; its tags are dropped as unknown.

Tags with `module_type='HMI'` never travel over MQTT; they are produced by `HmiTagSource` (§2b).

---

## 2b. Stage 1b — HMI-Internal Publish (HmiTagSource)

`HmiTagSource` is a second telemetry producer, entirely in-process, for tags whose `module_type='HMI'`. It covers values only the HMI server knows: `Tag_Count`, `Telemetry_CPU`, `Reset_Count`, the per-module `Module_Info.*` arrays, and the historian `Trend_Info.*` tags. These flow through the same `TelemetryIntake.ingest()` as external telemetry rather than through special pathways.

### 2b.1 Proxy-based property access

Callers read and write tag values as named properties. The property name is derived from `tag_path` by dropping everything up to and including the module segment and joining the remainder with `_`:

```
tag_path = 'CARO_1.HMI.Module_Info.Data_Rate'   → hmiTags.Module_Info_Data_Rate
tag_path = 'CARO_1.HMI.Status.Active'           → hmiTags.Status_Active
```

Two tags deriving the same property name throw at startup. A write to a property with no matching registry tag is absorbed and logged once per name; a read returns `null`. Every HMI tag starts at `null` except `Reset_Count`, which starts at `0`.

### 2b.2 Periodic publish

Every `HMI_PUBLISH_INTERVAL_MS` (default 250 ms), `publishTick()` runs:

```ts
private publishTick(): void {
  if (this.values.size === 0) return;
  this.onBeforePublish?.();
  this.dutyTracker.track(() => {
    this.updateModuleInfoTags();
    this.updateTrendInfoTags();
    const message: TelemetryMessage = {
      timestamp: Date.now(),
      status: 'ONLINE',
      tags: [...this.values.entries()].map(([tag_id, value]) => ({ tag_id, value })),
    };
    this.intake.ingest(this.moduleId, message);
  });
}
```

- `onBeforePublish` (wired in `index.ts`) writes the latest duty cycle into `hmiTags.Telemetry_CPU` (§4.4).
- `updateModuleInfoTags()` turns `TelemetryIntake.getModuleStats()` into the `Module_Info.*` arrays: `Data_Rate` (KB/s), `Pkg_Rate` (packets/s), `Status` (`ModuleStatus` enum: `ONLINE`/`OK` → OK, `FAULT`, `STALLED`, anything else → UNKNOWN), `Tags_Per_Pkg`, and `Watchdog` (packed bits, LSB-first, 16 modules per word, from the *latched* watchdog). Module order is `getModuleNames()` over every tag with a module, the same order the client's `ModuleInfoTable` computes.
- `updateTrendInfoTags()` copies `DbPipeline` and `TimescaleSizeMonitor` counters into `Trend_Info.*`.
- `this.moduleId` is the `module` column of the HMI tags (normally `HMI`).

`publishNow()` runs the same tick immediately; `CmdController.requestSnapshot()` uses it for the HMI module. From `ingest()` on, the path is identical to MQTT telemetry: LKV, DB pipeline, WS, widgets.

---

## 3. Stage 2 — MQTT Bridge (transport only)

`MqttBridge` is a pure transport adapter. It does **not** touch the LKV, the DB pipeline or the watchdog. It subscribes, parses, delegates, and publishes outbound messages.

### 3.1 Connect

```ts
this.client = mqtt.connect(this.config.mqttUrl);

this.client.on('connect', () => {
  this.client!.subscribe('caro/+/telemetry', () => {});
  this.client!.subscribe('caro/+/cmd_ack', () => {});
  this.client!.subscribe('caro/+/handshake_module', () => {});

  this.heartbeatTimer = setInterval(
    () => this.heartbeatTick(),
    this.config.heartbeatIntervalMs
  );

  for (const moduleId of this.moduleIds) {
    this.sendRehandshake(moduleId);
  }

  resolve();
});
```

- The connection uses mqtt.js defaults: MQTT 3.1.1, clean session, anonymous, no TLS, automatic reconnect.
- The `connect` handler runs again on every automatic reconnect, so subscriptions and REHANDSHAKE are re-sent each time. Beats are never withheld, so REHANDSHAKE is how a module learns of a backend restart shorter than its beat timeout; each bound module then re-binds (§3.4). The heartbeat timer is replaced, not stacked, on each connect, and stopped when the connection closes, so mqtt.js never queues beats offline (it queues QoS 0 publishes by default) and sends them as a burst on reconnect.
- `start()` resolves on the first connect. If it rejects, `index.ts` logs "MQTT broker unavailable" and the server keeps running on REST and WS without live telemetry.

### 3.2 Inbound

```ts
private handleMessage(topic: string, payload: Buffer): void {
  const parts    = topic.split('/');
  const moduleId = parts[1];
  const channel  = parts[2];

  if (channel === 'telemetry') {
    this.dutyTracker.track(() => {
      let raw: unknown;
      try {
        raw = JSON.parse(payload.toString());
      } catch {
        return;
      }
      const parsed = parseTelemetry(raw);
      if (!parsed.ok) {
        this.reportDrop(moduleId, `telemetry dropped: ${parsed.reason}`);
        return;
      }
      if (parsed.skipped > 0) {
        this.reportDrop(moduleId, 'telemetry entries skipped (bad tag_id or value)', parsed.skipped);
      }
      this.intake.ingest(moduleId, parsed.message);
    });
    return;
  }

  if (channel === 'cmd_ack') {
    let raw: unknown;
    try {
      raw = JSON.parse(payload.toString());
    } catch {
      return;
    }
    const parsed = parseCmdAck(raw);
    if (!parsed.ok) {
      this.reportDrop(moduleId, `CMD_ACK dropped: ${parsed.reason}`);
      return;
    }
    this.cmdAckHandler?.(moduleId, parsed.message);
    return;
  }

  // unknown channels — ignore
}
```

A third branch handles `handshake_module`: the parsed message goes, unvalidated, to the handler `HandshakeController` registers with `onHandshake()` (§3.4).

Unparseable JSON on any channel is dropped silently. Parsed telemetry and CMD_ACKs are then shape-checked by `mqtt-payloads.ts`, so nothing downstream sees a malformed payload:

- **Telemetry** is dropped unless `timestamp` is a finite number, `status` a string and `tags` an array. Entries whose `tag_id` is not an integer 0…2³²−1, or whose value is not a number, boolean, string, number array or null, are skipped; the rest of the frame still applies.
- **A CMD_ACK** is dropped unless `command_id` is a string, `error` (if present) a string, and every `results` entry `{ integer tag_id, boolean accepted, string rejection_code? }`. One malformed result drops the whole ACK: filtering it out could turn a rejection into an all-accepted ACK, while dropping it lets the command time out.
- Each drop is logged at once the first time, then at most once a minute per module and reason, with a count (`reportDrop`).

Telemetry handling is duty-tracked so its cost shows in `Telemetry_CPU`. CMD_ACKs go to `CmdController` (§3.3).

### 3.3 Outbound

| Topic | Payload | QoS | When |
|---|---|---|---|
| `caro/{module_id}/beat` | `{ ts_utc_ms }` | 0 | Every `HEARTBEAT_INTERVAL_MS` (default 1000 ms), to each MQTT module |
| `caro/{module_id}/cmd` | REQUEST_SNAPSHOT | 1 | Right after each post-CONFIRM Set push; on watchdog recovery; on the first non-FAULT message after a FAULT |
| `caro/{module_id}/cmd` | SET_VALUES | 1 | `POST /api/v1/tags/write`; the post-CONFIRM Set push (every Set, nulls included) |
| `caro/{module_id}/cmd` | RESET or custom `command_type` | 1 | `POST /api/v1/reset` (RESET to every module); `POST /api/v1/commands` |
| `caro/{module_id}/handshake_backend` | REHANDSHAKE | 1 | On every broker connect (all MQTT modules); after a Set push with no ACK (max 3 in a row) |
| `caro/{module_id}/handshake_backend` | TAG_LIST | 1 | In answer to each HANDSHAKE_REQUEST |

Every command carries a fresh `crypto.randomUUID()` `command_id`, `ts_utc_ms = Date.now()` and a `payload` (`{ values }` for SET_VALUES, `{}` otherwise).

`CmdController` (`cmd-controller.ts`) owns the command lifecycle. It waits 1 s for a CMD_ACK on SET_VALUES and on `POST /api/v1/commands`, and is fire-and-forget for the rest. An operator SET_VALUES stores its accepted values, and every value if it times out, in `commanded_setpoints`, the store the post-CONFIRM push reads; accepted values also go to `pending_setpoint_values`, which nothing reads yet. The full ACK contract is in `CARO_MQTT_Spec.md` §6.2–§6.3; the REST side is in `Docs/hmi/hmi_API_spec.md` §5–§5.1.

### 3.4 Module handshake

`HandshakeController` (`handshake-controller.ts`) is the backend side of `CARO_MQTT_Spec.md` §7; §7.5 there is the authoritative description. In outline:

- **HANDSHAKE_REQUEST** → a TAG_LIST from `buildTagList(tagMap, moduleId)` (`tag-list.ts`): the module's tags from the startup tag map, as `{ tag_id, tag_name, is_setpoint }` ordered by tag_id. `tag_name` is module-relative, from `moduleRelativeTagName()` in `@caro/tag-registry-shared`, the same function the Tag Defs export uses. Every request is answered (identity is not checked yet: `verifyModuleIdentity()` is a placeholder), except a payload `module_id` that differs from the topic, a module that is not MQTT-type in the registry, or a module with no tags.
- **CONFIRM** (only after a TAG_LIST to that module) → `missing_ids`, `unknown_tags` and `truncated` are logged; `CmdController.getModuleSetpoints()` reads every Set of the module from `commanded_setpoints` (`null` where nothing is stored); `pushSetpoints()` publishes them as one SET_VALUES with its ACK tracked; REQUEST_SNAPSHOT follows at once. An ACK changes the store only by upgrading values stored as `timeout` to `accepted` (keeping `set_by`). No ACK in time → REHANDSHAKE, at most 3 times in a row.
- State is in memory per module (TAG_LIST outstanding, push-timeout count); CONFIRM results are logged, not shown in the HMI.

---

## 4. Stage 3 — Telemetry Intake (universal ingestion)

`TelemetryIntake` is where all telemetry converges: MQTT, HMI-internal, and any future transport. It owns LKV writes, FAULT handling, the watchdog, per-module rate tracking, historian enqueue and the trend-listener call.

### 4.1 `ingest(moduleId, message)`

```ts
ingest(moduleId: string, message: TelemetryMessage): void {
  const isSnapshot = this.consumeTrendSnapshotPending(moduleId);

  this.lastSeen.set(moduleId, Date.now());

  this.packetCount.set(moduleId, (this.packetCount.get(moduleId) ?? 0) + 1);
  this.packetsInWindow.set(moduleId, (this.packetsInWindow.get(moduleId) ?? 0) + 1);
  this.byteAccumulator.set(moduleId, (this.byteAccumulator.get(moduleId) ?? 0) + JSON.stringify(message).length);
  this.tagCountLast.set(moduleId, message.tags.length);
  this.moduleStatus.set(moduleId, message.status);

  if (message.status === 'FAULT') {
    for (const tagId of this.moduleTagIds.get(moduleId) ?? []) {
      this.lkv.set(tagId, null);
    }
    // No early return: tag values carried in a FAULT frame are real telemetry
    // and must flow to the historian via the COV loop below.
  }

  const changedTrendable: { tagId: number; value: number | boolean | string | null }[] = [];

  for (const { tag_id, value } of message.tags) {
    if (!this.tagMap.has(tag_id)) continue;
    const changed = this.lkv.set(tag_id, value);
    // Defense in depth: the resolved-tag validator already excludes array types
    // from trendable tags, but this guard ensures that if validation is ever bypassed
    // (e.g. direct DB writes), an array value still cannot reach the db-pipeline queue.
    if (changed && this.trendableTagIds.has(tag_id) && !Array.isArray(value)) {
      changedTrendable.push({ tagId: tag_id, value });
    }
  }

  if (isSnapshot) {
    const snapshot = this.buildModuleSnapshot(moduleId);
    if (snapshot.length > 0) {
      this.dbPipeline.enqueue({ moduleTs: message.timestamp, tags: snapshot });
    }
  } else if (changedTrendable.length > 0) {
    this.dbPipeline.enqueue({ moduleTs: message.timestamp, tags: changedTrendable });
  }

  this.trendDeltaListener?.(message.timestamp, moduleId);
}
```

**Notable behaviors.**
- **Unknown tag IDs** are dropped silently (tolerates firmware newer or older than the registry). There is no check that a tag belongs to the publishing module.
- **FAULT** nulls every tag of the module, then applies the frame's own values. Tags present in the frame end up with their new value; tags absent from it stay null. The first message whose status is not `FAULT` after one that was calls `moduleRecoveredHandler` once its values are applied (§4.2), so a REQUEST_SNAPSHOT refills the tags change-only telemetry would leave null.
- **Historian:** only tags that changed and are trendable are enqueued, unless a trend snapshot is pending for this module (§4.5), in which case every trendable tag of the module is written from the LKV.
- **Byte rate** is measured as the length of the re-stringified message, not the wire payload.
- **Trend listener** fires on every ingest, whether or not anything changed (§7.6).

### 4.2 Watchdog (two-state model)

There are **two watchdog sets**:

- `timedOutModules` — non-latching. Tracks the real-time stall state; auto-clears when telemetry resumes.
- `watchdogLatched` — latching. Set when a module times out; stays set until an explicit reset (`POST /api/v1/reset` → `resetAllWatchdogs()`) while the module is live again.

```ts
watchdogTick(): void {
  this.dutyTracker.track(() => {
    const now = Date.now();
    for (const [moduleId, tagIds] of this.moduleTagIds) {
      const last = this.lastSeen.get(moduleId) ?? 0;
      const timedOut = now - last > this.watchdogTimeoutMs;

      if (timedOut) {
        if (!this.timedOutModules.has(moduleId)) {
          // Transition into stalled — null LKV, set status, enqueue sentinel
          this.timedOutModules.add(moduleId);
          for (const tagId of tagIds) {
            this.lkv.set(tagId, null);
          }
          this.moduleStatus.set(moduleId, 'STALLED');
          this.enqueueWatchdogStallSentinel(moduleId);
        }
        // Latch the watchdog indicator (survives comms resumption until manual reset)
        this.watchdogLatched.add(moduleId);
      } else {
        if (this.timedOutModules.has(moduleId)) {
          // STALLED → OK transition: request a snapshot so LKV is repopulated immediately
          this.moduleRecoveredHandler?.(moduleId);
        }
        // Comms are live — auto-clear the real-time stall flag
        this.timedOutModules.delete(moduleId);
      }
    }
  });
}
```

- The tick interval is `min(watchdogTimeoutMs, 500)`, so detection never lags the timeout by more than ~500 ms.
- The watchdog covers every module in the registry, including the HMI module and any `'unknown'` module group. A module never heard from counts as stalled from startup.
- **On stall**, `enqueueWatchdogStallSentinel` writes one historian row of `null` per trendable tag (`moduleTs = Date.now()`), so trends show a gap instead of a flat line.
- **On recovery**, and on leaving FAULT (§4.1), `moduleRecoveredHandler` (wired in `index.ts`) calls `cmdController.requestSnapshot(moduleId)` (REQUEST_SNAPSHOT for MQTT, `publishNow()` for HMI), so tags that do not change, which change-only telemetry never re-sends, leave the null the stall wrote. Sets are not re-sent here: a module that lost its connection re-binds and gets the post-CONFIRM push (§3.4).
- `resetWatchdog(moduleId)` and `resetAllWatchdogs()` clear the latch only for modules heard from within the timeout, so a reset can't clear a still-silent module.

### 4.3 Rate tracking and module stats

A second 1 Hz timer snapshots per-module packet and byte counts:

```ts
startRateTimer(): void {
  this.rateTimer = setInterval(() => {
    this.dutyTracker.track(() => {
      for (const moduleId of this.moduleTagIds.keys()) {
        this.lastRateSnapshot.set(moduleId, {
          packetsPerSec: this.packetsInWindow.get(moduleId) ?? 0,
          bytesPerSec: this.byteAccumulator.get(moduleId) ?? 0,
        });
        this.packetsInWindow.set(moduleId, 0);
        this.byteAccumulator.set(moduleId, 0);
      }
    });
    this.lastDutyCycle = this.dutyTracker.snapshot(1000);
  }, 1000);
}
```

`getModuleStats()` returns `{ module_id, status, packets_per_sec, bytes_per_sec, tags_in_last_packet, stalled, last_seen_ms }` per module, where `stalled` is the *latched* flag. `HmiTagSource` publishes them as the `Module_Info.*` tags (§2b.2).

### 4.4 Duty-cycle accounting

These hot-path callbacks are wrapped in `dutyTracker.track(fn)`:
- `MqttBridge.handleMessage` (telemetry branch)
- `TelemetryIntake.watchdogTick` and the rate timer
- `HmiTagSource.publishTick`
- `WsServer.tick` and `WsServer.trendFlush`
- `TrendSnapshotScheduler.tick`

`DbPipeline` runs its own flush timer and is not duty-tracked. The 1 Hz rate timer calls `DutyTracker.snapshot(1000)` outside `track()`, which returns busy time as a percentage and resets the accumulator. `HmiTagSource.onBeforePublish` writes the result to `hmiTags.Telemetry_CPU`, so server load shows in the UI as just another tag.

### 4.5 Trend snapshot scheduler

`TrendSnapshotScheduler` (`trend-snapshot-scheduler.ts`) guarantees every trendable tag at least one historian row per `TREND_SNAPSHOT_INTERVAL_MS` (default 60 s; off with `TREND_SNAPSHOT_ENABLED=false`). Each tick:
1. **Force-write:** any module still pending from the previous tick gets `forceTrendSnapshot()`, an LKV snapshot written with `moduleTs = Date.now()` because no telemetry arrived.
2. **Piggyback:** every module is marked pending again, so its *next* `ingest()` writes the full snapshot with the module's own timestamp (§4.1).

This is unrelated to the MQTT REQUEST_SNAPSHOT command; it never touches MQTT.

---

## 5. Stage 4 — LKV Cache

The Last-Known-Value cache is the central data structure: an in-memory `Map<tag_id, LkvEntry>`.

```ts
// lkv.ts
export type LkvValue = number | boolean | string | number[] | boolean[] | string[] | null;

export interface LkvEntry {
  value: LkvValue;
  generation: number;
}
```

### 5.1 `set()` — change detection is here

```ts
set(tagId: number, value: LkvValue): boolean {
  const existing = this.entries.get(tagId);
  if (existing !== undefined && valuesEqual(existing.value, value)) {
    return false;
  }
  if (existing !== undefined) {
    existing.value = value;
    existing.generation++;
    return true;
  }
  this.entries.set(tagId, { value, generation: 1 });
  return true;
}
```

`valuesEqual` uses strict equality for scalars and element-wise comparison for arrays. If a module sends `85.47` twice in a row, the second `set()` returns `false` and the generation is unchanged, so the WS server sends no DELTA for that tag.

Entries are created lazily. A tag never written has generation `0`, and `getValue()` returns `null` (bad quality) for it.

### 5.2 Null transitions

If `value` was `85.47` and the watchdog writes `null`, the generation bumps. The WS server sends `DELTA { "1": null }`, and the widget renders `---`. When the module comes back with `85.47`, the generation bumps again and the widget restores the number.

### 5.3 No timestamps

The LKV stores no timestamps; the only ordering is generation. Generations are plain JavaScript numbers, exact up to 2⁵³, so they never wrap in practice.

---

## 6. Stage 5 — DB Pipeline

`DbPipeline` is a push-based queue. `TelemetryIntake` enqueues three kinds of entry:
- the trendable tags that changed on an ingest;
- a full trendable-tag snapshot when the snapshot scheduler asks for one (§4.5);
- a null sentinel per trendable tag when the watchdog marks a module stalled.

The pipeline batch-flushes to the historian through a swappable writer: `TimescaleDbWriter` (wraps `writeTagSamples()` from `@caro/db`), or `NullDbWriter` when TimescaleDB was unreachable at startup. `HistorianReconnector` hot-swaps the real writer in via `setWriter()` once the historian comes back.

```ts
export interface DbWriteEntry {
  moduleTs: number;
  tags: { tagId: number; value: number | boolean | string | null }[];
}
```

`moduleTs` is the **source-message** timestamp, not the HMI server's receipt time. Every tag in one entry shares the same `moduleTs`.

`DbPipeline` owns its own tick. `start()` sets an interval of `TIMESCALE_DB_TICK_MS` (default 500 ms) that calls `flushOnce()`:
1. Peek up to `TIMESCALE_DB_MAX_ENTRIES_PER_FLUSH` (500) entries.
2. Write them, with an in-flight guard so flushes never overlap.
3. Consume them only on success; a failed write leaves the queue intact for the next tick.

The queue is capped at `TIMESCALE_DB_QUEUE_MAX` (5000) and drops the oldest entries when full. Its counters feed the `Trend_Info` tags.

The DB pipeline is independent of the WS pipeline. They share the LKV but run on different triggers: DB is push-enqueued by `TelemetryIntake`; WS is pulled by a tick.

Write-path detail (writer coercion, bad-quality nulls, storage): [`../hmi/trend-viewer/hmi_trend_viewer_reference.md`](../hmi/trend-viewer/hmi_trend_viewer_reference.md).

---

## 7. Stage 6 — WebSocket Server

The WebSocket endpoint is `/ws` on the HMI HTTP server (port 3003; the Vite dev client proxies it). All messages are JSON. There is no authentication; the session check described in `hmi_API_spec.md` §11 is not built.

### 7.1 Client state

```ts
interface WsClient {
  ws: WebSocket;
  subscriptions: Set<number>;
  lastSentGen: Map<number, number>;
  trendSubscriptions: Set<number>;
  trendOutbox: Map<number, Array<{ moduleTs: number; value: LkvValue }>>;
  trendDroppedCount: number;
}
```

On `close` or `error`, the client's trend state is cleared and the client is removed.

### 7.2 Inbound messages

| Type | Handling |
|---|---|
| `SUBSCRIBE { tagIds }` | Adds the IDs to `subscriptions`. Immediately sends a `SNAPSHOT` containing **only the newly subscribed** IDs (an empty `values` object if all were already subscribed) and pins their `lastSentGen` to the current generation. |
| `UNSUBSCRIBE { tagIds }` | Removes the IDs from `subscriptions` and `lastSentGen`. No reply. |
| `SUBSCRIBE_TREND { tagIds }` | Adds only **trendable** IDs to `trendSubscriptions`; others are logged and ignored. No reply. |
| `UNSUBSCRIBE_TREND { tagIds }` | Removes the IDs and their outbox entries. No reply. |
| `PING { ts }` | Replies `PONG { ts }` with the same value, for client latency measurement. |

`tagIds` must be an array. A non-array payload is ignored with a warning; within an array, only positive integers are used, and the others are logged by value. One bad ID never discards the rest of the batch. Unparseable JSON and unknown types are ignored.

```ts
case 'SUBSCRIBE': {
  const parsed = this.parseTagIdsArray((msg as { tagIds?: unknown }).tagIds);
  if (!parsed) { console.warn('[WsServer] SUBSCRIBE: ignored malformed (non-array) tagIds payload'); return; }
  const { valid: tagIds, rejected } = parsed;
  if (rejected.length > 0) {
    console.warn(`[WsServer] SUBSCRIBE: ignored ${rejected.length} invalid tagId(s): ${rejected.join(', ')}`);
  }
  const newTagIds = tagIds.filter(id => !client.subscriptions.has(id));
  for (const id of tagIds) client.subscriptions.add(id);
  const values: Record<string, LkvValue> = {};
  for (const id of newTagIds) {
    values[String(id)] = this.lkv.getValue(id);
    client.lastSentGen.set(id, this.lkv.getGeneration(id));
  }
  this.send(client, { type: 'SNAPSHOT', values });
  break;
}
```

### 7.3 The tick — DELTA generation

Runs every `WS_TICK_MS` (default 125 ms, 8 Hz):

```ts
private tick(): void {
  this.dutyTracker.track(() => {
    for (const client of this.clients) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;

      const delta: Record<string, LkvValue> = {};

      for (const tagId of client.subscriptions) {
        const currentGen = this.lkv.getGeneration(tagId);
        const lastGen = client.lastSentGen.get(tagId) ?? 0;
        if (currentGen > lastGen) {
          delta[String(tagId)] = this.lkv.getValue(tagId);
          client.lastSentGen.set(tagId, currentGen);
        }
      }

      if (Object.keys(delta).length > 0) {
        this.send(client, { type: 'DELTA', values: delta });
      }
    }
  });
}
```

### 7.4 Wire format

```jsonc
// Server → client, on SUBSCRIBE
{ "type": "SNAPSHOT", "values": { "1": 85.47, "2": 12.03, "3": true, "4": null } }
// Server → client, on tick, when at least one subscribed tag changed
{ "type": "DELTA",    "values": { "1": 86.12 } }
// Server → client, reply to PING
{ "type": "PONG", "ts": 1716543600000 }
```

Keys are stringified tag IDs. Values are raw LKV values (number, boolean, string, array or null). There is no timestamp, quality enum or generation on the wire.

### 7.5 Why generation counters?

| Approach             | Problem                                                                                                      | Generation advantage |
|----------------------|--------------------------------------------------------------------------------------------------------------|----------------------|
| Dirty-flag set       | One flag per tag, not per client. If client A reads before client B, B misses the change.                    | Per-client `lastSentGen`; nobody can miss updates. |
| Timestamp comparison | Requires synchronized clocks. Timestamp must be stored per tag.                                              | No clock dependency. Generation is monotonic and local. |
| Broadcast all        | Every client gets every tag on every tick. Wastes bandwidth.                                                 | Tailored per-client deltas. Only changed + subscribed tags sent. |

### 7.6 Trend WebSocket Channel

A parallel channel on the same connection serves the trend chart's live tail. The live-value channel coalesces at 8 Hz, carries no timestamps and sends only changes. That is right for widgets, but a live trend has to line up exactly with historian tiles, so the trend channel avoids all three:

| Limitation | Live-value channel | Trend channel |
|---|---|---|
| Coalescing | 8 Hz tick; intermediate values are lost | One sample per ingest per subscribed tag, all kept until the flush |
| No timestamp | DELTA carries no time | Each sample carries the `moduleTs` of the telemetry frame that produced it |
| Only-changed | Flatlined tags produce nothing | A subscribed tag with no ingest in the window gets one synthetic sample per flush |

#### Wire messages

```jsonc
// Client → server
{ "type": "SUBSCRIBE_TREND",   "tagIds": [1, 2, 3] }
{ "type": "UNSUBSCRIBE_TREND", "tagIds": [1] }

// Server → client
{
  "type": "TREND_DELTA",
  "samples": [
    { "moduleTs": 1716543600000, "tagId": 1, "value": 85.47 },
    { "moduleTs": 1716543600100, "tagId": 1, "value": 86.12 },
    { "moduleTs": 1716543600000, "tagId": 2, "value": true }
  ]
}
```

A tag can appear several times in one frame, once per ingest of its module in the window. Values are the raw LKV value: booleans arrive as `true`/`false` and `null` is preserved. The client does the numeric coercion (§8.7).

#### Server-side mechanics

`index.ts` registers `intake.setTrendDeltaListener((moduleTs, moduleId) => wsServer.handleTrendDelta(moduleTs, moduleId))`. On every ingest:

```ts
handleTrendDelta(moduleTs: number, moduleId: string): void {
  const trendableTags = this.trendableTagsByModule.get(moduleId);
  if (!trendableTags || trendableTags.size === 0) return;

  // Read LKV once — shared across all clients for this ingest
  const lkvCache = new Map<number, LkvValue>();
  for (const tagId of trendableTags) {
    lkvCache.set(tagId, this.lkv.getValue(tagId));
  }

  for (const client of this.clients) {
    for (const tagId of trendableTags) {
      if (!client.trendSubscriptions.has(tagId)) continue;
      let events = client.trendOutbox.get(tagId);
      if (!events) {
        events = [];
        client.trendOutbox.set(tagId, events);
      }
      if (events.length >= MAX_TREND_OUTBOX_PER_TAG) {
        events.shift();                    // drop oldest — newest data is more relevant for live tail
        client.trendDroppedCount++;
      }
      events.push({ moduleTs, value: lkvCache.get(tagId) ?? null });
    }
  }
}
```

So each ingest adds one sample for *every* subscribed trendable tag of that module, carrying the tag's current LKV value, whether or not it changed in that message. A module publishing at 10 Hz produces about 10 samples per tag per second. Each tag's outbox is capped at `MAX_TREND_OUTBOX_PER_TAG = 500`, dropping the oldest, with one batched warning per flush.

`trendFlush()` runs every `1000 / TREND_FLUSH_HZ` ms (default 250 ms; `TREND_FLUSH_HZ` must be an integer 1–20 or the server refuses to start). For each open client with trend subscriptions:
1. Each subscribed tag with outbox events contributes all of them, in order.
2. Each subscribed tag with none contributes one synthetic sample `{ moduleTs: Date.now(), tagId, value: <current LKV> }`. This uses server time, a different clock from the module timestamps (see `hmi_trend_viewer_handoff.md` §11, issue D).
3. The outbox is cleared and one `TREND_DELTA` frame is sent. Every flush sends a frame while the client has trend subscriptions.

Client-side use of this channel: `Docs/hmi/trend-viewer/hmi_trend_viewer_spec.md` §4.4 and §10.6.

---

## 8. Stage 7 — Client Context

The client wraps the React tree in `HmiContextProvider` from `@caro/hmi-context` (`apps/caro-hmi/client/src/App.tsx`: `apiUrl="/api/v1"`, `wsUrl={`ws://${window.location.host}/ws`}`). The provider owns the WebSocket, the tag map, the tag-path index, `projectRoot`, the live-value map and the per-tag subscriber callbacks.

### 8.1 Split context

The provider exposes **two** contexts, so the once-a-second stats refresh doesn't cause subscription churn:

| Context             | Contents                                                         | Update rate |
|---------------------|------------------------------------------------------------------|-------------|
| `HmiDataContext`    | `tagMap`, `tagPathIndex`, `projectRoot`, `getLiveValue`, `subscribeLiveValue`, `subscribeTrend`, `writeTag`, `sendCommand` | Stable — changes only when the tag map loads |
| `HmiStatsContext`   | `wsStats` (`connected`, `latencyMs`, `messagesPerSec`, `bytesPerSec`, `subscribedCount`) | 1 Hz |

`useLiveValue` depends only on `HmiDataContext`, so the 1 Hz `wsStats` refresh never re-runs subscription effects.

### 8.2 Initialization sequence

1. Fetch `GET /api/v1/tags` and `GET /api/v1/config` in parallel. A failure of either is logged and the app carries on: an empty tag map, or `projectRoot = null`.
2. Build `tagMap` and `tagPathIndex` (§8.3) from the tags response.
3. When both requests have settled, set `tagMapLoaded`. Until then the provider renders `null`, so children never mount against an empty map.
4. Open the WebSocket (the effect is gated on `tagMapLoaded`).

### 8.3 TagPathIndex — O(1) asset-path resolution

Widgets resolve asset paths like `RF_Fwd.monitor` against `tag_path`. Scanning the full tag map (1.5k+ entries) on every widget mount dominated page-navigation time on tag-dense pages, so the index is built **once** when the tag map loads. It inserts every contiguous segment run of every `tag_path` as a key:

```ts
// packages/hmi-context/src/tagPathIndex.ts
export function buildTagPathIndex(tags: Iterable<TagDef>): TagPathIndex {
  const map = new Map<string, TagDef[]>();
  for (const tag of tags) {
    const segments = tag.tag_path.split('.');
    for (let start = 0; start < segments.length; start++) {
      for (let end = start + 1; end <= segments.length; end++) {
        const key    = segments.slice(start, end).join('.');
        const bucket = map.get(key);
        if (bucket) bucket.push(tag);
        else        map.set(key, [tag]);
      }
    }
  }
  return { resolve: (path) => map.get(path) ?? [] };
}
```

`useResolveAssetPath(assetPath)` and `useTagGroup(basePath, children, widgetName)` both delegate to `ctx.tagPathIndex.resolve(path)`. Detecting ambiguous matches and handling errors is the consumer's job.

### 8.4 WebSocket message handling

```ts
// HmiContextProvider.tsx — ws.onmessage (after JSON.parse and byte counting)
if (msg.type === 'SNAPSHOT' || msg.type === 'DELTA') {
  wsStatsRef.current.messageCount++;
  const entries = msg.values ?? {};
  for (const [key, rawValue] of Object.entries(entries)) {
    const tagId = Number(key);
    const lv: LiveValue = { value: rawValue as number | boolean | string | null };
    valuesRef.current.set(tagId, lv);
    subscribersRef.current.get(tagId)?.forEach(cb => cb(lv));
  }
} else if (msg.type === 'TREND_DELTA') {
  wsStatsRef.current.messageCount++;
  for (const { moduleTs, tagId, value } of msg.samples ?? []) {
    trendSubscribersRef.current.get(tagId)?.forEach(cb => cb(moduleTs, value));
  }
} else if (msg.type === 'PONG' && msg.ts !== undefined) {
  latencyRef.current = Date.now() - msg.ts;
}
```

- `valuesRef` — `Map<tag_id, LiveValue>`. The client-side mirror of the LKV for subscribed tags: just `{ value }`, with no quality, timestamp or module_id.
- `subscribersRef` — `Map<tag_id, Set<callback>>`. Each `useLiveValue` call registers one callback (its `useState` setter) and removes it on unmount.

### 8.5 Subscription management — level-triggered reconciler

The provider manages SUBSCRIBE / UNSUBSCRIBE through a **level-triggered reconciler** with two sets:

- `desiredRef: Set<number>` — tag IDs at least one hook currently wants.
- `serverRef: Set<number>` — tag IDs the client has subscribed on the wire and not yet retracted.

`subscribeLiveValue` and its unsubscribe function only mutate `desiredRef` and schedule a microtask flush. The flush is the only code that talks to the wire. It sends at most one message of each type, in the order `SUBSCRIBE` → `SUBSCRIBE_TREND` → `UNSUBSCRIBE` → `UNSUBSCRIBE_TREND`, and only while the socket is open.

**Guarantees.**
- Any ordering of subscribe and unsubscribe calls within one microtask collapses to the final `desiredRef` state.
- Subscribing and unsubscribing the same tag ID in the same tick produces zero wire messages.
- `subscribeLiveValue(undefined, cb)` (an optional asset path that doesn't resolve) is a non-event: `cb({ value: null })`, with no subscription and no wire traffic.

### 8.6 Connection lifecycle

- **Open:** resets the reconnect delay to 1 s, starts a `PING { ts }` every 5 s (the `PONG` gives `latencyMs`), clears `serverRef` and schedules a flush. The flush then sends one `SUBSCRIBE` (and `SUBSCRIBE_TREND`) with everything currently desired, and the server answers with a fresh SNAPSHOT.
- **Close or error:** sets every subscribed tag to `{ value: null }` and notifies its subscribers immediately, so widgets show bad quality the moment the connection drops. Then it clears `serverRef` and `trendServerRef`, stops the PING timer and schedules a reconnect. The reconnect delay starts at 1 s and doubles on each consecutive failure up to 30 s. `desiredRef`/`trendDesiredRef` are kept.

### 8.7 `useLiveValue` — seed via initializer, sync via subscribe

```ts
// packages/hmi-context/src/hooks/useLiveValue.ts
export function useLiveValue(tagId: number | undefined): LiveValue {
  const ctx = useHmiContext();
  const [liveValue, setLiveValue] = useState<LiveValue>(() =>
    tagId === undefined ? { value: null } : ctx.getLiveValue(tagId)
  );

  useEffect(() => {
    // subscribeLiveValue calls back synchronously with the current value, reconciling
    // any value that changed between the useState initializer and this effect firing.
    const unsubscribe = ctx.subscribeLiveValue(tagId, setLiveValue);
    return unsubscribe;
  }, [tagId, ctx]);

  return liveValue;
}
```

Nothing calls `setLiveValue` on mount. The `useState` initializer seeds the value, and `subscribeLiveValue` invokes the callback synchronously at subscribe time, which reconciles any drift between render and effect. On tag-dense pages, avoiding ~N extra state updates per mount measurably reduces navigation time.

### 8.8 Trend client subscription

`subscribeTrend(tagId, callback)` feeds a second reconciler (`trendDesiredRef` / `trendServerRef`) through the same flush as §8.5, and has the same reconnect behaviour (§8.6). On each `TREND_DELTA`, the provider calls every callback registered for each sample's `tagId` with `(moduleTs, value)`.

The consumer is `useLiveSubscription` in `@caro/trend-chart`. It keeps:

- a **per-tag ring** of the last `TREND_RING_CAPACITY = 20` samples;
- a **bucket accumulator** (aggregate mode), which folds samples into the current bucket of the visible resolution;
- a **raw buffer** (raw mode), trimmed to 2 × the viewport span.

It coerces values with `toNumericValue`: booleans become 1/0, strings and `null` become `null` (a gap). On leaving live mode, `drainBuffers()` clears the accumulator, raw buffers and high-water mark (not the ring) before the mode change. Full hook architecture: [`../hmi/trend-viewer/hmi_trend_viewer_handoff.md`](../hmi/trend-viewer/hmi_trend_viewer_handoff.md) §8.

---

## 9. Stage 8 — Widget Render

Widgets are the final destination: they turn a `LiveValue` into pixels. `NumericMon` is shown here; composite widgets (e.g. `AnalogIn`) follow the same pattern via `useTagGroup`.

### 9.1 Path resolution + live subscription

```ts
// packages/widgets/src/NumericMon.tsx
function NumericMonInner({ assetPath, label }: NumericMonProps) {
  const tag = useSingleTag(assetPath, 'NumericMon');
  const lv = useLiveValue(tag.tag_id);
  const fmt = resolveFormat(tag);
  const displayLabel = resolveLabel(assetPath, label);

  const badQuality = lv.value === null;

  return (
    <div className={ROW_CONTAINER}>
      <span className={LABEL_CLASS}>{displayLabel}</span>
      {badQuality ? (
        <span className={VALUE_BAD_CLASS}>---</span>
      ) : (
        <span className={VALUE_CLASS}>{fmt(lv.value as number)}</span>
      )}
      <span className={UNIT_CLASS}>{tag.unit ?? '-'}</span>
    </div>
  );
}

export const NumericMon = withErrorBoundary(NumericMonInner);
```

`useSingleTag` resolves through `tagPathIndex` and throws unless exactly one tag matches; `withErrorBoundary` contains that error to the widget.

### 9.2 Rendering rules

| `lv.value`          | Render |
|---------------------|--------|
| `null`              | `---` in the bad-quality style. |
| number              | `fmt(value)`, the pattern compiled once from `tag.format` (`#`, `#.##`, `#.##E+0`; default `#.##`). Unit from `tag.unit`, `-` if none. |
| boolean / string / array | Not handled by `NumericMon`. Booleans go to `BooleanMon`/`BooleanSet`, `number[]` to `SpectrumChart`. No widget renders strings yet (see `platform_todo.md`). |

### 9.3 Field resolution

`unit`, `eng_min`, `eng_max`, `format` and `tag_name` are resolved by the Tag Registry's `resolveRegistry` when a registry is applied, and stored as columns of `tag_registry`. The HMI server copies them straight from those columns into each `TagDef` (`tag-map.ts`), and widgets read them from `TagDef` (`resolveFormat` in `packages/widgets/src/shared/utils.ts`). Nothing walks `meta` for these fields. `meta` is used only for structure (the module ancestor that gives `module_id`).

---

## 10. Threading and Safety Model

The HMI server runs on a single Node.js event loop: no worker threads, no shared memory, no locks.

### 10.1 Why no locks?

In a multi-threaded design the LKV would need a read-write lock, with MQTT writing and WS reading. In Node.js these never execute concurrently.

- **MQTT message callback** — runs synchronously on the event loop. Writes via `lkv.set()`. Cannot be interrupted.
- **HmiTagSource publish timer** — same. Writes to the LKV via `intake.ingest()`.
- **Watchdog tick** — same. Writes nulls to the LKV.
- **Rate-snapshot tick** — same. Reads counters, resets them.
- **WS tick** — same. Reads `lkv.getGeneration()` and `lkv.getValue()`.
- **trendFlush tick** — same. Drains each subscribed client's `trendOutbox` and sends `TREND_DELTA`.
- **Trend snapshot tick** — same. Enqueues LKV snapshots.
- **DB flush timer** — peeks the queue synchronously, awaits the database write, then consumes the batch in the promise callback. The in-flight guard stops a second flush from starting meanwhile; enqueues during the write only append to the queue tail.

Each synchronous callback runs to completion before the next one starts. That is the Node.js concurrency guarantee: no preemption within the synchronous phase of a callback.

### 10.2 Async boundaries

The async operations are:
- `ws.send()` and `mqtt.publish()` — both buffer internally and return synchronously;
- historian writes and setpoint-store reads and writes (Postgres/TimescaleDB);
- the startup DB calls, which finish before any telemetry is processed.

No async operation sits between an LKV read and a `ws.send()` in `WsServer.tick()`.

---

## 11. Configuration Reference

HMI server settings live in `apps/caro-hmi/server/.env` (see `.env.example`) and are read in `config.ts` or by the class that uses them.

| Env var                   | Default                | Used by               | Effect |
|---------------------------|------------------------|-----------------------|--------|
| `HMI_PORT`                | `3003`                 | `index.ts`            | HTTP + WebSocket port. |
| `MQTT_URL`                | `mqtt://localhost:1883`| `mqtt-bridge.ts`      | Broker address. If the broker is absent the server runs degraded (REST and WS serve the LKV without live telemetry). |
| `HEARTBEAT_INTERVAL_MS`   | `1000`                 | `mqtt-bridge.ts`      | Interval of `caro/{module_id}/beat`. |
| `WATCHDOG_TIMEOUT_MS`     | `1000`                 | `telemetry-intake.ts` | Silence before a module is marked STALLED and its LKV entries nulled. |
| `HMI_PUBLISH_INTERVAL_MS` | `250`                  | `hmi-tag-source.ts`   | HmiTagSource publish interval; also how often `Telemetry_CPU` refreshes. |
| `WS_TICK_MS`              | `125`                  | `ws-server.ts`        | Live-value DELTA tick. |
| `TREND_FLUSH_HZ`          | `4`                    | `ws-server.ts`        | Trend channel flush rate. Integer 1–20; anything else stops startup. |
| `TREND_SNAPSHOT_ENABLED`  | `true`                 | `index.ts`            | `false` disables the trend snapshot scheduler (§4.5). |
| `TREND_SNAPSHOT_INTERVAL_MS` | `60000`             | `trend-snapshot-scheduler.ts` | Guaranteed historian-row interval per trendable tag. |
| `TIMESCALE_DB_TICK_MS`    | `500`                  | `db-pipeline.ts`      | DB flush interval. (`config.ts` also reads it as `dbTickMs` with a `100` default, but nothing uses that value.) |
| `TIMESCALE_DB_QUEUE_MAX`, `TIMESCALE_DB_MAX_ENTRIES_PER_FLUSH`, `TIMESCALE_RECONNECT_MS`, `TIMESCALE_SIZE_POLL_MS` | `5000`, `500`, `30000`, `30000` | historian | See `apps/caro-hmi/CLAUDE.md` § Environment. |
| `POSTGRES_*`, `TIMESCALE_*` connection vars | — | `@caro/db` | Root `.env`; see `Docs/db/db_handoff.md`. |

Constants that are not configurable: CMD_ACK timeout 1000 ms (`cmd-controller.ts`), which also bounds the post-CONFIRM Set push; REHANDSHAKE retries after an unacknowledged push, 3 in a row (`MAX_PUSH_RETRIES`, `handshake-controller.ts`); trend outbox cap 500 per tag (`ws-server.ts`); client PING 5 s and reconnect backoff 1 s → 30 s (`HmiContextProvider.tsx`).

---

## 12. Known Gaps

Behaviour a reader could reasonably assume but the implementation does not provide. Fixing any of these is a code change, not a doc change.

| Gap | Where | Effect |
|---|---|---|
| Protobuf telemetry is not decoded | `mqtt-bridge.ts` `handleMessage` | A module publishing Protobuf (the spec's target default) is silently ignored; the watchdog then marks it STALLED. |
| Telemetry timestamp not validated | `telemetry-intake.ts` | Tracked in `platform_todo.md`. |
| Tag ownership not checked | `telemetry-intake.ts` | A module can update any registry tag by publishing its tag_id. |
| No MQTT TLS or auth, no WS auth | `mqtt-bridge.ts`, `ws-server.ts` | See `CARO_MQTT_Spec.md` §1.1 and `hmi_API_spec.md` §11. |
| Module identity not verified | `handshake-controller.ts` `verifyModuleIdentity()` | Every HANDSHAKE_REQUEST from an MQTT-type registry module is answered, whatever its `fw_hash` or template. See `CARO_MQTT_Spec.md` §7.3. |
| Modules that don't handshake get no Sets or snapshot | `handshake-controller.ts`, `mqtt-bridge.ts` | Sets and REQUEST_SNAPSHOT follow a bind only (watchdog recovery still sends REQUEST_SNAPSHOT). Today this affects the MQTT Simulator (`platform_todo.md`). |

---

## 13. Related Documents

| Document                                 | Path                                   |
|------------------------------------------|----------------------------------------|
| MQTT interface spec (ICD)                | [`CARO_MQTT_Spec.md`](CARO_MQTT_Spec.md) |
| Historian write path                     | [`../hmi/trend-viewer/hmi_trend_viewer_reference.md`](../hmi/trend-viewer/hmi_trend_viewer_reference.md) |
| HMI App Anchor                           | `apps/caro-hmi/CLAUDE.md`              |
| HMI Functional Spec                      | [`../hmi/hmi_functional_spec.md`](../hmi/hmi_functional_spec.md) |
| HMI API Spec (REST + WebSocket)          | [`../hmi/hmi_API_spec.md`](../hmi/hmi_API_spec.md) |
| HMI Widget Spec                          | [`../hmi/hmi_widget_spec.md`](../hmi/hmi_widget_spec.md) |
| HMI Trend Viewer Spec / Handoff          | [`../hmi/trend-viewer/`](../hmi/trend-viewer/) |
| MQTT Simulator Bootstrap                 | [`../mqtt-simulator/mqtt_simulator_bootstrap.md`](../mqtt-simulator/mqtt_simulator_bootstrap.md) |
| Protobuf schema                          | `packages/proto/tag.proto`             |
| Platform entry point                     | [`../README.md`](../README.md)         |
