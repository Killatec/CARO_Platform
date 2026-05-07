# CARO_HMI Trend Viewer — Spec Deltas

**Purpose:** One-line entries for divergences from `hmi_trend_viewer_spec.md` during implementation. Propagate to target docs at session end, then delete entries.

---

- Legend per-trace shows max only in aggregate (not min – max); contextual header `Value: Max @ Cursor / Last Sample / N/A` (aggregate) or `Value: @ Cursor / Last Sample / N/A` (raw); both tailing-idle headers unified to `Last Sample`.
- Preset highlight rule extended: was `(lastIntent==='preset'||'pan')`, now `lastIntent !== null && lastIntent !== 'zoom'` — covers liveClicked, endPickerCommitted, and any future size-preserving intents.
- Raw path adds bounded `prev` (5-minute window before startTime), v0.8→v0.9, fixes intermittent gaps on flatlined tags at narrow viewports.
- Removed LOCF cutoff query and past-extent CASE wrapper — was paying 814ms planning per CAG request on production-scale tag_samples. LOCF now runs unbounded past MAX(ts). Trailing-edge dead-tag detection deferred to follow-up TODO in handoff (replacement options noted).
