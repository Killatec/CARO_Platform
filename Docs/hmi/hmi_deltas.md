# CARO_HMI — Spec Deltas

**Purpose:** One-line entries for spec divergences during implementation. Propagate to target docs at session end, then delete entries.

---

**Last cleared:** 2026-10-17. Propagated entries live in their target docs; earlier propagation notes are in git history.

- 2026-10-18 — `CmdController` writes `commanded_setpoints` (accepted ACK → `accepted`, timeout → `timeout`) alongside `pending_setpoint_values`, and `restorePendingSetpoints()` now reads `commanded_setpoints` (non-null rows only); `apps/caro-hmi/CLAUDE.md` Command Publisher row (also its wrong epsilon claim), `hmi_API_spec.md` §5 and `hmi_functional_spec.md` §8.5/§8.10 still describe `pending_setpoint_values` as the re-delivery source.
- 2026-10-18 — New `server/src/tag-list.ts` `buildTagList(tagMap, moduleId)` → `{ tags: [{ tag_id, tag_name (module-relative), is_setpoint }] by tag_id, skipped }` from the startup tag map; not yet called (handshake controller pending). Server `package.json` now declares `@caro/tag-registry-shared` (was imported via hoisting). Not in `apps/caro-hmi/CLAUDE.md` Server Architecture.
- 2026-10-18 — New `server/src/handshake-controller.ts` (wired in `index.ts`): answers `HANDSHAKE_REQUEST` from any MQTT-type registry module with a TAG_LIST (`buildTagList`), identity unchecked (`verifyModuleIdentity` placeholder); on a CONFIRM answering a TAG_LIST, logs missing/unknown names, pushes every Set (`CmdController.getModuleSetpoints` → `pushSetpoints`, nulls included, ACK tracked; ACK upgrades only `timeout` rows to `accepted`, keeping `set_by`), then REQUEST_SNAPSHOT; push timeout → REHANDSHAKE, max 3 in a row. `MqttBridge` subscribes `caro/+/handshake_module`, publishes `caro/{id}/handshake_backend` (QoS 1), and sends REHANDSHAKE before REQUEST_SNAPSHOT on every connect. State in memory, results logged only (no HMI display). Not in `apps/caro-hmi/CLAUDE.md`, `hmi_functional_spec.md` §7/§9 or `CARO_Telemetry_Path_Reference.md` §3.
