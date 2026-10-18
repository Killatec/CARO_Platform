**CARO_MQTT_Spec**

MQTT Interface Specification

Date: 2026-10-18

**Companion Documents**

hmi_functional_spec \| hmi_API_spec \| CARO_DB_Spec

**Revision History**

  ------------- ------------ ------------- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Version**   **Date**     **Author**    **Summary**

  1.0           2026-03-24   PM / Claude   Initial release. Extracted from hmi_functional_spec.

  1.1           2026-03-24   PM / Claude   OI-05 resolved --- SCHEMA payload format defined as base64-encoded .proto text.

  1.2           2026-03-26   PM / Claude   SET_TAG renamed to SET_VALUES. Command payload now carries a values array. CMD_ACK updated to per-tag results array.

  1.3           2026-03-26   PM / Claude   Companion documents updated to include CARO_DB_Spec and updated companion spec versions.

  1.4           2026-03-26   PM / Claude   QoS strategy rationale documented. Retained messages explicitly prohibited. cleanSession=true policy defined. NTP synchronization requirement added.

  1.5           2026-03-27   PM / Claude   Broker credentials provisioning note removed. Section 4 updated for Protobuf and JSON encoding modes. Delta empty-tags note added. Status/heartbeat direction corrected. INTERLOCKED rejection code removed. Handshake SCHEMA/SCHEMA_ACK steps removed. Hash validation updated. Appendix A replaced with schema reference.

  1.6           2026-03-27   PM / Claude   Terminology: all references to \'device\' replaced with \'module\', device_id replaced with module_id throughout. Sections 5.1/5.3 reordered. Command envelope simplified. Section 7.3 updated.

  1.7           2026-03-27   PM / Claude   EXPIRED rejection code corrected: evaluated by embedded module from cmd ts_utc_ms. MQTT connection policy added (Section 2.1). Time synchronization requirement added (Section 2.2). Reconnect and handshake sequence policy added. TAG_LIST and CONFIRM message examples added. LWT recommendation added. Duplicate command_id handling note added. Telemetry publish rate guidance added.

  1.8           2026-03-27   PM / Claude   Status/heartbeat topic row removed from Section 3 topic table. Section 5.3 (Status/Heartbeat) removed; backend heartbeat moved to new Section 5.3 (Backend Heartbeat). LWT references removed. Section 5.1 JSON format updated: status field added (ONLINE \| FAULT). Section 5.2 Protobuf format updated: legacy wrapper/DELTA language removed; payload described as directly mirroring JSON structure encoded per Protobuf schema.
  1.9           2026-10-01   PM / Claude   Handshake identifies tags by module-relative tag_name instead of truncated tag_path: TAG_LIST entries are { tag_id, tag_name }; Section 7.4 rewritten (tag_name derivation, uniqueness). Matches the Tag Registry "Generate Tag Defs" export the module's definitions are generated from.
  2.1           2026-10-18   PM / Claude   Module handshake implemented to the module-side contract (CARO_MQTT_Interface): topics renamed by publisher (handshake_backend / handshake_module); module-initiated HANDSHAKE_REQUEST carrying identity; TAG_LIST entries gain is_setpoint; CONFIRM carries missing_ids / unknown_tags / truncated instead of hashes; new REHANDSHAKE. Section 6.3 rewritten: the only Set delivery is the post-CONFIRM push from commanded_setpoints; startup and recovery re-delivery removed. REQUEST_SNAPSHOT now follows each CONFIRM and watchdog recovery, not the broker connect. Section 7 rewritten as built; identity verification still target.
  2.0           2026-10-17   PM / Claude   Reconciled against the implementation. New Section 1.1 Implementation Status. Sections 4/5: the backend currently decodes JSON telemetry only; backend handling of each telemetry field and REQUEST_SNAPSHOT triggers stated as built. Section 6: custom command types, optional top-level CMD_ACK error field, backend ACK handling (1 s timeout), backend-generated rejection codes (TIMEOUT, MODULE_TYPE_NOT_SUPPORTED), DUPLICATE marked module-evaluated. New Section 6.3 Setpoint Re-delivery. Section 7 marked not yet implemented. Open Questions updated.
  ------------- ------------ ------------- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**1. Purpose**

This document defines the MQTT interface between the CARO_HMI backend and embedded modules. It is the authoritative ICD (Interface Control Document) for embedded firmware engineers implementing module-side MQTT communication.

The CARO_HMI backend is the sole MQTT client on the broker side --- it subscribes to module telemetry and publishes commands. Embedded modules subscribe to command and handshake topics and publish telemetry and acknowledgements.

For HMI system architecture, user roles, tag data model, WebSocket API, and REST API --- see hmi_functional_spec. For what the backend does with each message once received (Last-Known-Value cache, watchdog, historian, WebSocket), see `Docs/platform/CARO_Telemetry_Path_Reference.md`.

**1.1 Implementation Status (as of 2026-10-18)**

This document is the target contract, and not all of it is built yet. Firmware written today must work with what the current backend (`apps/caro-hmi/server`) actually does:

| Area | Spec section | Backend (caro-hmi) | MQTT Simulator |
|---|---|---|---|
| Broker TLS, client certificates, ACLs, anonymous rejection | 2 | **Not implemented.** Plain `mqtt://` from `MQTT_URL`, anonymous, no TLS options. | Same — anonymous `mqtt://`. |
| cleanSession, no retained messages | 2.1 | mqtt.js defaults (clean session, MQTT 3.1.1); never sets `retain`. On every connect, including each automatic reconnect, it re-subscribes and sends REHANDSHAKE to every MQTT-type module. | `clean: true`, `retain: false`, reconnect every 2 s. |
| Telemetry, JSON encoding | 5.1 | **Implemented — the only encoding the backend accepts.** | Default. |
| Telemetry, Protobuf encoding | 4, 5.2 | **Not implemented.** The bridge only `JSON.parse`s telemetry; a Protobuf payload fails to parse and is silently dropped. | Encodes per `tag.proto` (per-module toggle), but the HMI cannot read it. |
| Backend heartbeat `/beat` | 5.3 | Implemented: `{ ts_utc_ms }`, QoS0, every `HEARTBEAT_INTERVAL_MS` (default 1000 ms), to MQTT-type modules only. Never withheld. | Not subscribed. |
| Watchdog | 5 | Implemented: `WATCHDOG_TIMEOUT_MS` (default 1000 ms), checked every `min(timeout, 500)` ms. | n/a |
| REQUEST_SNAPSHOT | 5, 6.1 | Implemented: after every CONFIRM and on watchdog recovery; ACK not awaited. | Publishes a full snapshot immediately. |
| SET_VALUES + per-tag CMD_ACK results | 6.1, 6.2 | Implemented, 1 s ACK timeout. | Implemented. |
| RESET | 6.1 | Sent to every module by `POST /api/v1/reset`, or to one module by `POST /api/v1/commands`. | Increments the module's `Reset_Count` tag. |
| Custom command types | 6.1 | Implemented via `POST /api/v1/commands` (e.g. `Stop_App`, `Home`). | ACKed with empty results; no other effect. |
| Set push after CONFIRM | 6.3 | Implemented: every Set from `commanded_setpoints`, nulls included, ACK awaited. | n/a (no handshake). |
| DUPLICATE rejection | 6.2 | n/a — the backend never re-sends a command_id. | Duplicates within 60 s are **dropped without an ACK**. |
| EXPIRED evaluation | 6.2 | n/a (module-side). | Not implemented. |
| Handshake (HANDSHAKE_REQUEST / TAG_LIST / CONFIRM / REHANDSHAKE) | 7 | **Implemented** (Section 7.5), except identity verification (7.3): every request from an MQTT-type registry module is answered. | **Not implemented**: the simulator never binds, so it receives neither a Set push nor a REQUEST_SNAPSHOT from the backend. |

**2. Broker Deployment**

-   MQTT broker runs locally on the trusted LAN --- not exposed to external networks.

-   TLS is REQUIRED for command, handshake, and acknowledgement channels. Telemetry channels run unencrypted on the trusted local network for performance.

-   Authentication: per-module client certificates (preferred). Username/password permitted only during development.

-   Broker rejects anonymous connections.

-   ACLs restrict each module to its own topic namespace --- a module may only publish and subscribe to topics containing its own module_id.

**2.1 MQTT Client Connection Policy**

All MQTT clients (backend and modules) must connect with the following settings:

-   cleanSession=true (MQTT 3.1.1) / clean_start=true (MQTT 5.0) required on every connect. No persistent sessions.

-   Retained messages are explicitly prohibited on all topics. Modules must not set retain=true when publishing on any topic.

-   The broker must be configured to reject retained message publication.

***NOTE:** Because cleanSession=true is required, modules must re-subscribe to all relevant topics on every reconnect, and a module requests a new handshake after every reconnect. On its own (re)connect the backend sends REHANDSHAKE to every MQTT-type module --- see Section 7.*

**2.2 Time Synchronization**

Modules shall maintain UTC time synchronized to within ±2 seconds. Acceptable synchronization sources include NTP, GPS, RTC, or the backend /beat topic timestamp as a reference. Accurate timestamps are required for:

-   EXPIRED rejection code evaluation --- modules compare command ts_utc_ms against their local UTC clock.

-   Telemetry timestamp accuracy --- all tag timestamps are module-generated UTC milliseconds.

-   Handshake and heartbeat timestamp fields.

***NOTE:** If a module cannot guarantee time synchronization at startup, it should defer EXPIRED evaluation and log a warning.*

**3. Topic Structure**

All topics follow the pattern: caro/{module_id}/{channel}

module_id is the module asset_name as defined in the Tag Registry --- it must match exactly.

| Purpose | Topic | Publisher | Subscriber | QoS | TLS |
|---|---|---|---|---|---|
| Telemetry | caro/{module_id}/telemetry | Module | Backend | QoS0 | No |
| Backend heartbeat | caro/{module_id}/beat | Backend | Module | QoS0 | No |
| Command | caro/{module_id}/cmd | Backend | Module | QoS1 | Yes |
| Command acknowledgement | caro/{module_id}/cmd_ack | Module | Backend | QoS1 | Yes |
| Handshake, backend → module (TAG_LIST, REHANDSHAKE) | caro/{module_id}/handshake_backend | Backend | Module | QoS1 | Yes |
| Handshake, module → backend (HANDSHAKE_REQUEST, CONFIRM) | caro/{module_id}/handshake_module | Module | Backend | QoS1 | Yes |

**4. Payload Encoding**

Telemetry payloads support two encoding modes:

-   Protobuf (target default for production --- **not yet decoded by the backend**, see Section 1.1): Protocol Buffers binary encoding. The authoritative schema is located at packages/proto/tag.proto in the CARO_Platform monorepo. See Appendix A for the reference location.

-   JSON: A plain JSON payload mirroring the Protobuf telemetry message structure, using native JSON types for tag values. See Section 5.1 for the format. **This is currently the only telemetry encoding the backend accepts**, so modules must publish JSON until Protobuf decoding is built.

All other channels (commands, handshake, acknowledgements) use JSON encoding. Bandwidth optimization is not required for these low-frequency channels.

***NOTE:** Unknown Protobuf fields are silently ignored (proto3 forward-compatibility). The schema is hardcoded in module firmware and sourced from packages/proto/tag.proto --- it is not delivered over the wire during the handshake.*

**5. Telemetry Channel**

The single telemetry topic caro/{module_id}/telemetry carries module-to-backend tag value updates using Protobuf encoding (or JSON in development mode --- see Section 4). The backend watchdog monitors telemetry continuity --- loss of telemetry from a module triggers quality=bad for all of that module\'s tags in the Last-Known-Value cache. The channel operates in two modes:

  -------------------- ------------------------------------------------------------------------------------------------- ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Mode**             **Trigger**                                                                                       **Content**

  Full snapshot        Module receives REQUEST_SNAPSHOT command from backend (after each handshake CONFIRM, or when the watchdog sees the module recover).   Module publishes all its current tag values. The backend uses these to fully populate the Last-Known-Value cache and transition all tags for this module to quality=good.

  Change-only update   Normal operation at module publish rate.                                                          Module publishes only tag values that have changed since the last publish cycle. If no tags have changed, the module still publishes a message with the current timestamp and an empty tags array.
  -------------------- ------------------------------------------------------------------------------------------------- ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

***NOTE:** There is no separate MQTT topic for full snapshots vs change-only updates. The message structure is identical in both modes, and the backend processes every telemetry message the same way: each tag value is written to the Last-Known-Value cache, so a full snapshot simply refreshes every tag. The backend does not track whether a REQUEST_SNAPSHOT is outstanding.*

The backend sends REQUEST_SNAPSHOT to an MQTT-type module (a module whose tags have `module_type = 'MQTT'` in the Tag Registry):

-   right after the Set push that answers each handshake CONFIRM (Section 6.3) --- a module binding never triggers a full publish on its own;
-   when the watchdog sees it recover (stalled, then receiving telemetry again). Telemetry is change-only, so without it tags that do not change would stay null in the Last-Known-Value cache.

It is not sent on broker connect: the REHANDSHAKE sent then leads to a bind, which is followed by one.

**Backend handling of telemetry fields (as built):**

-   `timestamp` --- module UTC milliseconds. Used as the time of every historian row from that message and of live trend samples. Not validated (see `Docs/platform/platform_todo.md`).
-   `status` --- `"FAULT"` sets every tag of the module to bad quality (null) in the Last-Known-Value cache; values carried in the same message are then applied on top and still reach the historian. Any other string is recorded as the module status and is otherwise ignored.
-   `tags[].tag_id` --- a tag_id unknown to the active Tag Registry is silently dropped. The backend does not check that the tag belongs to the publishing module.
-   `tags[].value` --- number, boolean, string, number array or null, stored as received. Change detection is strict equality (element-wise for arrays).
-   Telemetry silence longer than the watchdog timeout sets every tag of the module to null and its status to STALLED. The first message after that clears the stall.

Recommended telemetry publish rate: 100--500 ms (2--10 Hz). Firmware teams should size buffers and DMA transfers accordingly. The default in the MQTT simulator is 100 ms (10 Hz). A module must publish at least once per watchdog timeout (default 1000 ms) --- the empty change-only message counts --- or the backend marks it STALLED.

**5.1 JSON Telemetry Format**

When operating in JSON mode (development / simulator only), the module publishes a plain JSON payload to caro/{module_id}/telemetry instead of a Protobuf binary:

{

\"timestamp\": 1743073812000,

\"status\": \"ONLINE\" \| \"FAULT\",

\"tags\": \[

{ \"tag_id\": 1003, \"value\": 62.34 },

{ \"tag_id\": 1004, \"value\": true }

\]

}

***NOTE:** JSON was introduced as a development convenience, but it is currently the only encoding the backend decodes (Section 1.1). Values use native JSON types: number for f32/i16/i32, boolean for bool, string for string, number array for f32[]/i16[], null for a value the module cannot provide.*

**5.2 Protobuf Telemetry Format**

The Protobuf telemetry payload directly mirrors the JSON format defined in Section 5.1 --- it carries the same fields (timestamp, status, and tags array) encoded per the schema at packages/proto/tag.proto. There is no outer message wrapper or type discriminator field.

When operating in change-only mode with no tag changes on a given tick, the module still publishes a message with the current timestamp, current status, and an empty tags array. See Appendix A for the schema reference.

**5.3 Backend Heartbeat**

The backend publishes a heartbeat to each module on caro/{module_id}/beat at a regular interval. Modules use this to detect loss of communication with the backend. Backend heartbeat payload:

{

\"ts_utc_ms\": \<timestamp\>

}

***NOTE:** Backend heartbeat format is timestamp-only. The backend publishes it at QoS0 every `HEARTBEAT_INTERVAL_MS` (default 1000 ms) to every MQTT-type module, starting on broker connect, and never withholds it. A bound module that misses beats for its own beat timeout (RF_Control: 5000 ms) requests a new handshake and keeps its binding meanwhile (Section 7.5). Modules do not parse the payload.*

**6. Command Channel**

The backend publishes commands to caro/{module_id}/cmd (QoS1, TLS). All commands share a common envelope with a command_type field and a generic payload object whose contents vary by command type.

**6.1 Command Envelope**

{

\"command_id\": \"\<UUID4\>\",

\"command_type\": \"REQUEST_SNAPSHOT\" \| \"SET_VALUES\" \| \"RESET\" \| \"\<custom\>\",

\"ts_utc_ms\": \<timestamp\>,

\"payload\": {

\"values\": \[

{ \"tag_id\": \<uint32\>, \"value\": \<typed\> }

\]

}

}

***NOTE:** payload.values is only present for SET_VALUES commands. All other command types carry an empty payload object. The backend publishes every command at QoS1 with a fresh UUID4 command_id.*

  ------------------ ------------------------------------------------------------------------------ ------------------------------------------------------------------------------------------------------------------------------------------------
  **command_type**   **payload contents**                                                           **Description**

  REQUEST_SNAPSHOT   {}                                                                             Backend requests module to publish all current tag values via the telemetry channel. Sent right after the Set push that answers each handshake CONFIRM, and when the watchdog sees the module recover (Section 5).

  SET_VALUES         { \"values\": \[ { \"tag_id\": \<uint32\>, \"value\": \<typed\> }, \... \] }   Write one or more setpoint values. Always an array --- single writes are a batch of one. The backend sends only tags belonging to this module. A `null` value means unpopulated: the post-CONFIRM Set push (Section 6.3) sends one for every Set with no stored value, and the module ACKs it `accepted: true`.

  RESET              {}                                                                             Request module soft reset. Exact behavior is firmware-defined.

  \<custom\>         {}                                                                             Module-specific action (e.g. Stop_App, Home, Go_to_Pos_1). The backend forwards the operator's command string verbatim as command_type, via POST /api/v1/commands, without validating it. A module that does not recognise a command_type should still ACK it, with an error (Section 6.2).
  ------------------ ------------------------------------------------------------------------------ ------------------------------------------------------------------------------------------------------------------------------------------------

**6.2 Command Acknowledgement**

Modules publish a CMD_ACK to caro/{module_id}/cmd_ack (QoS1) for every command received. For SET_VALUES commands the ACK includes a per-tag results array to support partial failure reporting.

{

\"command_id\": \"\<UUID4 --- echoed from command\>\",

\"command_type\": \"\<echoed from command\>\",

\"ts_utc_ms\": \<timestamp\>,

\"results\": \[

{ \"tag_id\": 1001, \"accepted\": true },

{ \"tag_id\": 1002, \"accepted\": false, \"rejection_code\": \"OUT_OF_RANGE\" }

\]

}

***NOTE:** For commands other than SET_VALUES, results is omitted or an empty array --- acceptance is implicit if the module responds at all. To refuse such a command, a module may set an optional top-level `"error": "<reason>"` string on the CMD_ACK, or include a result with `accepted: false`; the backend treats either as a rejection.*

**Backend ACK handling (as built).** The backend waits 1 second for a CMD_ACK with the matching command_id:

-   SET_VALUES from `POST /api/v1/tags/write`: the per-tag results are returned to the caller. With no ACK in time, every tag is reported `accepted: false, rejection_code: "TIMEOUT"`. Accepted values, and every value of a command that timed out, are stored in `commanded_setpoints` for the post-CONFIRM Set push (Section 6.3); a rejected value is not stored.
-   The post-CONFIRM Set push: ACK awaited for 1 second; no ACK in time makes the backend send REHANDSHAKE (Section 7.5).
-   RESET and custom commands sent through `POST /api/v1/commands`: no ACK in time gives `TIMEOUT` (HTTP 504); an `error` field or any `accepted: false` result gives `COMMAND_REJECTED`.
-   REQUEST_SNAPSHOT and the broadcast RESET from `POST /api/v1/reset` are fire-and-forget; their ACKs are ignored.
-   A CMD_ACK whose command_id is not being awaited is ignored.

***NOTE:** Modules must track command_id for the lifetime of the connection and reject duplicate commands with rejection_code: DUPLICATE. The command_id tracking table may be cleared on reconnect. The backend never re-sends a command_id, so QoS1 redelivery is the only source of duplicates. (The MQTT Simulator currently drops duplicates without an ACK instead.)*

  -------------------- ------------------ ----------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Rejection Code**   **Evaluated By**   **Description**

  OUT_OF_RANGE         Embedded module    Value outside permitted engineering limits.

  EXPIRED              Embedded module    Command ts_utc_ms indicates it was issued before the module\'s current time minus an acceptable tolerance. Module evaluates expiry from the command timestamp.

  DUPLICATE            Embedded module    command_id already processed (see note above).

  UNKNOWN_TAG          Embedded module    tag_id not recognized by module.

  MODULE_FAULT         Embedded module    Module in fault state.

  NOT_AUTHORIZED       Backend            User role does not permit this command (never sent to module). Not yet produced --- HMI authentication is not built.

  TIMEOUT              Backend            No CMD_ACK within 1 second (never sent to module).

  MODULE_TYPE_NOT_SUPPORTED Backend       The tag's module has a module_type other than MQTT or HMI (never sent to module).
  -------------------- ------------------ ----------------------------------------------------------------------------------------------------------------------------------------------------------------

**6.3 Set Push after CONFIRM**

The backend keeps the last commanded value of every Set in `commanded_setpoints` (one row per tag; CARO_DB_Spec §7.2). A value is stored when a module ACKs it `accepted: true`, or when its SET_VALUES times out (the module may have applied it, and it remains the operator's intent); a rejected value is not stored. A Set with no row, or with a `null` row, is unpopulated.

After every CONFIRM (Section 7) the backend sends the module **every** one of its Sets as one SET_VALUES --- `null` for an unpopulated one --- waits 1 second for the ACK, and sends REQUEST_SNAPSHOT immediately after the SET_VALUES. This is the only way the backend delivers stored values: there is no re-delivery on backend startup or on watchdog recovery. A module that restarted or lost power gets its last commanded values from the handshake it requests on reconnect.

Modules must accept a SET_VALUES at any time after binding, including one that repeats values they already hold and one that carries `null`.

**7. Module Handshake**

***NOTE:** Implemented (Section 7.5) except module identity verification (Section 7.3): the `commissioned_modules` table does not exist yet, so every request from an MQTT-type registry module is answered. The MQTT Simulator does not implement the module side (`Docs/platform/platform_todo.md`).*

Every bind starts with the module. A module requests a handshake on start-up, after every reconnect, when the backend heartbeat stops (Section 5.3), and when the backend sends REHANDSHAKE. The backend never sends a TAG_LIST unprompted. The module treats each TAG_LIST as the authoritative tag_id mapping, keeps its previous binding (and keeps publishing on the previous ids) until a new TAG_LIST arrives, and accepts a TAG_LIST at any time.

Handshake topics, each named for its publisher:

-   caro/{module_id}/handshake_backend --- backend → module: TAG_LIST, REHANDSHAKE (QoS1, TLS)

-   caro/{module_id}/handshake_module --- module → backend: HANDSHAKE_REQUEST, CONFIRM (QoS1, TLS)

**7.1 Handshake Sequence**

| Step | Direction | message_type | Content |
|---|---|---|---|
| 1 | Module → Backend | HANDSHAKE_REQUEST | Module identity: `module_id`, `instance_id`, `ip`, `fw_hash`, `tag_registry_template`, `tag_registry_rev`. Repeated about every 1 s until a TAG_LIST arrives. |
| 2 | Backend → Module | TAG_LIST | Every tag of this module instance as { tag_id (uint32), tag_name (module-relative, 7.4), is_setpoint (bool) }, in one message. |
| 3 | Module → Backend | CONFIRM | The binding result: `missing_ids` and `unknown_tags` (arrays of names), optional `truncated`. |
| 4 | Backend → Module | SET_VALUES, then REQUEST_SNAPSHOT | Every Set from the store, `null` for unpopulated (Section 6.3); then a full snapshot. |

Each TAG_LIST produces one CONFIRM. A TAG_LIST the module rejects (malformed, an entry missing `is_setpoint`, or larger than its receive buffer) produces no CONFIRM and leaves the previous binding in place.

**7.2 Handshake Message Envelope and Examples**

All handshake messages share the envelope `{ "message_type", "ts_utc_ms", "payload" }`. `ts_utc_ms` is an integer (0 from a module whose clock is not synced); a handshake message does not expire.

HANDSHAKE_REQUEST (Step 1, module → backend):

```json
{ "message_type": "HANDSHAKE_REQUEST", "ts_utc_ms": 1792298629792,
  "payload": { "module_id": "RF1", "instance_id": "66:1e:98:49:6d:87", "ip": "10.0.0.133",
               "fw_hash": "sha256:6e48e7f3…", "tag_registry_template": "Narya_RF", "tag_registry_rev": 3 } }
```

`fw_hash` is `sha256:` plus 64 lowercase hex digits of the running image, or `"Firmware_Hash_Not_Available"`. `tag_registry_template` and `tag_registry_rev` name the Tag Registry template and revision the module's tag definitions were generated from. `instance_id` and `ip` are opaque host strings (RF_Control derives `instance_id` from a MAC address that is random per boot). Strings are at most 127 bytes.

TAG_LIST (Step 2, backend → module):

```json
{ "message_type": "TAG_LIST", "ts_utc_ms": 1743073812000,
  "payload": { "tags": [ { "tag_id": 1023, "tag_name": "Freq.Set", "is_setpoint": true },
                         { "tag_id": 1024, "tag_name": "Freq.Mon", "is_setpoint": false } ] } }
```

`is_setpoint` is required: it is the module's only run-time source for whether a tag is a Set. A list takes about 65 bytes per tag (RF1's 225 tags are 14 402 bytes), and the whole list must fit the module's MQTT receive buffer and inbound queue (RF_Control: 32 KB each). The module matches each `tag_name` case-insensitively against its compiled names; a name over 63 bytes matches nothing.

CONFIRM (Step 3, module → backend):

```json
{ "message_type": "CONFIRM", "ts_utc_ms": 1743073812150,
  "payload": { "unknown_tags": [ "Legacy.Phase_Gain" ], "missing_ids": [ "Phase.Step_Mask" ], "truncated": true } }
```

-   `missing_ids`: names of firmware tags absent from the list. Fatal on the module: it never becomes ready while any is missing.
-   `unknown_tags`: names in the list that the firmware lacks, plus the later entry of a duplicate tag_id or name. Reported only.
-   `truncated: true` appears only when the arrays did not fit the module's transmit buffer.

A well-formed list that matches no firmware tag still gets a CONFIRM; the module is then bound, not ready, and publishes empty telemetry.

REHANDSHAKE (backend → module):

```json
{ "message_type": "REHANDSHAKE", "ts_utc_ms": 1743073812000 }
```

A bound module answers it with a HANDSHAKE_REQUEST and keeps its binding meanwhile; an unbound module ignores it, since it is requesting already. There is no other acknowledgement.

**7.3 Identity Verification**

***NOTE:** Not yet implemented: the backend accepts every request. Target design below.*

On a HANDSHAKE_REQUEST the backend compares the request's `fw_hash` and `tag_registry_template` with what the `commissioned_modules` table expects for the module, before sending a TAG_LIST. `tag_registry_rev` is reserved for a later verification step, because the Tag Registry has no per-template revision yet (Open Questions). During commissioning the received identity is stored as the expected baseline; on later requests a mismatch raises a System Alarm and the module is not bound normally (Open Questions: withhold the TAG_LIST, or only the Set push).

The backend does not compute these values; it only compares what the module reports with the stored baseline.

**7.4 Module-Relative tag_name**

Each TAG_LIST entry identifies its tag by a module-relative tag_name, not by tag_path. The tag_name is the dot-joined asset_names of the levels below the module level whose In_Tag_Name field is true. The module level itself is never included, even when the module instance's In_Tag_Name is true. Organizational levels with In_Tag_Name false are omitted.

Example: a tag with full path Narya1.RF1.Pwr_Mon.Mag_1.Fwd.Gain, where Pwr_Mon has In_Tag_Name false, has registry tag_name RF1.Mag_1.Fwd.Gain. It is delivered to the RF1 module as Mag_1.Fwd.Gain.

This is the same string the Tag Registry's "Generate Tag Defs" export emits per module template (tag_registry_spec §12.1), which is what the module's compiled definitions are generated from. Both use one function, `moduleRelativeTagName()` in `@caro/tag-registry-shared`, so the two cannot drift apart. Module-relative tag_names are therefore non-empty and unique within a module, compared case-insensitively. The Tag Registry export refuses a template that violates this. The module uses tag_id for all wire communication; tag_name is used only to bind ids during the handshake, and for local logging and diagnostics.

**7.5 Backend Behaviour (as built)**

-   **Answering requests.** The backend subscribes to `caro/+/handshake_module` and answers every HANDSHAKE_REQUEST, repeats included, with a TAG_LIST built from the Tag Registry as loaded at backend startup: the module's tags, ordered by tag_id. It ignores, logging once per module, a request whose payload `module_id` differs from the topic, one from a module that is not an MQTT-type module in the registry, and one from a module with no tags (an empty list would bind the module with nothing).
-   **CONFIRM.** Accepted only after a TAG_LIST was sent to that module; it answers that TAG_LIST, so a second CONFIRM needs a new request. The backend logs `missing_ids`, `unknown_tags` and `truncated`, then performs Step 4.
-   **Heartbeat.** Sent to every MQTT-type module from broker connect and never withheld. A backend restart shorter than a module's beat timeout would go unnoticed by the module, so on every broker connect the backend sends REHANDSHAKE to every MQTT-type module.
-   **Push timeout.** A Set push with no ACK within 1 second makes the backend send REHANDSHAKE, at most 3 times in a row per module; an acknowledged push resets the count.
-   **Registry changes.** The Tag Registry is read at backend startup only, so a registry change takes effect after a controlled backend restart, which re-binds every module through the REHANDSHAKE sent on connect.

Module behaviour the backend relies on: an unbound module publishes no telemetry and rejects every SET_VALUES id as `UNKNOWN_TAG`; telemetry is change-only and binding never triggers a full publish (hence the REQUEST_SNAPSHOT in Step 4); a Set keeps its populated state across a re-bind only if it keeps the same tag_id.


**Appendix A: Protobuf Schema Reference**

The authoritative Protobuf schema for all telemetry messages is located at:

packages/proto/tag.proto

This file is version-controlled in the CARO_Platform monorepo and is the single source of truth for all apps and firmware. Do not duplicate the schema under individual app directories.

The schema is hardcoded in module firmware. It is not delivered over the wire during the handshake sequence.

**Message structure (current version):** `TelemetryMessage { uint64 timestamp = 1; string status = 2; repeated TagSample tags = 3; }`, where `TagSample { uint32 tag_id = 1; TagValue value = 2; }` and `TagValue` is a `oneof` over the fields below. Unlike the JSON format, a Protobuf tag value cannot be null; a `TagSample` with no `TagValue` field set is the only way to express "no value".

**Schema notes (current version):**
- `TagValue.float_value` (field 1) is encoded as `float` (IEEE 754 single-precision, 4 bytes) — not `double`. This matches the `f32` data type in the tag registry.
- `TagValue.bool_value` (field 3) is encoded as `bool` (1 byte). This matches the `bool` data type in the tag registry.
- `TagValue.int_value` (field 4) is encoded as `int32`. It carries both the `i16` and `i32` data types in the tag registry. Protobuf has no int16 wire type; int32 is used for both, and the simulator clamps `i16` values to the i16 range (−32768 to 32767) and `i32` values to ±2³¹. No proto change was needed for `i32`.
- Field 2 is unused (reserved).
- `TagValue.string_value` (field 5) is encoded as `string`. Used for `string` data type tags.
- `TagValue.float_array_value` (field 6) is encoded as `FloatArray` — a wrapper message `{ repeated float values = 1; }`. Used for `f32[]` data type tags.
- `TagValue.int_array_value` (field 7) is encoded as `Int32Array` — a wrapper message `{ repeated int32 values = 1; }`. Used for `i16[]` data type tags; values are clamped to the i16 range by the simulator.

## Open Questions

- What is the final heartbeat interval and watchdog timeout value? (Current defaults: 1000 ms each --- `HEARTBEAT_INTERVAL_MS`, `WATCHDOG_TIMEOUT_MS`.)
- What does the backend compare `fw_hash`, `tag_registry_template` and `tag_registry_rev` against, and when is `tag_registry_rev` verified? The Tag Registry has no per-template revision yet, and the database `registry_rev` changes on any apply and is numbered per database.
- What is the correct behavior on an identity mismatch — withhold the TAG_LIST, or bind but withhold the Set push? Requires HSE input.
- `OUT_OF_RANGE` is listed as evaluated by the module (Section 6.2), but the module library never range-checks. Which side owns range checks?
- There is no rejection code for a SET_VALUES value of the wrong JSON kind; the module library uses `UNKNOWN_TAG`. Add a code?
- What is the MQTT topic ACL policy and per-module credential provisioning strategy? Requires IT Security and firmware engineering input.
- When will the backend decode Protobuf telemetry, and how does it tell the encodings apart (per-module setting, payload sniffing, or a separate topic)?
- What additional fields beyond timestamp should the backend heartbeat include?
