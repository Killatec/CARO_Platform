# CARO_HMI — Spec Deltas

**Purpose:** One-line entries for spec divergences during implementation. Propagate to target docs at session end, then delete entries.

---

- HMI client: added `@source` for `packages/trend-chart/src` to `index.css` so Tailwind v4 scans trend-chart source for class names. Without this, all Tailwind classes passed as string props from `@caro/trend-chart` (e.g. `bodyClassName`, `widthClass`) silently failed to compile. Affected the Step 12 polish pass retroactively — multiple `px-*`/`py-*`/`max-w-*` adjustments landed in source but never rendered.
