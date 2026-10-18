# CARO_Platform — Open TODOs

**Purpose:** Implementation backlog only — features fully specified but not yet built. Design questions that are unresolved live in the relevant spec's Open Questions section. Remove items when complete.

**Updated:** 2026-10-18

---

## HMI

- [ ] Add NULL `prev` rate monitoring per `DB_Config_Usage_And_Perf.md` §8.1 — daily sample at 1-min bound; non-zero rate signals writer-cadence drift
- [ ] **Guard against bad module telemetry timestamps.** `TelemetryIntake` passes `message.timestamp` straight to `DbPipeline` (historian rows) and the trend-delta listener, with no check. A module that publishes before its UTC clock is synced (`timestamp` 0, or wildly off) writes rows at 1970 or in the future and puts points at that time on live trends. Before enqueueing, reject (or substitute server time for) any timestamp that is ≤ 0 or more than a configurable tolerance from server `Date.now()`. Count and rate-limit-log these per module. Size the default tolerance generously against the ICD's ±2 s sync requirement (`CARO_MQTT_Spec.md` §2.2), e.g. 60 s. LKV updates should still apply, so the live value stays current. Raised by RF_Control G9 (module clock roles, 2026-10-10).

### MQTT interface — specified, not built

Status detail: `CARO_MQTT_Spec.md` §1.1. Known defects in the built path (heartbeat timer duplicated per reconnect, payload without `tags` throws, Protobuf dropped silently, tag ownership unchecked) are listed in `CARO_Telemetry_Path_Reference.md` §12.

- [ ] **Protobuf telemetry decoding** (`CARO_MQTT_Spec.md` §4, §5.2). `mqtt-bridge.ts` only `JSON.parse`s telemetry. Needs a decision first on how the backend tells the encodings apart (spec Open Questions).
- [ ] **Broker TLS, client certificates, ACLs, anonymous rejection** (`CARO_MQTT_Spec.md` §2). Backend and simulator connect anonymously over plain `mqtt://`.
- [ ] **Module identity verification and commissioning** (`CARO_MQTT_Spec.md` §7.3, `hmi_functional_spec.md` §9, `hmi_API_spec.md` §9–§10). The handshake itself is built (§7.5); `verifyModuleIdentity()` in `apps/caro-hmi/server/src/handshake-controller.ts` is a placeholder that accepts every module. Compare the HANDSHAKE_REQUEST's `fw_hash` and `tag_registry_template` against `commissioned_modules` before answering, and build the Administrator validation flow. Depends on the `commissioned_modules` migration below, with `expected_tag_config_hash` replaced by the expected template (`CARO_DB_Spec.md` §5.1 note). `tag_registry_rev` verification waits on an Open Question in `CARO_MQTT_Spec.md`.
- [ ] **Show handshake results in the HMI.** `HandshakeController` only logs each CONFIRM's `missing_ids` / `unknown_tags` / `truncated`; the HMI should show them per module, with which Sets are unpopulated (null in `commanded_setpoints`) and the module's readiness (`Module.Ready`, RF_Control migration D23 — RF1 has no such tag yet). Source: the module-side contract, `CARO_MQTT_Interface/Docs/BACKEND_HANDSHAKE_PROMPT.md` B5.

### New `@caro/widgets` components — needed for Narya1's RF1 page

Surfaced auditing the reference "RF Control" / "RF Phase" / "RF SpecA" screenshots against the Narya1 registry (`Narya1_registry.csv`). `Rf1PhaseXYBox`, `Rf1SpecABox`, and `Rf1DisplayBox` in `apps/caro-hmi/client/src/hmi-definitions/Narya1/boxes/` render the underlying tags as plain numeric fields in the meantime.

- [ ] **Phase X-Y scatter widget.** Plots two live numeric tags (`RF1.Phase.Phase_XY.{X,Y}`) as a point/trail on an X-Y plane. No existing widget covers this — `SpectrumChart` is a single-series line chart against bin index, not a two-tag scatter plot.
- [ ] **Frequency-mapped spectrum chart.** `SpectrumChart` is bin-index-only by design (`axes: [{ label: 'Bin', ... }]`) — the reference UI plots an MHz X-axis derived from `Center_Freq`/`LO`/`Bin_Size`. Needs either a new widget or an extension to `SpectrumChart`'s axis contract.
- [ ] **Label-lookup numeric widget (needs a decision first).** `RF1.Display.{An_Display_1/2,Dig_Display_1/2}` are plain Int16 setpoints in the registry, but the reference UI shows resolved text labels (e.g. "Phase_Set") instead of the raw number. Unclear whether that's a firmware-side convention worth replicating or a display artifact — resolve before building.
- [ ] **String-value display widget.** `NumericMon` assumes a numeric value (`value.toFixed()` internally) and throws on a string. `RF1.Module_Info.IP` and `.Status` are `String`-type registry tags with no widget able to render them — `Rf1ModuleInfoBox` omits both. Needs a `StringMon`-equivalent (read-only, no formatting).
- [ ] **RF1 module commands (Close_App, Reboot) — needs the cmd_str contract first.** The reference "RF Control" page has Close_App/Reboot buttons wired the same way `PoleBox`'s `CommandButton` pattern (`useCommandSender` + `@caro/ui` `Button`) already works for MQTT modules. Not a widget gap — `Button`/`useCommandSender` both exist — but RF1's actual `cmd_str` values for these two commands aren't confirmed anywhere in the registry export or specs, so `RF1Page` doesn't render them yet. Confirm the accepted `cmd_str` strings (device firmware or MQTT spec), then wire two `CommandButton`s in `Rf1SourceBox` or a small new "RF1 App" box.

### Trend Viewer — Deferred / Possible Future Improvements

- [ ] **Dead-tag detection / "stale tag" UI indicator.** With the LOCF cutoff query removed (was paying 814ms of planning time per CAG request at production scale), LOCF carries the last known value forward through all empty trailing buckets — a recently-stopped tag shows a flat line extending to the right edge of the requested window. See `hmi_trend_viewer_handoff.md` "Dead-tag detection" section for context and three replacement options under consideration: (1) per-tag freshness lookup alongside tile response; (2) watchdog contract guarantee (continuous NULL writes while telemetry silent); (3) per-tag freshness tag (`Trend_Info`-style). Likely combination of (2) + (1). Deferred until a user-facing complaint surfaces.

### Trend Viewer — Operational/observability watchlist

The Trend Viewer API and its test coverage are complete; these are operational monitoring items, not contract-level work.

- [ ] **Pool sizing watchlist (spec §15):** Monitor `@caro/db` Timescale pool utilization during multi-operator perf evaluation. Current default `max = 10` has not surfaced as a bottleneck in empirical testing — perf-page testing at `tag_count=24` (12 concurrent requests/cell) showed shared DB resources, not pool capacity, as the latency driver. Bump toward 20–30 only if pool exhaustion is observed in real multi-operator load. One-line config change in `packages/db/timescale/pool.ts`; sizing methodology in `Docs/db/DB_Config_Usage_And_Perf.md §10.5`.
- [ ] **Flaky integration tests under cumulative DB load (surfaced 2026-05-17 audit pass).** Two integration tests began intermittently failing with hook timeouts during the audit remediation: (1) `getWatermarkMs — direct catalog query > tag_samples_10min_cagg: returns finite ms timestamp within expected range` (10s hook exceeded by ~44s), and (2) `getTrendTile — integration: 10s CAG branch > dispatches to source="10s_cagg" for the 8h window` (10s hook timeout). Both look like cumulative-DB-load symptoms — test-DB chunk count and shared catalog overhead growing across runs, not real defects. Same family as the unbounded-scan slowness in `getTrendExtent` (optimized 2026-05-17 via `ORDER BY ts ASC/DESC LIMIT 1` — MergeAppend short-circuits at first row, ~10-100× faster than the prior full-table `MIN/MAX`). Worth a focused operational pass: audit other unbounded scans, consider per-test chunk-truncate or sandbox-isolation strategies for the integration suite.

### Cross-cutting / platform

- [ ] **Re-evaluate error management platform-wide.** Current pattern across HMI routes (`tags.ts`, `trends.ts`, `reset.ts`) is bare-string error codes assigned via `err.code = 'X'`; `@caro/db` does the same in `codeError(...)` throws; `CaroError` (`@caro/server/errorHandler.ts`) carries them through to the platform envelope. The pattern is simple but has real shortcomings: no compile-time typo protection (`'INVALID_RAGNE'` compiles), no discoverability (must grep to enumerate all codes), no shared types for client-side consumers, and per-route hand-maintained HTTP-status maps (e.g., `routes/trends.ts:8-13`) that drift silently from the throwing module's actual code surface. Three improvements worth considering, in increasing scope: per-domain typed code constants (cheapest — each module exports its codes as `as const` maps); shared `throw*` helpers in `@caro/server` (reduce per-throw-site boilerplate); shared client-side error response types. The platform-wide cost is moderate (~week of refactor across HMI server + `@caro/db` + client error handling). Surfaced from `hmi_trend_viewer` audit B3#5 (2026-MM-DD).
- [ ] Create HMI database migrations for the remaining HMI tables: `users`, `sessions`, `commissioned_modules`, `operation_modes`, `mode_revisions`, `setpoint_values`, `system_settings`, `audit_log`. (`pending_setpoint_values` done — migration 016; `commanded_setpoints` — migration 018.)
- [ ] `DbPipeline`: remove legacy `flush()` / `queueSize` public aliases (currently referenced in `telemetry-intake.test.ts`; rename or internalize in a dedicated cleanup pass)
- [ ] User management endpoints — no user CRUD endpoints exist yet
- [ ] Dashboard config schema and `DashboardRenderer` component

---

## Tag Registry

- [ ] `EMPTY_BRANCH` validation code declared in `shared/constants.ts` but never emitted — implement or remove
- [ ] `applied_by` hardcoded to `'dev'` — no authentication system; depends on HMI auth being built first

### Tag Defs export — surface shape problems as validation warnings

The Generate Tag Defs export (spec §12.1) is consumed by a generator that emits a C++ struct, but the template editor's validation does not flag names that will break it. Today they surface only as a 422 when the export is generated, or not at all. Add **warnings** (not errors — the registry itself is valid) to the template/registry validation shown in the UI, scoped to MQTT module templates:

- [ ] **Leaf-and-group names.** Warn when a module-relative `tag_name` is also the parent of other names (case-insensitive) — the condition `validateTagDefs` reports as `TAG_NAME_LEAF_AND_GROUP`. Typical cause: a tag with `In_Tag_Name: false` takes its parent's name, as `Scan.Enable` does. That puts `Beam_Control` at `Scanning` and `Scanning.X`, which currently blocks the Tag Defs export for `CARO_1`, the system template that reaches `Beam_Control`.
- [ ] **Non-C-identifier segments.** Warn when any segment of a module-relative `tag_name` is not a valid C/C++ identifier: not matching `^[A-Za-z_][A-Za-z0-9_]*$`, or a C++ reserved word. `asset_name` validation today only rejects empty names, dots and over-length names, so spaces, hyphens and a leading digit all pass. Decide whether the export should also refuse these, or leave sanitising to the generator.

---

## MQTT Simulator

- [ ] RESET command — `CMD_ACK` is published but tag values are not reset to defaults
- [ ] REST override feature — pin a tag's simulated value from the REST API. Not started: there is no endpoint and no `overridden` field in the simulator's tag or module status shapes.
- [ ] **Module side of the handshake** (`CARO_MQTT_Spec.md` §7). Every MQTT module is now expected to handshake, and the HMI sends Sets and REQUEST_SNAPSHOT only after a bind, so a simulated module gets no Set push after an HMI restart. Per simulated module: subscribe `caro/{module_id}/handshake_backend`; publish HANDSHAKE_REQUEST (`module_id`, `instance_id`, `ip`, `fw_hash`, `tag_registry_template`, `tag_registry_rev`) about once a second while unbound, after a reconnect, on REHANDSHAKE, and when `/beat` stops; bind tag_ids from the TAG_LIST by module-relative `tag_name` and answer with a CONFIRM (`missing_ids`, `unknown_tags`); publish no telemetry while unbound; keep the binding across a reconnect until the next TAG_LIST. Reference implementation: `CARO_MQTT_Interface` (`src/caro.c`, `tests/integration/backend_harness.py`).

---

## MQTT Devices

- [ ] Implement deadband before publishing COV tag changes in device firmware to reduce historian churn and bus traffic.

---

## Platform / Packages

- [ ] `packages/server` has no automated tests
