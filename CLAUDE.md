# CLAUDE.md

## Session Start
Read [Docs/platform_handoff.md](Docs/platform_handoff.md) first. It is the platform constitution.

Then read the relevant app documents:
- If working on tag-registry → read `apps/tag-registry/Docs/tag_registry_handoff.md` and `apps/tag-registry/CLAUDE.md`
- If working on mqtt-simulator → read `apps/mqtt-simulator/Docs/mqtt_simulator_handoff.md` and `apps/mqtt-simulator/CLAUDE.md`

Platform-level specs — read once if your session involves:
- DB schema or queries → `Docs/CARO_DB_Spec.md`
- MQTT message handling → `Docs/CARO_MQTT_Spec.md`

## During Every Task
- If you implement or modify any functionality, update all affected delta files immediately — include docs/platform_deltas.md for any cross-app or shared package changes
- Do not update handoff, bootstrap, or spec docs during a task — delta files are the only docs that change mid-session
- ALL queries live in `packages/db/` — no raw SQL in app code, import named functions only
- All new code is TypeScript. Existing apps (tag-registry, mqtt-simulator) remain JavaScript until explicitly migrated — see docs/platform_deltas.md for migration TODOs.
- Check `packages/ui/` before writing new components — do not duplicate primitives
- All apps follow `apps/tag-registry/` conventions for folder structure, component style, error shapes, and API patterns

## Session End Checklist
For every session that changed code or behavior:
0. Verify all delta files were updated during the session — add any missing entries now
1. Review `{app}_deltas.md`
2. For each entry, when explicitly prompted by the user:
   - Propagate to spec doc → update spec, delete entry
   - Permanent behavioral decision → move to `{app}_handoff.md` §Key Decisions, delete entry
3. `{app}_deltas.md` should be empty or near-empty before closing the session
