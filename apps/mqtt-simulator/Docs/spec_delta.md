# MQTT Simulator — Spec Delta

**Purpose:** Record of where implementation diverges from spec docs.
Read once at session start. Update only when something diverges.

---

## Known behavioral divergences

### POST /api/v1/simulator/start — async connect (2026-04-03)
- **Spec assumption:** response reflects post-connect state
- **Reality:** MQTT `connect` event fires asynchronously; `/start` responds with `running: false` then flips to `true` within ~100ms
- **Decision:** intentional, 202 signals "accepted not yet running" — correct for a dev tool

---

## Pending spec updates
_(none)_

## Implementation notes

### All DB queries live in packages/db (2026-04-03)
- Bootstrap §6 shows the active-tag query inline in `registry.js`
- Implementation: all SQL lives in `packages/db/` — `registry.js`, `revisions.js`, `health.js`
- `apps/mqtt-simulator/server/services/registry.js` calls `getActiveTags()` then maps rows to SimTag shape
- No raw SQL or direct pool usage remains in any app

### DB access centralized (2026-04-03)
- simulatorService.js imports getActiveTags() from @caro/db/registry.js
- No local SQL remains in app code
- 16 active tags, 1 module (RF1) confirmed after refactor
