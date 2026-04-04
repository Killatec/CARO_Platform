# MQTT Simulator — Spec Delta

**Purpose:** Record of where implementation diverges from spec docs and deferred implementation items.
Read once at session start. Update only when something diverges.

---

_(empty — no pending spec updates)_

---

## Deferred implementation

The following items are specified in the Bootstrap or MQTT Spec but not yet implemented.
Implement as needed when HMI or test tooling requires them.

### Protobuf encoding (2026-04-03)
- Bootstrap §10 defines Protobuf as the default encoding for outbound telemetry
- Actual: JSON only, always — no protobufjs dependency
- Must implement before production HMI integration

### Duplicate command_id deduplication (2026-04-03)
- Spec §6.2 requires deduplication of `command_id` to prevent replay attacks
- Not implemented — omitted for dev tool simplicity
- Risk: low in dev environment, must implement before production use

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
