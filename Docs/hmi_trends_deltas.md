# CARO_HMI Trend Viewer — Spec Deltas

**Purpose:** One-line entries for divergences from `hmi_trend_viewer_spec.md` during implementation. Propagate to target docs at session end, then delete entries.

---

- **v0.7→v0.8 DB read path:** `getTrendTile` aggregate path now returns `min`/`max` per `AggregateTrendSeries`; CAG SQL uses `min(s.min)`/`max(s.max)` (not `last(s.min/max, s.bucket)` as written in upgrade doc) to correctly span all Div sub-buckets; three-case JS post-pass (mixed-null/empty-collapse/normal) implemented in `querySegment`.
- **v0.7→v0.8 REST layer:** `serializeTile()` aggregate branch now emits `min`/`max` arrays per series; raw branch invariant preserved (no `min`/`max` on raw series); E2E tests added for all three-case invariants and raw-path negative case; LOCF-test guard sample required to push 1s_cagg watermark past the tested bucket.
- **v0.7→v0.8 client wire+cache:** `TileApiResponse` aggregate series gains `min`/`max`; `AggregateSeriesData.series` map value is now `{ value, min?, max? }` (optional for mixed-cache resilience); `CachedEntry` carries `min`/`max`; `estimateCachedEntrySize` accounts for 3× aggregate growth; `storeTileResult` stores all three arrays; `assembleData` builds per-tag struct and leaves `min`/`max` undefined when any present entry is a v0.7 hit.
