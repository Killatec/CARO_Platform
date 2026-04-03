**CARO_MQTT_Spec**

MQTT Interface Specification

*Version 1.8*

Date: 2026-03-27

**Companion Documents**

CARO_HMI Functional Spec v2.3 \| CARO_HMI API Spec v1.3 \| CARO_DB_Spec v1.0

**Revision History**

  ------------- ------------ ------------- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Version**   **Date**     **Author**    **Summary**

  1.0           2026-03-24   PM / Claude   Initial release. Extracted from CARO_HMI Functional Spec v1.5.

  1.1           2026-03-24   PM / Claude   OI-05 resolved --- SCHEMA payload format defined as base64-encoded .proto text.

  1.2           2026-03-26   PM / Claude   SET_TAG renamed to SET_VALUES. Command payload now carries a values array. CMD_ACK updated to per-tag results array.

  1.3           2026-03-26   PM / Claude   Companion documents updated to include CARO_DB_Spec v1.0 and updated companion spec versions.

  1.4           2026-03-26   PM / Claude   QoS strategy rationale documented. Retained messages explicitly prohibited. cleanSession=true policy defined. NTP synchronization requirement added.

  1.5           2026-03-27   PM / Claude   Broker credentials provisioning note removed. Section 4 updated for Protobuf and JSON encoding modes. Delta empty-tags note added. Status/heartbeat direction corrected. INTERLOCKED rejection code removed. Handshake SCHEMA/SCHEMA_ACK steps removed. Hash validation updated. Appendix A replaced with schema reference.

  1.6           2026-03-27   PM / Claude   Terminology: all references to \'device\' replaced with \'module\', device_id replaced with module_id throughout. Sections 5.1/5.3 reordered. Command envelope simplified. Section 7.3 updated.

  1.7           2026-03-27   PM / Claude   EXPIRED rejection code corrected: evaluated by embedded module from cmd ts_utc_ms. MQTT connection policy added (Section 2.1). Time synchronization requirement added (Section 2.2). Reconnect and handshake sequence policy added. TAG_LIST and CONFIRM message examples added. LWT recommendation added. Duplicate command_id handling note added. Telemetry publish rate guidance added.

  1.8           2026-03-27   PM / Claude   Status/heartbeat topic row removed from Section 3 topic table. Section 5.3 (Status/Heartbeat) removed; backend heartbeat moved to new Section 5.3 (Backend Heartbeat). LWT references removed. Section 5.1 JSON format updated: status field added (ONLINE \| FAULT). Section 5.2 Protobuf format updated: legacy wrapper/DELTA language removed; payload described as directly mirroring JSON structure encoded per Protobuf schema.
  ------------- ------------ ------------- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**1. Purpose**

This document defines the MQTT interface between the CARO_HMI backend and embedded modules. It is the authoritative ICD (Interface Control Document) for embedded firmware engineers implementing module-side MQTT communication.

The CARO_HMI backend is the sole MQTT client on the broker side --- it subscribes to module telemetry and publishes commands. Embedded modules subscribe to command and handshake topics and publish telemetry and acknowledgements.

For HMI system architecture, user roles, tag data model, WebSocket API, and REST API --- see CARO_HMI Functional Specification v2.3.

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

-   Protobuf (default, production): Protocol Buffers binary encoding. The authoritative schema is located at packages/proto/tag.proto in the CARO_Platform monorepo. See Appendix A for the reference location.

-   JSON (development / simulator only): A plain JSON payload mirroring the Protobuf telemetry message structure, using native JS types for tag values. This mode is not defined for production use. See Section 5.1 for the JSON format.

All other channels (commands, handshake, acknowledgements) use JSON encoding. Bandwidth optimization is not required for these low-frequency channels.

***NOTE:** Unknown Protobuf fields are silently ignored (proto3 forward-compatibility). The schema is hardcoded in module firmware and sourced from packages/proto/tag.proto --- it is not delivered over the wire during the handshake.*

**5. Telemetry Channel**

The single telemetry topic caro/{module_id}/telemetry carries module-to-backend tag value updates using Protobuf encoding (or JSON in development mode --- see Section 4). The backend watchdog monitors telemetry continuity --- loss of telemetry from a module triggers quality=bad for all of that module\'s tags in the Last-Known-Value cache. The channel operates in two modes:

  -------------------- ------------------------------------------------------------------------------------------------- ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Mode**             **Trigger**                                                                                       **Content**

  Full snapshot        Module receives REQUEST_SNAPSHOT command from backend (on backend startup or module reconnect).   Module publishes all its current tag values. The backend uses these to fully populate the Last-Known-Value cache and transition all tags for this module to quality=good.

  Change-only update   Normal operation at module publish rate.                                                          Module publishes only tag values that have changed since the last publish cycle. If no tags have changed, the module still publishes a message with the current timestamp and an empty tags array.
  -------------------- ------------------------------------------------------------------------------------------------- ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

***NOTE:** There is no separate MQTT topic for full snapshots vs change-only updates. The message structure is identical in both modes. The backend distinguishes context by whether a REQUEST_SNAPSHOT command was recently sent to that module.*

Recommended telemetry publish rate: 100--500 ms (2--10 Hz). The final value is TBD (see OI-01) but firmware teams should size buffers and DMA transfers accordingly. The default in the MQTT simulator is 100 ms (10 Hz).

**5.1 JSON Telemetry Format**

When operating in JSON mode (development / simulator only), the module publishes a plain JSON payload to caro/{module_id}/telemetry instead of a Protobuf binary:

{

\"timestamp\": 1743073812000,

\"status\": \"ONLINE\" \| \"FAULT\",

\"tags\": \[

{ \"tag_id\": 1003, \"value\": 62.34 },

{ \"tag_id\": 1004, \"value\": true },

{ \"tag_id\": 1005, \"value\": 12 },

{ \"tag_id\": 1006, \"value\": \"sim\" }

\]

}

***NOTE:** JSON mode is a development convenience feature. The production HMI backend always expects Protobuf encoding.*

**5.2 Protobuf Telemetry Format**

The Protobuf telemetry payload directly mirrors the JSON format defined in Section 5.1 --- it carries the same fields (timestamp, status, and tags array) encoded per the schema at packages/proto/tag.proto. There is no outer message wrapper or type discriminator field.

When operating in change-only mode with no tag changes on a given tick, the module still publishes a message with the current timestamp, current status, and an empty tags array. See Appendix A for the schema reference.

**5.3 Backend Heartbeat**

The backend publishes a heartbeat to each module on caro/{module_id}/beat at a regular interval (final value TBD --- see OI-07). Modules use this to detect loss of communication with the backend. Backend heartbeat payload:

{

\"ts_utc_ms\": \<timestamp\>

}

***NOTE:** Backend heartbeat format is currently timestamp-only. Additional fields TBD --- see OI-07.*

**6. Command Channel**

The backend publishes commands to caro/{module_id}/cmd (QoS1, TLS). All commands share a common envelope with a command_type field and a generic payload object whose contents vary by command type.

**6.1 Command Envelope**

{

\"command_id\": \"\<UUID4\>\",

\"command_type\": \"REQUEST_SNAPSHOT\" \| \"SET_VALUES\" \| \"RESET\",

\"ts_utc_ms\": \<timestamp\>,

\"payload\": {

\"values\": \[

{ \"tag_id\": \<uint32\>, \"value\": \<typed\> }

\]

}

}

***NOTE:** payload.values is only present for SET_VALUES commands. REQUEST_SNAPSHOT and RESET have an empty payload object.*

  ------------------ ------------------------------------------------------------------------------ ------------------------------------------------------------------------------------------------------------------------------------------------
  **command_type**   **payload contents**                                                           **Description**

  REQUEST_SNAPSHOT   {}                                                                             Backend requests module to publish all current tag values via the telemetry channel. Sent on backend startup and module reconnect.

  SET_VALUES         { \"values\": \[ { \"tag_id\": \<uint32\>, \"value\": \<typed\> }, \... \] }   Write one or more setpoint values. Always an array --- single writes are a batch of one. The backend sends only tags belonging to this module.

  RESET              {}                                                                             Request module soft reset. Exact behavior is firmware-defined.
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

***NOTE:** For REQUEST_SNAPSHOT and RESET commands, results is omitted or an empty array --- acceptance is implicit if the module responds at all.*

***NOTE:** Modules must track command_id for the lifetime of the connection and reject duplicate commands with rejection_code: DUPLICATE. The command_id tracking table may be cleared on reconnect.*

  -------------------- ------------------ ----------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Rejection Code**   **Evaluated By**   **Description**

  OUT_OF_RANGE         Embedded module    Value outside permitted engineering limits.

  EXPIRED              Embedded module    Command ts_utc_ms indicates it was issued before the module\'s current time minus an acceptable tolerance. Module evaluates expiry from the command timestamp.

  DUPLICATE            Backend            command_id already processed.

  UNKNOWN_TAG          Embedded module    tag_id not recognized by module.

  MODULE_FAULT         Embedded module    Module in fault state.

  NOT_AUTHORIZED       Backend            User role does not permit this command (never sent to module).
  -------------------- ------------------ ----------------------------------------------------------------------------------------------------------------------------------------------------------------

**7. Module Handshake**

The handshake is executed by the backend for each commissioned module instance on backend startup and on every module reconnect. On every reconnect (including after broker loss), the backend will re-execute the full handshake sequence before sending any commands. The module shall treat each handshake as the authoritative source of its current tag_id mapping and must be prepared to receive a new TAG_LIST on any reconnect.

Handshake topics:

-   caro/{module_id}/handshake --- backend → module (QoS1, TLS)

-   caro/{module_id}/handshake_ack --- module → backend (QoS1, TLS)

**7.1 Handshake Sequence**

  ---------- ------------------ ------------------ --------------------------------------------------------------------------------------------------------------------------------------
  **Step**   **Direction**      **message_type**   **Content**

  1          Backend → Module   TAG_LIST           List of { tag_id (uint32), tag_path (string, truncated below module level) } for all tags belonging to this module instance.

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

{ \"tag_id\": 1001, \"tag_path\": \"RF_Fwd.setpoint\" },

{ \"tag_id\": 1002, \"tag_path\": \"RF_Fwd.readback\" },

{ \"tag_id\": 1003, \"tag_path\": \"RF_Rfl.readback\" }

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

During module commissioning, the received hashes are stored as the expected baseline in the commissioned_modules table. On all subsequent connections, hashes are compared against the stored baseline. A mismatch raises a System Alarm (behavior TBD --- see OI-03).

***NOTE:** Both hashes are computed entirely on the module from its compiled firmware definitions. The backend does not independently compute or verify these hashes --- it only compares the received values against the stored baseline.*

**7.4 tag_path Truncation**

The tag_path delivered in the TAG_LIST message is truncated to remove the root-to-module prefix. Only the path below the module level is included.

Example: a tag with full path Plant1_System_A.RFPowerModule.RF_Fwd.setpoint is delivered to the RFPowerModule module as RF_Fwd.setpoint. The module uses tag_id for all wire communication; tag_path is used for local logging and diagnostics only.

**8. Open Items**

  -------- ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- ---------------------- -------------- ---------------
  **\#**   **Issue**                                                                                                                                                                                             **Owner**              **Priority**   **Target**

  OI-01    Define heartbeat interval and watchdog timeout final values.                                                                                                                                          FW Eng / Backend       Medium         v1.9

  OI-02    Define hash algorithm and canonical serialization format for fw_hash and tag_config_hash --- must be agreed between firmware team and backend.                                                        Backend / FW Eng       High           v1.9

  OI-03    Define hash mismatch behavior --- whether mismatches fully block the module or put it in a flagged/degraded state. Decision requires HSE and process engineering input.                               PM / HSE               High           v1.9

  OI-04    Define MQTT topic ACL policy and per-module credential provisioning process.                                                                                                                          IT Security / FW Eng   High           v1.9

  OI-05    RESOLVED --- SCHEMA payload format defined as base64-encoded .proto text. Schema delivery via handshake removed in v1.5; schema is hardcoded in firmware and sourced from packages/proto/tag.proto.   ---                    ---            Resolved v1.5

  OI-06    Define module reconnect behavior --- should the backend re-deliver pending setpoint values that were sent while the module was offline?                                                               Backend / FW Eng       Medium         v1.9

  OI-07    Define backend heartbeat interval and confirm whether additional fields beyond ts_utc_ms are required.                                                                                                Backend / FW Eng       Low            v1.9
  -------- ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- ---------------------- -------------- ---------------

**Appendix A: Protobuf Schema Reference**

The authoritative Protobuf schema for all telemetry messages is located at:

packages/proto/tag.proto

This file is version-controlled in the CARO_Platform monorepo and is the single source of truth for all apps and firmware. Do not duplicate the schema under individual app directories.

The schema is hardcoded in module firmware. It is not delivered over the wire during the handshake sequence.
