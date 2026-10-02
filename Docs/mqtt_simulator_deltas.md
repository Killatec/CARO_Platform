# MQTT Simulator — Spec Delta

**Purpose:** Divergences between MQTT Simulator implementation and its spec documents.
Read once at session start. Add entries when implementation diverges from spec.

---

- **2026-10-01 — `i32` data type (`mqtt_simulator_bootstrap.md` §239 type map):** `i32` → `int_value` (`int32`, clamped to ±2³¹). `advanceI16Value` replaced by `advanceIntValue(simT, deltaMs, range)` with exported `I16_RANGE`/`I32_RANGE`; `i32` shares the `i16` sine-wave and random-setpoint branches.

---

**Last cleared:** 2026-09-20. `MQTT_BROKER_URL`/`MQTT_CLIENT_ID`/`LOG_BUFFER_SIZE` module-scope-read defect (not fixed — an ongoing known defect, not a completed divergence) propagated to `mqtt_simulator_handoff.md` Gotchas as its permanent record; `mqtt_simulator_bootstrap.md`'s env table cross-references it there.

---
