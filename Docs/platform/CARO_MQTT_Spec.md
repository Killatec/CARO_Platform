**CARO_MQTT_Spec**

MQTT Interface Specification

Date: 2026-10-17

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
  2.0           2026-10-17   PM / Claude   Reconciled against the implementation. New Section 1.1 Implementation Status. Sections 4/5: the backend currently decodes JSON telemetry only; backend handling of each telemetry field and REQUEST_SNAPSHOT triggers stated as built. Section 6: custom command types, optional top-level CMD_ACK error field, backend ACK handling (1 s timeout), backend-generated rejection codes (TIMEOUT, MODULE_TYPE_NOT_SUPPORTED), DUPLICATE marked module-evaluated. New Section 6.3 Setpoint Re-delivery. Section 7 marked not yet implemented. Open Questions updated.
  ------------- ------------ ------------- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**1. Purpose**

This document defines the MQTT interface between the CARO_HMI backend and embedded modules. It is the authoritative ICD (Interface Control Document) for embedded firmware engineers implementing module-side MQTT communication.

The CARO_HMI backend is the sole MQTT client on the broker side --- it subscribes to module telemetry and publishes commands. Embedded modules subscribe to command and handshake topics and publish telemetry and acknowledgements.

For HMI system architecture, user roles, tag data model, WebSocket API, and REST API --- see hmi_functional_spec. For what the backend does with each message once received (Last-Known-Value cache, watchdog, historian, WebSocket), see `Docs/platform/CARO_Telemetry_Path_Reference.md`.

**1.1 Implementation Status (as of 2026-10-17)**

This document is the target contract, and not all of it is built yet. Firmware written today must work with what the current backend (`apps/caro-hmi/server`) actually does:

| Area | Spec section | Backend (caro-hmi) | MQTT Simulator |
|---|---|---|---|
| Broker TLS, client certificates, ACLs, anonymous rejection | 2 | **Not implemented.** Plain `mqtt://` from `MQTT_URL`, anonymous, no TLS options. | Same — anonymous `mqtt://`. |
| cleanSession, no retained messages | 2.1 | mqtt.js defaults (clean session, MQTT 3.1.1); never sets `retain`. On every reconnect it re-subscribes and re-sends REQUEST_SNAPSHOT. | `clean: true`, `retain: false`, reconnect every 2 s. |
| Telemetry, JSON encoding | 5.1 | **Implemented — the only encoding the backend accepts.** | Default. |
| Telemetry, Protobuf encoding | 4, 5.2 | **Not implemented.** The bridge only `JSON.parse`s telemetry; a Protobuf payload fails to parse and is silently dropped. | Encodes per `tag.proto` (per-module toggle), but the HMI cannot read it. |
| Backend heartbeat `/beat` | 5.3 | Implemented: `{ ts_utc_ms }`, QoS0, every `HEARTBEAT_INTERVAL_MS` (default 1000 ms), to MQTT-type modules only. | Not subscribed. |
| Watchdog | 5 | Implemented: `WATCHDOG_TIMEOUT_MS` (default 1000 ms), checked every `min(timeout, 500)` ms. | n/a |
| REQUEST_SNAPSHOT | 5, 6.1 | Implemented; ACK not awaited. | Publishes a full snapshot immediately. |
| SET_VALUES + per-tag CMD_ACK results | 6.1, 6.2 | Implemented, 1 s ACK timeout. | Implemented. |
| RESET | 6.1 | Sent to every module by `POST /api/v1/reset`, or to one module by `POST /api/v1/commands`. | Increments the module's `Reset_Count` tag. |
| Custom command types | 6.1 | Implemented via `POST /api/v1/commands` (e.g. `Stop_App`, `Home`). | ACKed with empty results; no other effect. |
| Setpoint re-delivery | 6.3 | Implemented. | Accepts it like any SET_VALUES. |
| DUPLICATE rejection | 6.2 | n/a — the backend never re-sends a command_id. | Duplicates within 60 s are **dropped without an ACK**. |
| EXPIRED evaluation | 6.2 | n/a (module-side). | Not implemented. |
| Handshake (TAG_LIST / CONFIRM), hash validation | 7 | **Not implemented.** No handshake topic is published or subscribed. | Not implemented. |

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

***NOTE:** Because cleanSession=true is required, modules must re-subscribe to all relevant topics on every reconnect. The backend will re-execute the full handshake sequence after every reconnect --- see Section 7.*

**2.2 Time Synchronization**

Modules shall maintain UTC time synchronized to within ±2 seconds. Acceptable synchronization sources include NTP, GPS, RTC, or the backend /beat topic timestamp as a reference. Accurate timestamps are required for:

-   EXPIRED rejection code evaluation --- modules compare command ts_utc_ms against their local UTC clock.

-   Telemetry timestamp accuracy --- all tag timestamps are module-generated UTC milliseconds.

-   Handshake and heartbeat timestamp fields.

***NOTE:** If a module cannot guarantee time synchronization at startup, it should defer EXPIRED evaluation and log a warning.*

**3. Topic Structure**

All topics follow the pattern: caro/{module_id}/{channel}

module_id is the module asset_name as defined in the Tag Registry --- it must match exactly.

  --------------------------- -------------------------------- --------------- ---------------- --------- ---------
  **Purpose**                 **Topic**                        **Publisher**   **Subscriber**   **QoS**   **TLS**

  Telemetry                   caro/{module_id}/telemetry       Module          Backend          QoS0      No

  Backend heartbeat           caro/{module_id}/beat            Backend         Module           QoS0      No

  Command                     caro/{module_id}/cmd             Backend         Module           QoS1      Yes

  Command acknowledgement     caro/{module_id}/cmd_ack         Module          Backend          QoS1      Yes

  Handshake                   caro/{module_id}/handshake       Backend         Module           QoS1      Yes

  Handshake acknowledgement   caro/{module_id}/handshake_ack   Module          Backend          QoS1      Yes
  --------------------------- -------------------------------- --------------- ---------------- --------- ---------

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

  Full snapshot        Module receives REQUEST_SNAPSHOT command from backend (on backend startup or module reconnect).   Module publishes all its current tag values. The backend uses these to fully populate the Last-Known-Value cache and transition all tags for this module to quality=good.

  Change-only update   Normal operation at module publish rate.                                                          Module publishes only tag values that have changed since the last publish cycle. If no tags have changed, the module still publishes a message with the current timestamp and an empty tags array.
  -------------------- ------------------------------------------------------------------------------------------------- ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

***NOTE:** There is no separate MQTT topic for full snapshots vs change-only updates. The message structure is identical in both modes, and the backend processes every telemetry message the same way: each tag value is written to the Last-Known-Value cache, so a full snapshot simply refreshes every tag. The backend does not track whether a REQUEST_SNAPSHOT is outstanding.*

The backend sends REQUEST_SNAPSHOT to MQTT-type modules (modules whose tags have `module_type = 'MQTT'` in the Tag Registry):

-   to every MQTT-type module on every broker connect, including each automatic reconnect;
-   to one module when the watchdog sees it recover (stalled, then receiving telemetry again), followed by a setpoint re-delivery (Section 6.3).

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

***NOTE:** Backend heartbeat format is timestamp-only. The backend publishes it at QoS0 every `HEARTBEAT_INTERVAL_MS` (default 1000 ms) to every MQTT-type module, starting on broker connect.*

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

  REQUEST_SNAPSHOT   {}                                                                             Backend requests module to publish all current tag values via the telemetry channel. Sent on backend startup and module reconnect.

  SET_VALUES         { \"values\": \[ { \"tag_id\": \<uint32\>, \"value\": \<typed\> }, \... \] }   Write one or more setpoint values. Always an array --- single writes are a batch of one. The backend sends only tags belonging to this module.

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

-   SET_VALUES: the per-tag results are returned to the caller. With no ACK in time, every tag is reported `accepted: false, rejection_code: "TIMEOUT"`. Accepted values are stored for re-delivery (Section 6.3).
-   RESET and custom commands sent through `POST /api/v1/commands`: no ACK in time gives `TIMEOUT` (HTTP 504); an `error` field or any `accepted: false` result gives `COMMAND_REJECTED`.
-   REQUEST_SNAPSHOT, the broadcast RESET from `POST /api/v1/reset`, and setpoint re-delivery are fire-and-forget; their ACKs are ignored.
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

**6.3 Setpoint Re-delivery**

Every SET_VALUES value a module accepts is stored by the backend in `pending_setpoint_values` (one row per tag). The backend re-publishes the stored values for a module as one SET_VALUES command, without awaiting its ACK:

-   on backend startup, once connected to the broker, for every MQTT-type module;
-   when the watchdog sees a stalled module recover.

This returns a module that restarted or lost power to its last commanded values. Modules must therefore accept a SET_VALUES at any time after connecting, including one that repeats values they already hold.

**7. Module Handshake**

***NOTE:** Not yet implemented --- the backend neither publishes TAG_LIST nor subscribes to handshake_ack, and the `commissioned_modules` table does not exist yet. Modules currently use the tag_ids from their generated definitions directly. This section is the target design.*

The handshake is executed by the backend for each commissioned module instance on backend startup and on every module reconnect. On every reconnect (including after broker loss), the backend will re-execute the full handshake sequence before sending any commands. The module shall treat each handshake as the authoritative source of its current tag_id mapping and must be prepared to receive a new TAG_LIST on any reconnect.

Handshake topics:

-   caro/{module_id}/handshake --- backend → module (QoS1, TLS)

-   caro/{module_id}/handshake_ack --- module → backend (QoS1, TLS)

**7.1 Handshake Sequence**

  ---------- ------------------ ------------------ --------------------------------------------------------------------------------------------------------------------------------------
  **Step**   **Direction**      **message_type**   **Content**

  1          Backend → Module   TAG_LIST           List of { tag_id (uint32), tag_name (string, module-relative --- see 7.4) } for all tags belonging to this module instance.

  2          Module → Backend   CONFIRM            { fw_hash, tag_config_hash } --- both computed from the module\'s own compiled firmware definitions, not from the received tag list.
  ---------- ------------------ ------------------ --------------------------------------------------------------------------------------------------------------------------------------

**7.2 Handshake Message Envelope and Examples**

All handshake messages share the following envelope:

{

\"message_type\": \"TAG_LIST\" \| \"CONFIRM\",

\"ts_utc_ms\": \<timestamp\>,

\"payload\": { \... }

}

TAG_LIST example (Step 1 --- Backend → Module):

{

\"message_type\": \"TAG_LIST\",

\"ts_utc_ms\": 1743073812000,

\"payload\": {

\"tags\": \[

{ \"tag_id\": 1001, \"tag_name\": \"RF_Fwd.setpoint\" },

{ \"tag_id\": 1002, \"tag_name\": \"RF_Fwd.readback\" },

{ \"tag_id\": 1003, \"tag_name\": \"RF_Rfl.readback\" }

\]

}

}

CONFIRM example (Step 2 --- Module → Backend):

{

\"message_type\": \"CONFIRM\",

\"ts_utc_ms\": 1743073812150,

\"payload\": {

\"fw_hash\": \"a3f8c2d1e9b047\...\",

\"tag_config_hash\": \"7b14e8f3c2a091\...\"

}

}

**7.3 Hash Validation**

On receipt of the CONFIRM message the backend compares:

-   fw_hash --- received from module vs expected_fw_hash stored in the commissioned_modules table.

-   tag_config_hash --- received from module vs tag_config_hash stored in the commissioned_modules table.

During module commissioning, the received hashes are stored as the expected baseline in the commissioned_modules table. On all subsequent connections, hashes are compared against the stored baseline. A mismatch raises a System Alarm.

***NOTE:** Both hashes are computed entirely on the module from its compiled firmware definitions. The backend does not independently compute or verify these hashes --- it only compares the received values against the stored baseline.*

**7.4 Module-Relative tag_name**

Each TAG_LIST entry identifies its tag by a module-relative tag_name, not by tag_path. The tag_name is the dot-joined asset_names of the levels below the module level whose In_Tag_Name field is true. The module level itself is never included, even when the module instance's In_Tag_Name is true. Organizational levels with In_Tag_Name false are omitted.

Example: a tag with full path Narya1.RF1.Pwr_Mon.Mag_1.Fwd.Gain, where Pwr_Mon has In_Tag_Name false, has registry tag_name RF1.Mag_1.Fwd.Gain. It is delivered to the RF1 module as Mag_1.Fwd.Gain.

This is the same string the Tag Registry's "Generate Tag Defs" export emits per module template (tag_registry_spec §12.1), which is what the module's compiled definitions are generated from. The module matches each received tag_name against those definitions to learn its tag_id. Module-relative tag_names are therefore non-empty and unique within a module, compared case-insensitively. The Tag Registry export refuses a template that violates this. The module uses tag_id for all wire communication; tag_name is used only to bind ids during the handshake, and for local logging and diagnostics.


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
- What hash algorithm and canonical serialization format should be used for `fw_hash` and `tag_config_hash`? Must be agreed between firmware and backend teams.
- What is the correct behavior when a hash mismatch is detected — device blocked or degraded mode? Requires HSE input.
- What is the MQTT topic ACL policy and per-module credential provisioning strategy? Requires IT Security and firmware engineering input.
- When will the backend decode Protobuf telemetry, and how does it tell the encodings apart (per-module setting, payload sniffing, or a separate topic)?
- What additional fields beyond timestamp should the backend heartbeat include?
