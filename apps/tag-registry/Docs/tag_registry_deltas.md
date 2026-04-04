# Spec Delta — Pending Updates to Spec Documents

Changes made during implementation that diverge from or are
not covered by the current spec docs. Clear each item after
the corresponding Word document has been updated.

---

All deltas through Delta 010 have been applied to:
- Functional Spec v1.17 (`tag_registry_spec.md`)
- Bootstrap v1.21 (`tag_registry_bootstrap.md`)
- API Spec v1.15 (`tag_registry_api_spec.md`)
- Test Spec v1.2 (`tag_registry_test_spec.md`)
- CARO DB Spec v1.3 (`Docs/CARO_DB_Spec.md`)

No open divergences. Add new entries here as implementation diverges from spec.

---

## TODO — not a spec divergence

**Delta TODO-001 — query.test.js coverage for withTransaction/pool**
`packages/db/__tests__/query.test.js` — 5 unit tests covering `withTransaction()` and pool behavior are missing. Must be written before HMI service development starts.
