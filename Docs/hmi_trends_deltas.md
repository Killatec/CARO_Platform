# CARO_HMI Trend Viewer — Spec Deltas

**Purpose:** One-line entries for divergences from `hmi_trend_viewer_spec.md` during implementation. Propagate to target docs at session end, then delete entries.

- Removed orphaned `evictRange` (interface, implementation, 5 tests in useTrendData, mock + 7 assertions in TrendChartContainer); fixed handoff drift in notes #16 (FIFO→ring), #21 (evictRange ref), #25 (evictAll addendum), and file-map lines (both occurrences).
- Added `MAX_BUCKET_S` constant to `@caro/db` (replaces literal 14746), re-exported from barrel; duplicated in `level.ts` with cross-ref comment; derived `MAX_VIEWPORT_SPAN_MS`; clamp applied in `useTrendMode` reducer (`zoomApplied`, `panApplied`, `endPickerCommitted`); `rangeExceeded` state added to `useTrendData`; "Range too wide" overlay added to `TrendChartContainer`; route-level early bucketS validation added before `getTrendTile` call.
- Added proactive bucketS skip in `useTrendData` main effect: sets `rangeExceeded=true` and returns before constructing tiles when `derivedBucketS > MAX_BUCKET_S` (eliminates 400 spam from stale `dataViewport`); `rangeExceeded` overlay now renders footer (`footerJsx`) below the message so presets/EndPicker/Live button remain visible for recovery.
- Over-range state now renders TrendChart with empty `AggregateSeriesData` (`n=0`, empty `series`) behind a bold red banner, preserving axes/grid/legend/x-axis interactions (wheel-zoom and drag-zoom can recover without reaching preset buttons).
