# CARO_Platform — Platform Spec Delta

**Purpose:** Cross-app and platform-wide divergences between implementation and spec docs only.
App-level divergences live in each app's own spec delta file.
Read once at session start alongside `Docs/platform_handoff.md`.

---

- @caro/ui Modal: added outerStyle / headerStyle / bodyStyle inline-style props (CSSProperties). Pruned the className-based customization props introduced during Step 12 polish to actual-usage only — maxWidthClass, widthClass, outerClassName, headerClassName, bodyClassName removed (zero callers outside packages/ui); only the three inline-style props survived.
