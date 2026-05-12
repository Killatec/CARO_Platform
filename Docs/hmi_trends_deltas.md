# CARO_HMI Trend Viewer — Spec Deltas

**Purpose:** One-line entries for divergences from `hmi_trend_viewer_spec.md` during implementation. Propagate to target docs at session end, then delete entries.

- `uplotConfig.ts` `setSelectHook`: `userScaleRef.current` is now updated BEFORE `u.setScale` so the range function returns the new drag-zoom bounds; fixes stale `u.scales['x']` bug that caused spurious 32-tile ensureCovered cascade after drag-zoom.
- `useTrendData.ts` `pruneAndAdd` warn: now logs `activeSet` and `newTile` epoch-ms ranges alongside the existing message for easier diagnosis.
- `useLiveSubscription.ts`: `tailToReturn` memoization gates `tail` on mode consistency to prevent one-render mismatch warning in `mergeTrendData`.
- `useTrendData.ts`: Added `evictAll()` to `UseTrendDataResult`; called on every tailing↔fixed transition in `dispatchModeAction` for a guaranteed clean-slate fetch.
- `TrendChartContainer.tsx` `handleLive`: routed through `dispatchModeAction` (was `dispatch`) so fixed→tailing transition also calls `evictAll`.
- `render/uplotConfig.ts` `setCursor`: uses `u.posToVal(left, 'x')` for cursor time display instead of `u.data[0]?.[idx]`; idx still forwarded for per-tag legend values.
