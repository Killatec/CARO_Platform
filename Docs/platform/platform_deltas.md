# CARO_Platform — Platform Spec Delta

**Purpose:** Cross-app and platform-wide divergences between implementation and spec docs only.
App-level divergences live in each app's own spec delta file.
Read once at session start alongside `Docs/README.md`.

---

**Last cleared:** 2026-10-18. Propagated entries live in their target docs; earlier propagation notes are in git history.

- Root `npm run hmi` / `hmi:fresh` added (HMI server + client only; kills only 3003/5175, so a co-hosted process on 3001 survives); `scripts/kill-ports.js` now takes optional port args. Target: `Docs/README.md` Apps section.
