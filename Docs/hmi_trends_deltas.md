# CARO_HMI Trend Viewer — Spec Deltas

**Purpose:** One-line entries for divergences from `hmi_trend_viewer_spec.md` during implementation. Propagate to target docs at session end, then delete entries.

- Removed orphaned `evictRange` (interface, implementation, 5 tests in useTrendData, mock + 7 assertions in TrendChartContainer); fixed handoff drift in notes #16 (FIFO→ring), #21 (evictRange ref), #25 (evictAll addendum), and file-map lines (both occurrences).
