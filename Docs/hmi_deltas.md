# CARO_HMI — Spec Deltas

**Purpose:** One-line entries for spec divergences during implementation. Propagate to target docs at session end, then delete entries.

---

**Last cleared:** 2026-05-27. TagDef.trendable boolean propagated to platform_handoff (@caro/hmi-context packages row + Platform Rules TagDef field list). Tailwind @source requirement propagated to apps/caro-hmi/CLAUDE.md Key Design Decisions.

**Last cleared:** 2026-06-06. WS disconnect null-out + Pole Page widget/button list (Speed_RSS as NumericSet, Go_To_Pos_1_B/2_B) propagated to `apps/caro-hmi/CLAUDE.md` Key Design Decisions (new WS disconnect bullet) + Client Architecture (Pole Page row).

**Last cleared:** 2026-09-20. `pending_setpoint_values` (migration 016) propagated to `platform_handoff.md` Database section (added to Applied list, moved out of "not yet migrated") and `apps/caro-hmi/CLAUDE.md` Command Publisher row (`restorePendingSetpoints`, epsilon comparison, known gaps). PoleBox 5-box reorg was already reflected in `apps/caro-hmi/CLAUDE.md`'s Pole Page row — no edit needed, entry cleared. SpecABox (all additions through the Center_Freq change) and SpectrumChart propagated to `apps/caro-hmi/CLAUDE.md` Pole Page row and `platform_handoff.md` `@caro/widgets` package row. DbPipeline rate-limited error logs + HistorianReconnector propagated to `apps/caro-hmi/CLAUDE.md` (DB Pipeline row, new Historian Reconnector row, Entry row). HmiTagSource unknown-property absorb-and-report, WS `parseTagIdsArray` partial-batch handling, `useLiveValue`/`subscribeLiveValue` accepting `undefined`, and the ModuleInfoTable abbreviated-path + module-ordering-filter work propagated to `apps/caro-hmi/CLAUDE.md` (HMI Tag Source row, WS Server row, ModuleInfoTable row, four new Key Design Decisions bullets) and `platform_handoff.md` `@caro/hmi-context` package row.
