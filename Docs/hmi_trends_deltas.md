# CARO_HMI Trend Viewer — Spec Deltas

**Purpose:** One-line entries for divergences from `hmi_trend_viewer_spec.md` during implementation. Propagate to target docs at session end, then delete entries.

- `uplotConfig.ts` `setSelectHook`: `userScaleRef.current` is now updated BEFORE `u.setScale` so the range function returns the new drag-zoom bounds; fixes stale `u.scales['x']` bug that caused spurious 32-tile ensureCovered cascade after drag-zoom.
- `useTrendData.ts` `pruneAndAdd` warn: now logs `activeSet` and `newTile` epoch-ms ranges alongside the existing message for easier diagnosis.
- `useLiveSubscription.ts`: `tailToReturn` memoization gates `tail` on mode consistency to prevent one-render mismatch warning in `mergeTrendData`.
- `useTrendData.ts`: Added `evictAll()` to `UseTrendDataResult`; called on every tailing↔fixed transition in `dispatchModeAction` for a guaranteed clean-slate fetch. **Superseded:** live mode now bypasses cache entirely (see live-spine entry below); `evictAll` is no longer called from `dispatchModeAction`.
- `TrendChartContainer.tsx` `handleLive`: routed through `dispatchModeAction` (was `dispatch`) so fixed→tailing transition also calls `evictAll`. **Superseded by live-spine refactor below.**
- `useTrendData.ts` / `TrendChartContainer.tsx`: Live mode bypasses LRU cache entirely. `isTailing=true` fires one spine tile fetch spanning the full viewport at history-mode resolution (`visibleTilesPerWindow × bucketCount` buckets = 1000 at defaults); result goes directly to `hookResult.data` via `assembleLiveSpine` without touching the cache. `activeTilesRef` stays empty in live mode; `ensureCovered` is a no-op. `evictAll` no longer called on mode transitions; `commitAndDrain` still fires on tailing→fixed. LRU cache is history-mode-only.
- `render/uplotConfig.ts` `setCursor`: uses `u.posToVal(left, 'x')` for cursor time display instead of `u.data[0]?.[idx]`; idx still forwarded for per-tag legend values.
