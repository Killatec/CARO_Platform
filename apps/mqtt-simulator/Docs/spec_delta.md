# MQTT Simulator — Spec Delta

**Purpose:** Record of where implementation diverges from spec docs.
Read once at session start. Update only when something diverges.

---

## Known behavioral divergences

### All tags published on every tick — setpoint on-change logic removed (2026-04-03)
- **Spec assumption:** Bootstrap v1.13 §8 says setpoint tags publish only when their value changes (publish-on-change); monitor tags always publish
- **Reality:** `buildMessage()` now publishes all tags unconditionally on every tick
- **Decision:** Simplifies dev use and ensures consumers always receive the current setpoint value; on-change logic commented out in source for reference

### POST /api/v1/simulator/start — async connect (2026-04-03)
- **Spec assumption:** response reflects post-connect state
- **Reality:** MQTT `connect` event fires asynchronously; `/start` responds with `running: false` then flips to `true` within ~100ms
- **Decision:** intentional, 202 signals "accepted not yet running" — correct for a dev tool

### RESET command is a no-op (2026-04-03)
- **Spec assumption:** RESET resets all tag values to defaults
- **Reality:** RESET is acknowledged and ACKed, but tag values are not reset in memory
- **Decision:** intentional, RESET not needed for current dev tool use case

---

## Not yet implemented

### Duplicate command_id deduplication (2026-04-03)
- Spec §6.2 requires deduplication of `command_id` to prevent replay attacks
- Not implemented — omitted for dev tool simplicity
- Risk: low in dev environment, must implement before production use

### Protobuf encoding (2026-04-03)
- Bootstrap §10 defines Protobuf as default encoding
- Actual: JSON only, always — no protobufjs dependency
- Must implement before production HMI integration

### REST API endpoints (2026-04-03)
- Bootstrap §11 defines 10+ endpoints; only 3 are implemented: POST /start, POST /stop, GET /status
- Not implemented: /logs, /telemetry/start/:module_id, /telemetry/stop/:module_id,
  /override, /override/clear/:tag_id, /telemetry/encoding, /reject/enable, /reject/disable,
  /tags, /tags/:module_id
- Implement as needed when HMI or test tooling requires them

### Per-module telemetry start/stop (2026-04-03)
- Bootstrap §8: modules tracked in Set, individual modules stoppable
- Actual: all modules always publish on every tick
- Deferred — single module (RF1) in current DB makes this moot

### Env vars defined in Bootstrap but not read (2026-04-03)
- Bootstrap defines: CMD_ACK_DELAY_MS, TELEMETRY_ENCODING, REJECT_ALL_WRITES,
  LOG_BUFFER_SIZE, CONTROL_PORT
- None are read by the actual implementation
- ACK sent immediately (no delay), encoding always JSON, reject/log features not implemented
