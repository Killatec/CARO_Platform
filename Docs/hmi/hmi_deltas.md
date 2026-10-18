# CARO_HMI — Spec Deltas

**Purpose:** One-line entries for spec divergences during implementation. Propagate to target docs at session end, then delete entries.

---

**Last cleared:** 2026-10-18. Propagated entries live in their target docs; earlier propagation notes are in git history.

- 2026-10-18 — New `server/src/mqtt-payloads.ts` (`parseTelemetry`, `parseCmdAck`) used by `MqttBridge`; heartbeat timer replaced per connect and stopped on `close`. `apps/caro-hmi/CLAUDE.md` MQTT Bridge row still lists both as known gaps, and its server test baseline is 316 (now 345 + 22 skipped).
