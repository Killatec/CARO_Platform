# CARO_HMI Trend Viewer — Spec Deltas

**Purpose:** One-line entries for divergences from `hmi_trend_viewer_spec.md` during implementation. Propagate to target docs at session end, then delete entries.

---

- Legend per-trace shows max only in aggregate (not min – max); contextual header `Value: Max @ Cursor / Last Sample / N/A` (aggregate) or `Value: @ Cursor / Last Sample / N/A` (raw); both tailing-idle headers unified to `Last Sample`.
- Preset highlight rule extended: was `(lastIntent==='preset'||'pan')`, now `lastIntent !== null && lastIntent !== 'zoom'` — covers liveClicked, endPickerCommitted, and any future size-preserving intents.
- Raw path adds bounded `prev` (5-minute window before startTime), v0.8→v0.9, fixes intermittent gaps on flatlined tags at narrow viewports.
- Removed LOCF cutoff query and past-extent CASE wrapper — was paying 814ms planning per CAG request on production-scale tag_samples. LOCF now runs unbounded past MAX(ts). Trailing-edge dead-tag detection deferred to follow-up TODO in handoff (replacement options noted).
- Mode rule: `zoomApplied` always → fixed (was: tailing if `to ≥ nowMs − NEAR_NOW_MS`). Tailing now requires explicit `liveClicked` or preset-from-tailing.
- X-axis wheel fix: `handleZoomLevelSwitch` in container was dispatching `zoomApplied` synchronously (only on zoom-in level-switches); sub-threshold zoom-in and all zoom-out stayed live. Removed that dispatch — `zoomApplied` now dispatches solely via `handleXRangeChange` RAF, covering every X-scale mutation through a single path. Canvas wheel unchanged (`inXZone` guard kept; canvas wheel does nothing per §9.2).
- X pan/zoom hygiene: removed unused imports (`panThresholdCheck`, `panXScale`) from TrendChart.tsx; corrected misleading comment in `handleDragZoom` (modeViewport and dataViewport intentionally diverge after drag-zoom); added drag-zoom container integration test; documented raw bounded-prev unification follow-up in handoff.
- `getWatermarkMs` now memoizes per-source with 30s TTL + in-flight dedup; cold-cache `_timescaledb_internal.cagg_watermark()` catalog queries were paying 130-300ms per concurrent tile, dominating boundary-crossing latency. Test seam `__test_clearWatermarkCache` added.
