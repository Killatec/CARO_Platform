# CARO_HMI Trend Viewer — Spec Deltas

**Purpose:** One-line entries for divergences from `hmi_trend_viewer_spec.md` during implementation. Propagate to target docs at session end, then delete entries.

- `useTrendData.ts` `pruneAndAdd` warn: now logs `activeSet` and `newTile` epoch-ms ranges alongside the existing message for easier diagnosis.
- `useLiveSubscription.ts`: `tailToReturn` memoization gates `tail` on mode consistency to prevent one-render mismatch warning in `mergeTrendData`.
- `render/uplotConfig.ts` `setCursor`: uses `u.posToVal(left, 'x')` for cursor time display instead of `u.data[0]?.[idx]`; idx still forwarded for per-tag legend values.
