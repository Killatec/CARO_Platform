# CARO_Platform — Platform Spec Delta

**Purpose:** Cross-app and platform-wide divergences between implementation and spec docs only.
App-level divergences live in each app's own spec delta file.
Read once at session start alongside `Docs/platform_handoff.md`.

---

- @caro/ui Modal: added `widthClass` prop (replaces the full `max-w-* w-full` token pair when provided; `maxWidthClass` retained for back-compat) and `bodyClassName` prop (so callers can manage internal scrolling). Existing consumers (BooleanSet, tag-registry modals) unaffected — default behavior preserved.
