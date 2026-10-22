# Phase 6 rig acceptance tests — RF1 — re-run of T4 and T6 (library 2d3d105, P66–P67)

**Date:** 2026-10-21 (UTC) · **Run by:** CARO_Platform agent, owner approving each step · **Baseline:** `Phase6_RF1_Rig_Test_Report_2026-10-21.md` (same folder)
**For:** CARO_MQTT_Interface (checks the results against the library) and the RF_Control agent (records them in `CARO_MIGRATION.md` §6.1).

## Summary

| Step | Criterion | Result |
|---|---|---|
| 0 | The P66 binary is deployed | **Pass** |
| T4 | An unpopulated Set is visible on the HMI | **Pass**. The historian part was not tested because TimescaleDB was down. |
| T6 | D16: a fast broker drop re-binds with no backend action | **Pass**. The outage was about 1 s; the reason was `reconnect`. |

Nothing differed from the expected results.

**Final state:**
- RF1 is `Bound 225/0/0` and `READY` (last `State` line 01:15:52, `NOT_READY -> READY`).
- The backend is `BOUND` with the push acked (127 Sets, 0 unpopulated, 0 rejected).
- 1204 is restored to `200`, in both telemetry and `commanded_setpoints`.

**Method:** the same as the baseline.
- **Capture:** an mqtt.js subscriber logged RF1's handshake, `cmd` and `cmd_ack` topics with UTC timestamps, plus per-second rates of telemetry, beat and `Mons2/RF1`. This run it also logged every telemetry entry for tag 1204.
- **Commands:** SET_VALUES were published directly to `caro/RF1/cmd`.
- **Board access:** `journalctl` only, after checking `SoC_IP` `10.0.0.133` against the `DE10_RF` alias.

## Step 0 — Deployed binary

`rf_control` was restarted at 01:10:58 as PID 18668. Journal:
```
Oct 21 01:10:58 de10-arch RF_Control[18668]: [Caro] Initialized: module_id RF1, client_id RF1-66:1e:98:49:6d:87, instance_id 66:1e:98:49:6d:87, template Narya_RF rev 3, fw sha256:d0c10317bf585a2cbd5db96332a1aca5156cf1ff36c7572ef8844a6547567875
Oct 21 01:10:58 de10-arch RF_Control[18668]: [Caro] State UNBOUND
Oct 21 01:10:59 de10-arch RF_Control[18668]: [Caro] Broker connected: 10.0.0.184:1883
Oct 21 01:10:59 de10-arch RF_Control[18668]: [Caro] Requesting handshake (startup)
Oct 21 01:10:59 de10-arch RF_Control[18668]: [Caro] Bound 225/0/0 in 5255 us
Oct 21 01:10:59 de10-arch RF_Control[18668]: [Caro] State UNBOUND -> NOT_READY
Oct 21 01:10:59 de10-arch RF_Control[18668]: [Caro] State NOT_READY -> READY
```
**Pass.** `Broker connected` is present, so this is a P66 binary. The fw hash changed from the baseline's `sha256:6695583f…`. The backend recorded the same `fw_hash` and pushed 127 Sets: acked, 0 unpopulated.

## T4 — Unpopulated Set (1204 `Narya1.RF1.SpecA.Rate.Set`)

**Window:** 01:14:43–01:16:02. **Value before the test:** `200`, from the capture's refresh entries at 01:14:22.859, 01:14:30.436 and 01:14:38.013.

**Actions and ACKs:**
```
01:14:43.866 sent SET_VALUES {"values":[{"tag_id":1204,"value":null}]}
01:14:43.923 ack  {"results":[{"tag_id":1204,"accepted":true}]}
01:15:52.565 sent SET_VALUES {"values":[{"tag_id":1204,"value":200}]}
01:15:52.628 ack  {"results":[{"tag_id":1204,"accepted":true}]}
```
**Journal:**
```
Oct 21 01:14:43 de10-arch RF_Control[18668]: [Caro] State READY -> NOT_READY
Oct 21 01:15:52 de10-arch RF_Control[18668]: [Caro] State NOT_READY -> READY
```
**Telemetry (every 1204 entry in the window):**
```
01:14:43.871 cmd   SET_VALUES 1204 = null
01:14:43.923 telemetry {"tag_id":1204,"value":null}   (+52 ms)
01:14:45.590 telemetry {"tag_id":1204,"value":null}   (refresh, then every ~7.58 s)
01:14:53.169 … 01:15:46.210  value null every time; no non-null 1204 entry
01:15:52.568 cmd   SET_VALUES 1204 = 200
01:15:52.628 telemetry {"tag_id":1204,"value":200}    (+60 ms, value unchanged from before the null)
01:15:53.788 telemetry {"tag_id":1204,"value":200}    (refresh)
```
**HMI:** while 1204 was null, the owner confirmed that `SpecA → Rate.Set` showed null on the CARO HMI instead of 200. After the restore it showed the normal value. The exact rendering (`---`, empty, or bad-quality styling) was not recorded.

**Historian: not tested.** TimescaleDB (port 5433) was unreachable because Docker Desktop was not running. `/api/v1/trends/tile` and `/extent` returned `ECONNREFUSED`. The HMI backend was in its soft-fail mode (`NullDbWriter`), so no historian rows were written for any tag in this window. With the owner's agreement, T4 ran without it.

**`commanded_setpoints`:** never written. The backend ignores a CMD_ACK it is not awaiting. The Set push in T6 (01:16:49.946) read the store and sent `{"tag_id":1204,"value":200}`, so the store still holds 200.

**Result: pass.** The null reached telemetry within about 50 ms and was the only 1204 value until the restore. The restore was published within about 60 ms even though the value had not changed. Readiness changed as expected in both directions. The HMI showed the Set as unpopulated.

## T6 — Broker drop (D16)

**Window:** 01:16:47–01:16:55. **Action:** the owner restarted mosquitto on 10.0.0.184.

**Outage:** about 1.0 s. The last full traffic second ended at about 01:16:47.1, the capture saw `ECONNRESET` at 01:16:47.869 and reconnected at 01:16:48.875.

**Journal:**
```
Oct 21 01:16:48 de10-arch RF_Control[18668]: error: MQTT_ERROR_SOCKET_ERROR
Oct 21 01:16:48 de10-arch RF_Control[18668]: [Caro] Broker connection lost: MQTT_ERROR_SOCKET_ERROR
Oct 21 01:16:48 de10-arch RF_Control[18668]: [Caro] Broker connected: 10.0.0.184:1883
Oct 21 01:16:48 de10-arch RF_Control[18668]: [Caro] Requesting handshake (reconnect)
Oct 21 01:16:49 de10-arch RF_Control[18668]: [Caro] Bound 225/0/0 in 5236 us
Oct 21 01:16:53 de10-arch RF_Control[18668]: Connecting to MQTT Broker
Oct 21 01:16:53 de10-arch RF_Control[18668]: Connecting to MQTT Broker @ 10.0.0.184
Oct 21 01:16:53 de10-arch RF_Control[18668]: MQTT_Client Ready... (Id 125178354, broker 10.0.0.184)
```
(The last three lines are the legacy `MQTT_cs` client.)

**Wire:**
```
01:16:48.875 [capture] connected
01:16:48.881 handshake_backend REHANDSHAKE                (backend reconnected; no "Rehandshake requested" line: module already requesting)
01:16:49.477 cmd     REQUEST_SNAPSHOT                     (backend watchdog recovery)
01:16:49.763 handshake_module  HANDSHAKE_REQUEST          (first one seen; before any TAG_LIST)
01:16:49.765 handshake_backend TAG_LIST 225 tags, 14402 B
01:16:49.891 handshake_module  CONFIRM {"unknown_tags":[],"missing_ids":[]}
01:16:49.946 cmd     SET_VALUES 127 values (no nulls; 1204 = 200); REQUEST_SNAPSHOT
01:16:49.972 cmd_ack SET_VALUES 127 results, 0 rejected
```
**Rates:** RF1 telemetry was back to 10/s by 01:16:50. `Mons2/RF1` resumed at 01:16:53 and was at 10/s by 01:16:54. The legacy client reconnects about 5 s after the CARO client.

**Result: pass.**
- The lines appeared in the expected order: `Broker connection lost` (next to the legacy `error:` line), `Broker connected`, `Requesting handshake (reconnect)`, `Bound 225/0/0`.
- There was no `Backend lost` or `Backend OK`, as expected for an outage under 5 s, and no `State` line, so binding and readiness were kept.
- The re-bind was module-initiated: its `HANDSHAKE_REQUEST` came before the TAG_LIST.

## Effect on the baseline's findings

- **Finding 1 (an unpopulated Set not visible on the HMI) is closed by P67.**
- **Finding 3 (D16 fast drop not demonstrated) is closed.** A 1 s outage produced the `reconnect` path.
- **Finding 2 (the HMI cannot clear a Set: `POST /api/v1/tags/write` rejects `null`) is unchanged.** It is a CARO_Platform question for the owner.
- **Finding 4 (B3 hash mismatch) is still blocked** on identity verification and `commissioned_modules`.
- **New:** whether a historian row is written for a null Set is untested. Re-check with TimescaleDB up. The historian stores `null` as a bad-quality sentinel (`hmi_trend_viewer_reference.md`), so a null row is expected.
