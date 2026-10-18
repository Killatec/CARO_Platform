# MQTT Simulator — Spec Delta

**Purpose:** Divergences between MQTT Simulator implementation and its spec documents.
Read once at session start. Add entries when implementation diverges from spec.

---

**Last cleared:** 2026-10-17. `i32` data type propagated → `mqtt_simulator_bootstrap.md` §5 value-initialization tables (new `i16`/`i32` rows, `advanceIntValue` + `I16_RANGE`/`I32_RANGE`) and §8 protobuf type map.

---

**Last cleared:** 2026-09-20. `MQTT_BROKER_URL`/`MQTT_CLIENT_ID`/`LOG_BUFFER_SIZE` module-scope-read defect (not fixed — an ongoing known defect, not a completed divergence) propagated to `mqtt_simulator_handoff.md` Gotchas as its permanent record; `mqtt_simulator_bootstrap.md`'s env table cross-references it there.

---
