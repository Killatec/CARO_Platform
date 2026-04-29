# CARO_HMI Trend Viewer — Spec Deltas

**Purpose:** One-line entries for divergences from `hmi_trend_viewer_spec.md` during implementation. Propagate to target docs at session end, then delete entries.

---

- Container named `TrendChartContainer` (spec §7 calls it `TrendChartProvider` — renamed because it is a stateful wrapper, not a React Context provider; the Provider name would mislead).
- `ModeState` fixed branch carries `sizeMs: bigint` (spec §9.3 union omits it; required to implement "liveClicked preserves prior sizeMs" without external storage).
- Vertical pan/zoom modifier is shift key (spec §9.1/§9.2 says TBD).
- Custom range picker interprets `datetime-local` inputs as site-local time using `siteTimezone` via `Intl.DateTimeFormat`; falls back to browser local when `siteTimezone` is absent.
