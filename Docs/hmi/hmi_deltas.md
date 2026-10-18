# CARO_HMI — Spec Deltas

**Purpose:** One-line entries for spec divergences during implementation. Propagate to target docs at session end, then delete entries.

---

**Last cleared:** 2026-10-17. Propagated entries live in their target docs; earlier propagation notes are in git history.

- 2026-10-18 — `CmdController` writes `commanded_setpoints` (accepted ACK → `accepted`, timeout → `timeout`) alongside `pending_setpoint_values`, and `restorePendingSetpoints()` now reads `commanded_setpoints` (non-null rows only); `apps/caro-hmi/CLAUDE.md` Command Publisher row (also its wrong epsilon claim), `hmi_API_spec.md` §5 and `hmi_functional_spec.md` §8.5/§8.10 still describe `pending_setpoint_values` as the re-delivery source.
