# CARO_HMI Trend Viewer — Spec Deltas

**Purpose:** One-line entries for divergences from `hmi_trend_viewer_spec.md` during implementation. Propagate to target docs at session end, then delete entries.

- design doc §5.2 revised: merge rule is live-wins-on-coverage with null included, not cache-wins; §5.8, §6.4, §7.1 Phase 2 updated to match.
- Phase 1: fifosRef→ringsRef rename; closeBucketsFromRing extracted as pure batch helper; hadNullsAtFetch added to CachedEntry (stored, not yet consumed).
- Phase 2: mergeTrendData rewritten to unified coverage rule; isTailing parameter dropped; cross-bucketSMs re-bucketing via closeBucketsFromRing; rawEntries added to AggregateTail.
- Gap B fix: evictAll() called on fixed→tailing transition; ring-survives architecture (§5.3-§5.4) superseded by this simpler approach.
- `useTrendData.ts` `pruneAndAdd` warn: now logs `activeSet` and `newTile` epoch-ms ranges alongside the existing message for easier diagnosis.
- `useLiveSubscription.ts`: `tailToReturn` memoization gates `tail` on mode consistency to prevent one-render mismatch warning in `mergeTrendData`.
- `render/uplotConfig.ts` `setCursor`: uses `u.posToVal(left, 'x')` for cursor time display instead of `u.data[0]?.[idx]`; idx still forwarded for per-tag legend values.
