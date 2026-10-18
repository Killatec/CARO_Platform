# CARO_Platform — Platform Spec Delta

**Purpose:** Cross-app and platform-wide divergences between implementation and spec docs only.
App-level divergences live in each app's own spec delta file.
Read once at session start alongside `Docs/README.md`.

---

**Last cleared:** 2026-10-18. Propagated entries live in their target docs; earlier propagation notes are in git history.

- 2026-10-18 — `MqttBridge` validates payload shape (`mqtt-payloads.ts`) before handing them on: telemetry is dropped unless `timestamp` is a finite number, `status` a string and `tags` an array, and entries with a bad `tag_id` (not an integer 0…2³²−1) or value (not number/boolean/string/number[]/null) are skipped; a CMD_ACK is dropped unless `command_id` is a string, `error` (if any) a string and every `results` entry `{ integer tag_id, boolean accepted, string rejection_code? }` — one bad result drops the whole ACK. Drops are logged at most once a minute per module and reason. `CARO_Telemetry_Path_Reference.md` §3.2 and §12 (row "Valid JSON without a `tags` array throws"), `CARO_MQTT_Spec.md` §5 (backend handling of fields) and the intro of `platform_todo.md` "MQTT interface" still describe the old behaviour.
- 2026-10-18 — Heartbeat timer fixed: replaced (not stacked) on each broker connect and stopped on disconnect, so one beat per interval and none queued while offline. `CARO_Telemetry_Path_Reference.md` §3.1 and §12 (row "Heartbeat timer re-created on every reconnect") and the `platform_todo.md` "MQTT interface" intro still list it as a gap.
