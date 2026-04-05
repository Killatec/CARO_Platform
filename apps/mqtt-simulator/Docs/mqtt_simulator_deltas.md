# MQTT Simulator — Spec Delta

**Purpose:** Record of where implementation diverges from spec docs and deferred implementation items.
Read once at session start. Update only when something diverges.

---

_(empty — no pending spec updates)_

---

## Deferred implementation

The following items are specified in the Bootstrap or MQTT Spec but not yet implemented.
Implement as needed when HMI or test tooling requires them.

### Duplicate command_id deduplication (2026-04-03)
- Spec §6.2 requires deduplication of `command_id` to prevent replay attacks
- Not implemented — omitted for dev tool simplicity
- Risk: low in dev environment, must implement before production use

### REST API endpoints (2026-04-03)
- Not implemented: /override, /override/clear/:tag_id,
  /reject/enable, /reject/disable, /tags, /tags/:module_id
- Implement as needed when HMI or test tooling requires them

---

## Deferred — env vars

### Env vars defined in Bootstrap but not read (2026-04-03)
- Bootstrap defines: CMD_ACK_DELAY_MS, TELEMETRY_ENCODING, REJECT_ALL_WRITES, CONTROL_PORT
- None are read by the actual implementation
- ACK sent immediately (no delay), encoding is per-module at runtime, reject/log features not implemented
