# Phase 6 rig acceptance tests — RF1 — report

**Date:** 2026-10-21 (UTC) · **Run by:** CARO_Platform agent, owner approving · **Prompt:** `CARO_MQTT_Interface/Docs/PHASE6_RIG_TEST_PROMPT.md`
**For:** the RF_Control agent (records results in `CARO_MIGRATION.md` §6.1 and `OS_Upgrade.md`) and CARO_MQTT_Interface (checks them against the library).

## Summary

| Test | Criterion | Result |
|---|---|---|
| T1 | D19: a surplus tag appears in `unknown_tags` and does not block readiness | **Pass** |
| T2 | A missing registry tag produces a correct `missing_ids` and no `READY` | **Pass** |
| T3 | Revert of T1 and T2 | **Pass**: registry identical to its pre-test state |
| T4 | An unpopulated Set is visible on the HMI | **Fail**: the module goes `NOT_READY`, but the HMI shows the Set's normal value |
| T5 | Beat loss keeps the binding and readiness | **Pass** |
| T6 | D16: a fast broker drop re-binds with no backend action | **Pass, with a deviation**: re-bind was module-initiated, but the reason was `beat lost`, because the outage (about 7–10 s) exceeded the 5 s beat timeout |

The run did not stop on any deviation: T4's and T6's came at points where finishing the step was the revert. **Final state:** `Bound 225/0/0`, `READY` (last `State` line 00:36:28), backend `BOUND` with the push acked (127 Sets, 0 unpopulated, 0 rejected), registry restored.

**Not tested:** B3 (hash mismatch). The backend has no identity verification and `commissioned_modules` is not migrated (ICD §7.3).

## Setup and method

- **Board:** `SoC_IP` from `Mons2/RF1` = `10.0.0.133`, matching the `DE10_RF` alias. Board access was `journalctl` only. `rf_control` PID 2481 throughout; it was never restarted.
- **Baseline:** the last restart was 2026-10-19 00:36:38, with `Bound 225/0/0` and `UNBOUND -> NOT_READY -> READY`, and no `[Caro]` lines after it. The backend showed RF1 `BOUND`, push acked (127 Sets, 0 unpopulated). The active registry had 467 tags (RF1 225, RF2 225, HMI 17) at revision 6.
- **Capture:** a Node mqtt.js subscriber (no `mosquitto_sub` on this host) wrote every message on `caro/RF1/handshake_module`, `handshake_backend`, `cmd` and `cmd_ack` with UTC timestamps. It also logged per-second counts of `caro/RF1/telemetry`, `caro/RF1/beat` and `Mons2/RF1`.
- **Backend state:** read from `GET /api/v1/handshake/RF1`, which is what the HMI Module Status table and handshake modal show. The backend's console log was not captured.
- **Registry edits:** made with the Tag Registry's normal flow: `GET /api/v1/templates/<name>`, `POST /api/v1/templates/batch` with the original hash, then `POST /api/v1/registry/apply` for root `Narya1`. `Narya_RF` is used by both RF1 and RF2, so each edit also changed RF2's rows. RF2 has no live module.
- **Backend restarts:** short restarts touched `apps/caro-hmi/server/src/index.ts`, so `tsx watch` restarted the server. For T5, only the server's inner node process was stopped, then restarted the same way.

**Deviations from the prompt's method:**
- **T2 does not rename a tag.** The registry matches tags by `tag_path`, so a rename retires the tag_id, and renaming it back issues a new one. T3 could then not restore the registry. Instead T2 set `In_Tag_Name` on the `Phase_XY` level. That changes the module-relative names of its two Mons (1059 `Phase.X`, 1060 `Phase.Y`) and keeps their `tag_path` and `tag_id`. No level holds a single tag; this is the smallest.
- **T4 publishes the `null` directly to `caro/RF1/cmd`.** `POST /api/v1/tags/write` rejects `null` with `422 TYPE_MISMATCH`. The backend ignores a CMD_ACK it is not awaiting, so `commanded_setpoints` was never written.
- **The surplus tag is `Test_Surplus_Tag`,** a `boolean_mon` directly under `Narya_RF`. The prompt's `Test.Surplus_Tag` would need a new group level. Its tag_id was assigned by the database; tag_ids are not chosen by the user.

## T1 — Surplus registry tag (D19)

**Window:** 00:29:31–00:29:51. **Action:** added child `{ template_name: "boolean_mon", asset_name: "Test_Surplus_Tag" }` to `Narya_RF`. Applied as rev 7 (2 added: RF1, RF2). Backend restarted at 00:29:43.562.

**Journal:**
```
Oct 21 00:29:48 de10-arch RF_Control[2481]: [Caro] Backend lost: no beat for 5000 ms
Oct 21 00:29:48 de10-arch RF_Control[2481]: [Caro] Requesting handshake (beat lost)
Oct 21 00:29:50 de10-arch RF_Control[2481]: [Caro] Tag unknown: Test_Surplus_Tag
Oct 21 00:29:50 de10-arch RF_Control[2481]: [Caro] Bound 225/0/1 in 5289 us
Oct 21 00:29:50 de10-arch RF_Control[2481]: [Caro] Backend OK
```
**Wire:**
```
00:29:49.456 handshake_backend REHANDSHAKE                      (ignored: module already requesting)
00:29:49.987 handshake_module  HANDSHAKE_REQUEST
00:29:49.990 handshake_backend TAG_LIST 226 tags, 14468 B
00:29:50.131 handshake_module  CONFIRM {"unknown_tags":["Test_Surplus_Tag"],"missing_ids":[]}
00:29:50.138 cmd     SET_VALUES 127 values (no nulls); REQUEST_SNAPSHOT
00:29:50.197 cmd_ack SET_VALUES 127 results, 0 rejected; REQUEST_SNAPSHOT
```
**Backend / HMI:** status `BOUND` (4), push acked. An unknown tag sets no status. It is listed only in the handshake details modal (`confirm.unknown_tags`).

**Result: pass.** No `State` line, so RF1 stayed `READY`. The restart took about 6 s, so the module took the `beat lost` path rather than `rehandshake`; the prompt allows this.

## T2 — Missing registry tag

**Window:** 00:30:35–00:30:55. **Action:** in template `Phase`, child `Phase_XY` `In_Tag_Name` `false -> true`. Applied as rev 8 (4 modified, 0 added, 0 retired). Backend restarted at 00:30:43.225.

**Journal:**
```
Oct 21 00:30:44 de10-arch RF_Control[2481]: [Caro] Rehandshake requested by the backend
Oct 21 00:30:44 de10-arch RF_Control[2481]: [Caro] Requesting handshake (rehandshake)
Oct 21 00:30:44 de10-arch RF_Control[2481]: [Caro] Tag unknown: Phase.Phase_XY.X
Oct 21 00:30:44 de10-arch RF_Control[2481]: [Caro] Tag unknown: Phase.Phase_XY.Y
Oct 21 00:30:44 de10-arch RF_Control[2481]: [Caro] Tag unknown: Test_Surplus_Tag
Oct 21 00:30:44 de10-arch RF_Control[2481]: [Caro] Tag missing: Phase.X
Oct 21 00:30:44 de10-arch RF_Control[2481]: [Caro] Tag missing: Phase.Y
Oct 21 00:30:44 de10-arch RF_Control[2481]: [Caro] Bound 223/2/3 in 5454 us
Oct 21 00:30:44 de10-arch RF_Control[2481]: [Caro] State READY -> NOT_READY
```
**Wire:**
```
00:30:44.630 handshake_backend REHANDSHAKE
00:30:44.701 handshake_module  HANDSHAKE_REQUEST
00:30:44.704 handshake_backend TAG_LIST 226 tags, 14486 B
00:30:44.802 handshake_module  CONFIRM {"unknown_tags":["Phase.Phase_XY.X","Phase.Phase_XY.Y","Test_Surplus_Tag"],"missing_ids":["Phase.X","Phase.Y"]}
00:30:44.809 cmd     SET_VALUES 127 values; REQUEST_SNAPSHOT
00:30:44.861 cmd_ack SET_VALUES 127 results, 0 rejected; REQUEST_SNAPSHOT
```
**Backend / HMI:** status `MISSING_IDS` (5); the details modal lists both lists.
**Telemetry (10 s window after the snapshot):** 223 distinct tag_ids; 1059 and 1060 were absent. In the same check after T3, all 225 were present, including 1059 and 1060.

**Result: pass.** This restart took about 1.4 s, so it went through the `rehandshake` path. T1 and T2 together cover both restart paths.

## T3 — Revert T1 and T2

**Window:** 00:31:33–00:32:05. **Action:** restored both templates to their pre-test bodies with one batch save. Applied as rev 9 (4 modified, 2 retired: the two `Test_Surplus_Tag` ids). Backend restarted at 00:31:49.393.

**Journal:**
```
Oct 21 00:31:50 de10-arch RF_Control[2481]: [Caro] Rehandshake requested by the backend
Oct 21 00:31:50 de10-arch RF_Control[2481]: [Caro] Requesting handshake (rehandshake)
Oct 21 00:31:51 de10-arch RF_Control[2481]: [Caro] Bound 225/0/0 in 5324 us
Oct 21 00:31:51 de10-arch RF_Control[2481]: [Caro] State NOT_READY -> READY
```
**Wire:** TAG_LIST 225 tags, 14402 B. CONFIRM `missing_ids: []`, `unknown_tags: []`. Push 127 acked, 0 rejected.

**Registry check:**
- The active registry was compared field by field with the pre-test snapshot: 467 tags, same tag_ids, every field equal except `registry_rev`. The four Phase_XY rows now carry rev 9.
- Template hashes are back to their pre-test values (`Narya_RF` `d5f364`, `Phase` `e87e00`), and both files match git HEAD.

**Result: pass.** Permanent side effects: revisions 7–9 exist, and two tag_ids (`Test_Surplus_Tag` on RF1 and RF2) are retired.

## T4 — Unpopulated Set

**Window:** 00:34:22–00:36:30. **Set:** 1204 `Narya1.RF1.SpecA.Rate.Set` (f32). Its value in the T3 push was `200`.

**Actions and ACKs:**
```
00:34:22.085 cmd     SET_VALUES {"values":[{"tag_id":1204,"value":null}]}
00:34:22.237 cmd_ack {"results":[{"tag_id":1204,"accepted":true}]}
00:36:28.260 cmd     SET_VALUES {"values":[{"tag_id":1204,"value":200}]}
00:36:28.320 cmd_ack {"results":[{"tag_id":1204,"accepted":true}]}
```
**Journal:**
```
Oct 21 00:34:22 de10-arch RF_Control[2481]: [Caro] State READY -> NOT_READY
Oct 21 00:36:28 de10-arch RF_Control[2481]: [Caro] State NOT_READY -> READY
```
**Telemetry and HMI while null:**
- RF1 kept publishing 1204 = `200`, and the owner saw `SpecA → Rate.Set` = **200** on the CARO HMI.
- The module publishes the Set's actual value, which the hub keeps setting from `Sets2/RF1`. Its populated flag is not on the wire, and RF1 has no `Module.Ready` tag.
- The backend's push record (`unpopulated`) counts only `commanded_setpoints`, which was untouched and stayed 0.

**Result: the module part passes (ACK `accepted: true`, `NOT_READY`, then `READY` on restore). The HMI part fails.** An unpopulated Set is visible only in the journal. Stopping the `Sets2` writer was considered and rejected: it drives RF1's FPGA in Phase 6, and it would not make the published value `null`.

## T5 — Beat loss

**Window:** 00:36:50–00:37:15. **Action:** stopped the HMI server process at 00:36:50.679 and restarted it at 00:37:10.095. It was serving again at about 00:37:11.4, so the beat gap was about 21 s.

**Journal:**
```
Oct 21 00:36:55 de10-arch RF_Control[2481]: [Caro] Backend lost: no beat for 5000 ms
Oct 21 00:36:55 de10-arch RF_Control[2481]: [Caro] Requesting handshake (beat lost)
Oct 21 00:37:12 de10-arch RF_Control[2481]: [Caro] Bound 225/0/0 in 5286 us
Oct 21 00:37:12 de10-arch RF_Control[2481]: [Caro] Backend OK
```
**Wire:**
- 17 unanswered `HANDSHAKE_REQUEST`s at 1 Hz, from 00:36:55.758 to 00:37:10.913.
- 00:37:11.404 `REHANDSHAKE` (ignored: already requesting).
- 00:37:11.924 `HANDSHAKE_REQUEST`, then 00:37:11.926 TAG_LIST 225, then 00:37:12.079 CONFIRM `[]`/`[]`. Push acked.
- RF1 telemetry and `Mons2/RF1` stayed at about 10/s throughout.

**Result: pass.** No `State` line, so the binding and `READY` were kept throughout.

## T6 — Broker drop (D16)

**Window:** 00:38:55–00:39:30. **Action:** the owner restarted mosquitto on 10.0.0.184.

**Capture:**
```
00:38:58.5 rates fall to 0 (telemetry, beat, Mons2)
00:38:59.302 [capture] ECONNRESET; reconnects refused at 00:39:02.3 and 00:39:05.4
00:39:08.413 [capture] connected
00:39:08.451 handshake_backend REHANDSHAKE                       (backend reconnected first; ignored)
00:39:09.059 cmd     REQUEST_SNAPSHOT                            (backend watchdog recovery)
00:39:09.205 handshake_module  HANDSHAKE_REQUEST
00:39:09.208 handshake_backend TAG_LIST 225 tags, 14402 B
00:39:09.361 handshake_module  CONFIRM {"unknown_tags":[],"missing_ids":[]}
00:39:09.417 cmd     SET_VALUES 127 values; REQUEST_SNAPSHOT
00:39:09.516 cmd_ack SET_VALUES 127 results, 0 rejected
00:39:09.570 rates back to telemetry=12 beat=1 Mons2=10, then steady at ~10/s
```
**Journal:**
```
Oct 21 00:38:59 de10-arch RF_Control[2481]: error: MQTT_ERROR_SOCKET_ERROR
Oct 21 00:39:02 de10-arch RF_Control[2481]: [Caro] Backend lost: no beat for 5000 ms
Oct 21 00:39:04 de10-arch RF_Control[2481]: Connecting to MQTT Broker
Oct 21 00:39:04 de10-arch RF_Control[2481]: Connecting to MQTT Broker @ 10.0.0.184
Oct 21 00:39:08 de10-arch RF_Control[2481]: [Caro] Requesting handshake (beat lost)
Oct 21 00:39:08 de10-arch RF_Control[2481]: MQTT_Client Ready... (Id 689467109, broker 10.0.0.184)
Oct 21 00:39:09 de10-arch RF_Control[2481]: [Caro] Bound 225/0/0 in 5167 us
Oct 21 00:39:09 de10-arch RF_Control[2481]: [Caro] Backend OK
```
**Result: pass, with a deviation.**
- **As expected:**
  - The re-bind was module-initiated: its `HANDSHAKE_REQUEST` came before any TAG_LIST, and it ignored the backend's REHANDSHAKE (no `Rehandshake requested` line).
  - `Bound 225/0/0` with no `State` line, so the binding was kept (D26).
  - The legacy path recovered: `Mons2/RF1` was back at 10/s by 00:39:09.
  - The backend reconnected, sent REHANDSHAKE, and sent a REQUEST_SNAPSHOT on watchdog recovery.
- **Deviation:** the reason was `beat lost`, not `reconnect`.
  - The broker refused connections from 00:38:58 until at least 00:39:05, and service resumed at 00:39:08. That is an outage of about 7–10 s; the owner's estimate was about 5 s.
  - The 5 s beat timeout therefore fired while the module was disconnected. The requesting period that followed was labelled `beat lost`.
  - A `reconnect`-reason re-bind needs an outage under 5 s. A mosquitto restart on this host did not achieve that.

## Findings for follow-up

1. **An unpopulated Set is not visible on the HMI for RF1 (T4).** The per-Set populated state and module readiness are not on the wire; only the journal shows them. To meet this criterion, either publish readiness or a per-Set populated flag as a tag, or restate the criterion. For RF_Control, CARO_MQTT_Interface and the owner.
2. **The CARO HMI cannot clear a Set.** `POST /api/v1/tags/write` rejects `null` (`apps/caro-hmi/server/src/routes/tags.ts`), so `null` reaches a module only through the post-CONFIRM push of an unpopulated store row. For the owner: should operators be able to clear a Set?
3. **D16's fast-drop case is not demonstrated (T6).** To see the `reconnect` reason, the broker outage must stay under the module's 5 s beat timeout. That needs a faster broker bounce, or a client-side disconnect on the board, which is outside this test's board access. Re-binding through `beat lost` preserved the binding, as D26 requires.
4. **B3 is still open.** It is blocked on identity verification and `commissioned_modules`.
5. **Note for future registry tests:** a rename retires and reissues a tag_id, and a revert issues another new one, so a rename can't be reverted cleanly. Use `In_Tag_Name` on a level to change a module-relative name with the id kept.
