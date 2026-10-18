# Tag Registry — Spec Delta

**Purpose:** Divergences between tag-registry implementation and its spec documents.
Read once at session start. Add entries when implementation diverges from spec.

---

- **2026-10-01 — `i32` data type (`tag_registry_spec.md` type table §139–148, rules §304; `tag_registry_bootstrap.md` §191):** New scalar `i32` (Int 32) added to `DataType`, `SCALAR_TYPES`, `NUMERIC_SCALAR_TYPES`, `TRENDABLE_TYPES`, `TYPES_WITH_UNIT` — trendable and setpoint-capable, like `i16`. No `i32[]`.
