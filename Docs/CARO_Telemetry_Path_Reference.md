# CARO_Platform — Telemetry Path Reference

**From telemetry producer to screen pixel.**
**Version:** 2.0 — April 2026
**Status:** Replaces `CARO_Telemetry_Path_Reference.docx` (v1.0, now obsolete).
*Internal technical reference.*

---

## 1. Overview

This document traces every step a telemetry value takes from its producer (MQTT device, or the HMI server itself) to a rendered pixel in the operator's browser. Each section corresponds to one module in the codebase. Code snippets are verbatim from the implementation. The goal is zero ambiguity about how data flows, transforms, and is consumed.

### 1.1 End-to-End Summary

The full path has nine stages. Stages 1a and 1b are alternative producers; both feed Stage 2.

| #   | Stage                       | Module                        | What happens |
|-----|-----------------------------|-------------------------------|--------------|
| 1a  | MQTT publish                | device / `mqtt-simulator`     | JSON telemetry published to `caro/{module_id}/telemetry` at ~10 Hz |
| 1b  | HMI-internal publish        | `hmi-tag-source.ts`           | Proxy-based producer for `module_type='HMI'` tags; emits `TelemetryMessage` on a 250 ms timer |
| 2   | MQTT receive (transport)    | `mqtt-bridge.ts`              | Subscribes `caro/+/telemetry`, parses JSON, delegates to `TelemetryIntake.ingest()` |
| 3   | Universal ingestion         | `telemetry-intake.ts`         | LKV writes, FAULT handling, watchdog, rate tracking, DB enqueue |
| 4   | LKV cache                   | `lkv.ts`                      | In-memory `Map<tag_id, { value, generation }>`; generation bumps only on value change |
| 5   | DB pipeline (placeholder)   | `db-pipeline.ts`              | Module-timestamped queue for future TimescaleDB writes |
| 6   | WebSocket server            | `ws-server.ts`                | Pull-based 125 ms (8 Hz) tick; per-client generation diff; `SUBSCRIBE → SNAPSHOT → DELTA` |
| 7   | Client context              | `HmiContextProvider.tsx`      | Browser WS ingests `SNAPSHOT`/`DELTA`, updates `valuesRef`, fans out to subscriber callbacks |
| 8   | Widget render               | `@caro/widgets`               | `useLiveValue` returns the new value; widget re-renders; `null` = bad quality renders `---` |

Two architectural rules drive everything else:

- **`TelemetryIntake` is the universal entry point.** `MqttBridge` and `HmiTagSource` are both adapters. Future transports (OPC-UA, REST pollers) plug in at the same seam.
- **Generation counters, not timestamps, drive change detection.** No clock synchronization required, no per-tag timestamps stored anywhere.

### 1.2 Data Shape at Each Boundary

| Boundary                | Shape                                                                      | Notes |
|-------------------------|----------------------------------------------------------------------------|-------|
| MQTT wire (§2)          | `{ timestamp, status, tags: [{ tag_id, value }] }`                         | Module-level timestamp. `status: 'ONLINE' \| 'FAULT'`. Value may be number, boolean, string, or number array. |
| HmiTagSource emit (§1b) | Same `TelemetryMessage` shape; synthesized in-process                      | `timestamp = Date.now()`. Routed through `intake.ingest()` — identical downstream path. |
| LKV entry (§4)          | `{ value, generation }`                                                    | `value === null` ⇒ bad quality. Generation is a monotonic uint32. |
| DB queue entry (§5)     | `{ moduleTs, tags: [{ tagId, value }] }`                                   | Module-level timestamp propagated from the source message. Array-valued tags excluded. |
| WebSocket wire (§6)     | `{ type: 'SNAPSHOT' \| 'DELTA', values: { [tag_id]: value } }`             | Keys are stringified tag IDs. No timestamp, no generation, no quality enum. |
| React state (§7–§8)     | `LiveValue = { value }`                                                    | `value === null` ⇒ bad quality. Drives widget re-render. |

---

## 2. Stage 1a — MQTT Publish (Device / Simulator)

External producers publish JSON to `caro/{module_id}/telemetry` at ~10 Hz. QoS 0, retain false.

```jsonc
// Published to caro/{module_id}/telemetry
{
  "timestamp": 1712617200000,   // Date.now() at publish
  "status":    "ONLINE",        // "ONLINE" | "FAULT"
  "tags": [
    { "tag_id": 1, "value": 85.47 },
    { "tag_id": 2, "value": 12.03 },
    { "tag_id": 3, "value": true },
    { "tag_id": 4, "value": 150.0 }
  ]
}
```

**Key points.** `timestamp` is the only timestamp in the pipeline; it is module-level and used solely by the DB pipeline. `status: 'FAULT'` causes every tag in the module to be nulled in the LKV. `tags[]` contains every tag the module publishes on each tick — no metadata, no per-tag timestamp. Value types are `number`, `boolean`, `string`, or `number[]` (packed-bit arrays, e.g. watchdog).

### 2.1 Scope

`MqttBridge` is scoped to modules whose `tag_registry.module_type` is `'MQTT'`. The scoping is computed at startup in `index.ts`:

```ts
const mqttModuleIds = [...new Set(
  [...tagMap.values()]
    .filter(t => t.module_type === 'MQTT')
    .map(t => t.module_id),
)];
```

Tags belonging to `module_type='HMI'` never travel over MQTT; they are produced by `HmiTagSource` (§2b).

---

## 2b. Stage 1b — HMI-Internal Publish (HmiTagSource)

`HmiTagSource` is a second telemetry producer, entirely in-process, for tags whose `module_type='HMI'`. The HMI server itself knows values like `Tag_Count`, `Telemetry_CPU`, and per-module `Module_Info.*` arrays (Status, Packet_Rate, Byte_Rate, Watchdog, Module_Count). Rather than hard-coding special pathways, these tags flow through the same `TelemetryIntake.ingest()` as external telemetry.

### 2b.1 Proxy-based property access

Callers read and write tag values as named properties. The property name is derived from `tag_path` by stripping the module segment and joining the remainder with `_`:

```
tag_path = 'CARO_1.HMI.Module_Info.Data_Rate'   → hmiTags.Module_Info_Data_Rate
tag_path = 'CARO_1.HMI.Status.Active'           → hmiTags.Status_Active
```

### 2b.2 Periodic publish

Every `HMI_PUBLISH_INTERVAL_MS` (default 250 ms), `HmiTagSource` synthesizes a `TelemetryMessage` from its internal values map and calls `intake.ingest('HMI', message)`. An optional `onBeforePublish` hook fires first — used to push the current duty-cycle snapshot into `hmiTags.Telemetry_CPU` (§3.4).

The downstream path from this point is identical to MQTT telemetry: LKV, DB pipeline, WS, widgets.

---

## 3. Stage 2 — MQTT Bridge (transport only)

`MqttBridge` is a pure transport adapter. It does **not** write to the LKV, the DB pipeline, or the watchdog. Its entire job is: subscribe, parse, delegate.

```ts
// mqtt-bridge.ts — handleMessage()
private handleMessage(topic: string, payload: Buffer): void {
  const parts    = topic.split('/');
  const moduleId = parts[1];
  const channel  = parts[2];

  if (channel === 'telemetry') {
    this.dutyTracker.track(() => {
      let message: TelemetryMessage;
      try {
        message = JSON.parse(payload.toString()) as TelemetryMessage;
      } catch { return; }
      this.intake.ingest(moduleId, message);
    });
    return;
  }

  if (channel === 'cmd_ack') {
    /* routed to CommandPublisher via cmdAckHandler */
  }
}
```

The bridge also subscribes to `caro/+/cmd_ack` and routes those messages to a registered `CommandPublisher` — that path is covered in `hmi_functional_spec.md`, not here. Heartbeat publishes on `caro/{module_id}/beat` every `HEARTBEAT_INTERVAL_MS`.

Every call into `intake.ingest()` is wrapped in `dutyTracker.track()` so the time spent ingesting MQTT traffic is accounted for in the `Telemetry_CPU` figure surfaced to the UI.

---

## 4. Stage 3 — Telemetry Intake (universal ingestion)

`TelemetryIntake` is where all telemetry — MQTT, HMI-internal, and any future transport — converges. It owns LKV writes, FAULT handling, watchdog, per-module rate tracking, and DB-pipeline enqueue.

### 4.1 `ingest(moduleId, message)`

```ts
ingest(moduleId: string, message: TelemetryMessage): void {
  this.lastSeen.set(moduleId, Date.now());

  // Rate and status bookkeeping
  this.packetCount.set(moduleId, (this.packetCount.get(moduleId) ?? 0) + 1);
  this.packetsInWindow.set(moduleId, (this.packetsInWindow.get(moduleId) ?? 0) + 1);
  this.byteAccumulator.set(moduleId, (this.byteAccumulator.get(moduleId) ?? 0) + JSON.stringify(message).length);
  this.tagCountLast.set(moduleId, message.tags.length);
  this.moduleStatus.set(moduleId, message.status);

  // FAULT short-circuit
  if (message.status === 'FAULT') {
    for (const tagId of this.moduleTagIds.get(moduleId) ?? []) {
      this.lkv.set(tagId, null);
    }
    return;
  }

  // Per-tag LKV write + selective DB enqueue
  const changedTrendable: { tagId: number; value: number | boolean | string | null }[] = [];
  for (const { tag_id, value } of message.tags) {
    if (!this.tagMap.has(tag_id)) continue;                 // drop unknown tags
    const changed = this.lkv.set(tag_id, value);
    if (changed && this.trendableTagIds.has(tag_id) && !Array.isArray(value)) {
      changedTrendable.push({ tagId: tag_id, value });
    }
  }

  if (changedTrendable.length > 0) {
    this.dbPipeline.enqueue({ moduleTs: message.timestamp, tags: changedTrendable });
  }
}
```

**Notable behaviors.** Unknown tag IDs are silently dropped (old firmware tolerance). Only changed **and** trendable tags are enqueued for the DB. Array-valued tags are filtered out of the DB queue in depth (the resolved-tag validator already excludes them — this is a defense-in-depth guard).

### 4.2 Watchdog (two-state model)

There are **two watchdog sets**:

- `timedOutModules` — non-latching. Tracks the real-time stall state. Auto-clears when telemetry resumes.
- `watchdogLatched` — latching. Flips on when a module times out, stays on until an explicit `resetWatchdog(moduleId)` or `resetAllWatchdogs()` call.

```ts
watchdogTick(): void {
  this.dutyTracker.track(() => {
    const now = Date.now();
    for (const [moduleId, tagIds] of this.moduleTagIds) {
      const last = this.lastSeen.get(moduleId) ?? 0;
      const timedOut = now - last > this.watchdogTimeoutMs;

      if (timedOut) {
        if (!this.timedOutModules.has(moduleId)) {
          // Transition into stalled — null LKV and set status
          this.timedOutModules.add(moduleId);
          for (const tagId of tagIds) this.lkv.set(tagId, null);
          this.moduleStatus.set(moduleId, 'STALLED');
        }
        this.watchdogLatched.add(moduleId);    // latched — survives resumption
      } else {
        this.timedOutModules.delete(moduleId); // live — auto-clear
      }
    }
  });
}
```

The tick interval is `min(watchdogTimeoutMs, 500)` so detection never lags the timeout by more than ~500 ms. `resetWatchdog(moduleId)` is a no-op unless the module is currently live — prevents clearing a latched stall on a still-silent module.

### 4.3 Rate tracking and module stats

A second 1 Hz timer snapshots per-module packet and byte rates:

```ts
startRateTimer(): void {
  this.rateTimer = setInterval(() => {
    this.dutyTracker.track(() => {
      for (const moduleId of this.moduleTagIds.keys()) {
        this.lastRateSnapshot.set(moduleId, {
          packetsPerSec: this.packetsInWindow.get(moduleId) ?? 0,
          bytesPerSec:   this.byteAccumulator.get(moduleId) ?? 0,
        });
        this.packetsInWindow.set(moduleId, 0);
        this.byteAccumulator.set(moduleId, 0);
      }
    });
    this.lastDutyCycle = this.dutyTracker.snapshot(1000);
  }, 1000);
}
```

`getModuleStats()` returns these rates plus status and `tags_in_last_packet` for each module, surfaced to the UI via `Module_Info.*` tags published by `HmiTagSource`.

### 4.4 Duty-cycle accounting

Every callback that touches the hot path (`MqttBridge.handleMessage`, `TelemetryIntake.watchdogTick`, `TelemetryIntake.rateTimer`, `WsServer.tick`, `DbPipeline.flush`) is wrapped in `dutyTracker.track(fn)`. `DutyTracker.snapshot(intervalMs)` returns the busy time as a percentage and resets the accumulator. The 1 Hz rate timer snapshots the duty cycle and stores it; `HmiTagSource.onBeforePublish` reads it and writes it to `hmiTags.Telemetry_CPU`, closing the loop so the UI can display server load as just another tag.

---

## 5. Stage 4 — LKV Cache

The Last-Known-Value cache is the central data structure. An in-memory `Map<tag_id, LkvEntry>`.

```ts
// lkv.ts
export type LkvValue = number | boolean | string | number[] | boolean[] | string[] | null;

export interface LkvEntry {
  value:      LkvValue;
  generation: number;
}
```

### 5.1 `set()` — change detection is here

```ts
set(tagId: number, value: LkvValue): boolean {
  const existing = this.entries.get(tagId);
  if (existing !== undefined && valuesEqual(existing.value, value)) {
    return false;                          // same value → no generation bump
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

`valuesEqual` does strict equality for scalars and element-wise comparison for arrays. If the device sends `85.47` twice in a row, the second `set()` returns `false` and `generation` is unchanged — the WS server will not emit a DELTA for that tag.

### 5.2 Null transitions

If `value` was `85.47` and the watchdog writes `null`, the generation bumps. The WS server sends `DELTA { "1": null }`, and the widget renders `---`. When the device comes back with `85.47`, generation bumps again and the widget restores the number.

### 5.3 No timestamps

The LKV stores no timestamps. The only temporal concept is generation order. At 10 Hz with a uint32 ceiling, wrap time is ~13 years per tag; in practice non-existent.

---

## 6. Stage 5 — DB Pipeline (placeholder)

`DbPipeline` is a push-based queue. Currently a placeholder — `flush()` drains the queue without writing. The real implementation will batch into TimescaleDB.

```ts
export interface DbWriteEntry {
  moduleTs: number;                                                      // from source message
  tags:     { tagId: number; value: number | boolean | string | null }[];
}
```

`moduleTs` is the **source-message** timestamp, not the HMI server's receipt time. Every tag in a single enqueue shares the same `moduleTs`. The flush timer runs at `TIMESCALE_DB_TICK_MS` (default 500 ms) in `db-pipeline.ts`:

```ts
const dbFlushTimer = setInterval(
  () => dutyTracker.track(() => dbPipeline.flush()),
  config.dbTickMs
);
```

The DB pipeline is independent of the WS pipeline. They share the LKV but run on different triggers: DB is push-enqueue-by-TelemetryIntake; WS is pull-by-tick.

---

## 7. Stage 6 — WebSocket Server

Pull-based at `WS_TICK_MS` (default 125 ms, 8 Hz). Per-client generation tracking. `SUBSCRIBE → SNAPSHOT → DELTA`.

### 7.1 Client state

```ts
interface WsClient {
  ws:            WebSocket;
  subscriptions: Set<number>;              // tag_ids this client asked for
  lastSentGen:   Map<number, number>;      // last generation delivered per tag_id
}
```

### 7.2 SUBSCRIBE handling

On SUBSCRIBE, the server immediately SNAPSHOTs **only the newly subscribed** tag IDs:

```ts
case 'SUBSCRIBE': {
  const newTagIds = msg.tagIds.filter(id => !client.subscriptions.has(id));
  for (const id of msg.tagIds) client.subscriptions.add(id);

  const values: Record<string, LkvValue> = {};
  for (const id of newTagIds) {
    values[String(id)] = this.lkv.getValue(id);
    client.lastSentGen.set(id, this.lkv.getGeneration(id));
  }
  this.send(client, { type: 'SNAPSHOT', values });
  break;
}
```

After the SNAPSHOT, `lastSentGen` is pinned to the current generation — subsequent ticks only deliver changes after the snapshot. Re-subscribes for tags already in `subscriptions` produce no new SNAPSHOT entry (idempotent).

### 7.3 The tick — DELTA generation

```ts
private tick(): void {
  this.dutyTracker.track(() => {
    for (const client of this.clients) {
      if (client.ws.readyState !== WebSocket.OPEN) continue;

      const delta: Record<string, LkvValue> = {};
      for (const tagId of client.subscriptions) {
        const currentGen = this.lkv.getGeneration(tagId);
        const lastGen    = client.lastSentGen.get(tagId) ?? 0;
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
// On subscribe
{ "type": "SNAPSHOT", "values": { "1": 85.47, "2": 12.03, "3": true, "4": null } }
// On tick, when at least one subscribed tag changed
{ "type": "DELTA",    "values": { "1": 86.12 } }
```

Keys are stringified tag IDs. Values are raw (`number | boolean | string | null`). No timestamp, no quality enum, no generation on the wire.

### 7.5 Why generation counters?

| Approach             | Problem                                                                                                      | Generation advantage |
|----------------------|--------------------------------------------------------------------------------------------------------------|----------------------|
| Dirty-flag set       | One flag per tag, not per client. If client A reads before client B, B misses the change.                    | Per-client `lastSentGen`; nobody can miss updates. |
| Timestamp comparison | Requires synchronized clocks. Timestamp must be stored per tag.                                              | No clock dependency. Generation is monotonic and local. |
| Broadcast all        | Every client gets every tag on every tick. Wastes bandwidth.                                                 | Tailored per-client deltas. Only changed + subscribed tags sent. |

---

## 8. Stage 7 — Client Context

The client wraps the React tree in `HmiContextProvider` from `@caro/hmi-context`. The provider owns the WebSocket, the tag map, the tag-path index, the live-value map, and per-tag subscriber callbacks.

### 8.1 Split context

The provider exposes **two** contexts to avoid subscription churn on stats ticks:

| Context             | Contents                                                         | Update rate |
|---------------------|------------------------------------------------------------------|-------------|
| `HmiDataContext`    | `tagMap`, `tagPathIndex`, `getLiveValue`, `subscribeLiveValue`, `writeTag` | Stable — changes only when tag map reloads |
| `HmiStatsContext`   | `wsStats` (`connected`, `latencyMs`, `messagesPerSec`, `bytesPerSec`, `subscribedCount`) | 1 Hz |

`useLiveValue` depends only on `HmiDataContext`, so the 1 Hz `wsStats` refresh never re-runs subscription effects.

### 8.2 Initialization sequence

1. Fetch the tag map from `GET /api/v1/tags`. Populate `tagMap: Map<number, TagDef>`.
2. Build `tagPathIndex` from the tag map (see §8.3).
3. Open the WebSocket.
4. Render `null` until step 1 completes; children do not mount against an empty map.

### 8.3 TagPathIndex — O(1) asset-path resolution

Historically `useResolveAssetPath` iterated the full tag map (1.5k+ entries) and re-split `tag.tag_path` on every widget mount. For a tag-dense page (e.g. Power with ~100 widgets × 9 children each), this dominated page-navigation INP.

The resolver is now pre-built **once** when the tag map loads. The index inserts every contiguous segment subsequence of every `tag_path` as a key:

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

`useResolveAssetPath(assetPath)` and `useTagGroup(basePath, children, widgetName)` both delegate to `ctx.tagPathIndex.resolve(path)`. Semantics are unchanged: contiguous-segment match, ambiguity detection and error handling are the consumers' responsibility.

### 8.4 WebSocket message handling

```ts
// HmiContextProvider.tsx — ws.onmessage
if (msg.type === 'SNAPSHOT' || msg.type === 'DELTA') {
  for (const [key, rawValue] of Object.entries(msg.values ?? {})) {
    const tagId = Number(key);
    const lv: LiveValue = { value: rawValue as number | boolean | string | null };
    valuesRef.current.set(tagId, lv);
    subscribersRef.current.get(tagId)?.forEach(cb => cb(lv));
  }
}
```

- `valuesRef` — `Map<tag_id, LiveValue>`. Client-side mirror of the LKV for subscribed tags. Only `{ value }`; no quality, no timestamp, no module_id.
- `subscribersRef` — `Map<tag_id, Set<callback>>`. Each `useLiveValue` call registers one callback (the `useState` setter) and removes it on unmount.

### 8.5 Subscription management — level-triggered reconciler

The provider manages SUBSCRIBE / UNSUBSCRIBE messages via a **level-triggered reconciler**. Two sets govern state:

- `desiredRef: Set<number>` — tag IDs at least one hook currently wants. Derived from `subscribersRef`.
- `serverRef: Set<number>` — tag IDs the client has told the server about (what we've emitted on the wire, not yet retracted).

On every `subscribeLiveValue` / unsubscribe call, the provider mutates `desiredRef` and schedules a microtask flush. The flush is the only code that talks to the wire:

```ts
function flush() {
  const ws = wsRef.current;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  const toSub:   number[] = [];  // in desiredRef but not serverRef
  const toUnsub: number[] = [];  // in serverRef  but not desiredRef
  for (const t of desiredRef.current) if (!serverRef.current.has(t)) toSub.push(t);
  for (const t of serverRef.current)  if (!desiredRef.current.has(t)) toUnsub.push(t);

  if (toSub.length)   { ws.send(JSON.stringify({ type: 'SUBSCRIBE',   tagIds: toSub   })); for (const t of toSub)   serverRef.current.add(t); }
  if (toUnsub.length) { ws.send(JSON.stringify({ type: 'UNSUBSCRIBE', tagIds: toUnsub })); for (const t of toUnsub) serverRef.current.delete(t); }
}
```

**Guarantees.** Any ordering of sub / unsub calls within a single microtask collapses to the final `desiredRef` state. Same-tick subscribe + unsubscribe of the same tag ID produces zero wire messages. On reconnect, `onopen` clears `serverRef` and schedules a flush; the diff naturally produces a single `SUBSCRIBE` containing everything currently desired.

### 8.6 `useLiveValue` — seed via initializer, sync via subscribe

```ts
// packages/hmi-context/src/hooks/useLiveValue.ts
export function useLiveValue(tagId: number): LiveValue {
  const ctx = useHmiContext();
  const [liveValue, setLiveValue] = useState<LiveValue>(() => ctx.getLiveValue(tagId));

  useEffect(() => {
    const unsubscribe = ctx.subscribeLiveValue(tagId, setLiveValue);
    return unsubscribe;
  }, [tagId, ctx]);

  return liveValue;
}
```

No redundant `setLiveValue` on mount — the `useState` initializer seeds the value, and `subscribeLiveValue` invokes the callback synchronously with the current `valuesRef` value at the moment of subscribe, reconciling any drift between render and effect. This matters on tag-dense pages: avoiding ~N extra state updates per page mount measurably reduces page-navigation INP.

---

## 9. Stage 8 — Widget Render

Widgets are the final destination. They turn a `LiveValue` into pixels. The example here is `NumericMon`; composite widgets (e.g. `AnalogIn`) follow the same pattern via `useTagGroup`.

### 9.1 Path resolution + live subscription

```ts
// NumericMon.tsx (condensed)
export function NumericMon({ assetPath, label }: NumericMonProps) {
  const tag = useSingleTag(assetPath, 'NumericMon');   // → tagPathIndex.resolve(), exactly one match
  const lv  = useLiveValue(tag.tag_id);                // subscribes, gets LiveValue
  const fmt = resolveFormat(tag);                      // compiled once at mount
  const badQuality = lv.value === null;

  return (
    <div className="inline-flex flex-col p-2 rounded border bg-white min-w-[80px]">
      <WidgetLabel label={resolveLabel(assetPath, label)} unit={tag.unit} />
      {badQuality
        ? <div className="text-red-600 font-mono text-sm">---</div>
        : <div className="font-mono text-sm text-gray-900">
            {fmt(lv.value as number)}{tag.unit && <span className="text-gray-500 text-xs ml-1">{tag.unit}</span>}
          </div>}
    </div>
  );
}
```

### 9.2 Rendering rules

| `lv.value`          | Render |
|---------------------|--------|
| `null`              | `---` with red tint and red border. Bad quality. |
| number              | `fmt(value)` using the compiled pattern from `tag.meta.format`. Default pattern `#.##` (two decimals). |
| boolean / string    | Handled by `BooleanMon` / other widgets, not `NumericMon`. |

### 9.3 Meta-field resolution

`tag.unit`, `tag.eng_min`, `tag.eng_max`, and the format pattern are resolved **server-side** during tag-map construction by walking `tag.meta` from root (`meta[0]`) to leaf (`meta[last]`) and taking the first non-null value for each field. The client receives the resolved fields already on `TagDef` and re-walks `meta` only for `format` (see `resolveFormat` / `compileFormat` in `packages/widgets/src/shared/utils.ts`).

---

## 10. Threading and Safety Model

The HMI server runs on a single Node.js event loop. No worker threads, no shared memory, no locks.

### 10.1 Why no locks?

In a multi-threaded design the LKV would need a read-write lock: MQTT writes, WS reads. In Node.js these never execute concurrently.

- **MQTT message callback** — runs synchronously on the event loop. Writes via `lkv.set()`. Cannot be interrupted.
- **HmiTagSource publish timer** — same. Writes to LKV via `intake.ingest()`.
- **Watchdog tick** — same. Writes nulls to LKV.
- **Rate-snapshot tick** — same. Reads counters, resets them.
- **WS tick** — same. Reads `lkv.getGeneration()` and `lkv.getValue()`.
- **DB flush timer** — same. Drains `dbPipeline.queue`.

Each callback runs to completion before the next one starts. That's the Node.js concurrency guarantee: no preemption within the synchronous phase of a callback.

### 10.2 Async boundaries

The only async operations are `ws.send()` / `mqtt.publish()` (both buffer internally; calls return synchronously) and the initial `loadTagMap()` at startup (happens before any telemetry is processed). No async operations sit between an LKV read and a `ws.send()` in `WsServer.tick()`.

---

## 11. Configuration Reference

| Env var                   | Default                | Used by               | Effect |
|---------------------------|------------------------|-----------------------|--------|
| `MQTT_URL`                | `mqtt://localhost:1883`| `mqtt-bridge.ts`      | Mosquitto address. Absent broker → server runs degraded (REST + WS serve LKV without live telemetry). |
| `WS_TICK_MS`              | `125`                  | `ws-server.ts`        | Delta tick interval. Lower = more responsive, higher CPU. |
| `TIMESCALE_DB_TICK_MS`    | `500`                  | `db-pipeline.ts`      | DB-pipeline flush interval. |
| `WATCHDOG_TIMEOUT_MS`     | `1000`                 | `telemetry-intake.ts` | Time without telemetry before nulling the module's LKV entries. |
| `HEARTBEAT_INTERVAL_MS`   | `1000`                 | `mqtt-bridge.ts`      | Heartbeat publish frequency on `caro/{module_id}/beat`. |
| `HMI_PUBLISH_INTERVAL_MS` | `250`                  | `hmi-tag-source.ts`   | HmiTagSource emit interval; also the cadence at which `Telemetry_CPU` is refreshed. |
| `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DATABASE` | — | `@caro/db` | PostgreSQL connection for `runMigrations()` and tag-map load. |

---

## 12. Related Documents

| Document                                 | Path                                   |
|------------------------------------------|----------------------------------------|
| HMI App Anchor                           | `apps/caro-hmi/CLAUDE.md`              |
| HMI Functional Spec                      | `Docs/hmi_functional_spec.md`          |
| HMI Widget Spec                          | `Docs/hmi_widget_spec.md`              |
| HMI API Spec                             | `Docs/hmi_API_spec.md`                 |
| MQTT Spec                                | `Docs/CARO_MQTT_Spec.md`               |
| DB Spec                                  | `Docs/CARO_DB_Spec.md`                 |
| Platform Handoff                         | `Docs/platform_handoff.md`             |
