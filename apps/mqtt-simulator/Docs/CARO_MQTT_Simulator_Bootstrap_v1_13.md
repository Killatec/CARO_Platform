**CARO_Platform**

**MQTT Simulator Bootstrap**

Version 1.13 \| 2026-03-27

**DEV TOOL ONLY --- NOT FOR PRODUCTION DEPLOYMENT**

**Companion Documents**

CARO_MQTT_Spec v1.7 \| CARO_HMI Functional Spec v2.3 \| CARO_DB_Spec v1.0

**1. Purpose**

This bootstrap document provides everything Claude Code needs to implement the CARO_Platform MQTT Simulator --- a development-only tool that simulates one or more field modules publishing telemetry and responding to commands over MQTT. It eliminates the need for physical hardware during HMI frontend development and testing.

The simulator reads the active tag registry from PostgreSQL at startup, groups tags by module_id, and continuously publishes simulated telemetry at 10 Hz. It responds to SET_VALUES commands with a CMD_ACK.

> **⚠ This tool must never be deployed to a production environment. It is a dev/test tool only.**

**2. Monorepo Position**

> CARO_Platform/
>
> packages/
>
> proto/ ← shared Protobuf schemas
>
> tag.proto ← authoritative telemetry schema
>
> ui/
>
> widgets/
>
> db/
>
> apps/
>
> tag-registry/ ← existing
>
> mqtt-simulator/ ← new (this document)
>
> package.json
>
> src/
>
> index.js ← entry point
>
> registry.js ← reads tag_registry from PostgreSQL
>
> simulator.js ← simulation loop and value generation
>
> mqtt.js ← MQTT client, topic handlers
>
> protobuf.js ← Protobuf encode/decode helpers
>
> control.js ← REST control API server + log buffer
>
> public/
>
> index.html ← simple one-page control frontend
>
> .env.example
>
> README.md
>
> *NOTE: The simulator is a standalone Node.js app --- not part of the npm workspaces packages. It imports \@caro/db for database access.*

**3. Technology Stack**

  ----------------------------------------------------------------------------------------------------------------------------------------------------
  **Concern**       **Choice**         **Notes**
  ----------------- ------------------ ---------------------------------------------------------------------------------------------------------------
  Runtime           Node.js 18+        Same as rest of monorepo.

  MQTT client       mqtt (npm)         Standard MQTT.js library. Same as HMI backend will use.

  Protobuf          protobufjs (npm)   Encode TelemetryMessage for outbound telemetry only. Commands are plain JSON --- no Protobuf decoding needed.

  Database          \@caro/db          Read tag_registry at startup. Same pool used by tag-registry app.

  Language          JavaScript (ESM)   No TypeScript. Consistent with rest of monorepo.

  Process manager   nodemon (dev)      Auto-restart on source change. Watch src/ only.
  ----------------------------------------------------------------------------------------------------------------------------------------------------

**4. Environment Variables**

  ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Variable**         **Default**             **Description**
  -------------------- ----------------------- -------------------------------------------------------------------------------------------------------------------------------------
  MQTT_BROKER_URL      mqtt://localhost:1883   MQTT broker URL. Must match HMI backend broker.

  MQTT_CLIENT_ID       caro-simulator          MQTT client ID. Must be unique on the broker.

  PGHOST               localhost               PostgreSQL host.

  PGPORT               5432                    PostgreSQL port.

  PGDATABASE           caro_dev                PostgreSQL database name.

  PGUSER               postgres                PostgreSQL user.

  PGPASSWORD           (required)              PostgreSQL password. No default.

  TICK_INTERVAL_MS     100                     Telemetry publish interval in milliseconds. Default 100ms = 10 Hz.

  CMD_ACK_DELAY_MS     200                     Simulated delay before publishing CMD_ACK after receiving SET_VALUES.

  SINE_PERIOD_S        30                      Period of the sine wave used for f64/i32 tag simulation in seconds.

  CONTROL_PORT         4000                    Port for the REST control API and frontend. Set to 0 to disable.

  LOG_BUFFER_SIZE      200                     Number of log entries retained in the rolling in-memory log buffer.

  TELEMETRY_ENCODING   protobuf                Initial telemetry encoding mode. Accepts \'protobuf\' or \'json\'. Can be toggled at runtime via the REST API or frontend checkbox.

  REJECT_ALL_WRITES    false                   If true, all SET_VALUES commands are rejected with rejection_code: SIMULATED_REJECTION. Useful for testing OUT_OF_SYNC behavior.
  ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**5. Startup Sequence**

1.  Validate required environment variables (PGPASSWORD). Exit with clear error if missing.

2.  Connect to PostgreSQL via \@caro/db. Query tag_registry for all active non-retired tags (latest registry_rev per tag_id where retired=false).

3.  Build in-memory tag map: Map\<tag_id, TagDef\>. Extract module_id from meta array (first ancestor with type === \'module\').

4.  Group tags by module_id: Map\<module_id, TagDef\[\]\>.

5.  Initialize simulated values for each tag --- see Section 7.

6.  Connect to MQTT broker. Subscribe to caro/+/cmd for all module_ids (SET_VALUES commands).

7.  Start telemetry loop --- see Section 8.

8.  Log startup summary: N modules, M tags total, broker URL, tick interval.

> *NOTE: If the PostgreSQL query returns zero active tags, log a warning and exit. The simulator cannot operate without a populated tag registry. Continuous 10 Hz publishing makes REQUEST_SNAPSHOT unnecessary for development.*

**6. Tag Registry Query**

On startup the simulator queries tag_registry for the latest revision of each active tag:

> SELECT DISTINCT ON (tag_id)
>
> tag_id, tag_path, data_type, is_setpoint, meta
>
> FROM tag_registry
>
> WHERE retired = false
>
> ORDER BY tag_id, registry_rev DESC

module_id is extracted from the meta array --- it is the asset_name of the first ancestor node whose type is \'module\':

> function getModuleId(meta) {
>
> // meta is ordered leaf-to-root (index 0 = tag leaf)
>
> const moduleAncestor = meta.find(m =\> m.type === \'module\');
>
> return moduleAncestor?.name ?? \'unknown\';
>
> }

**7. Simulated Value Generation**

The tag map contains all tags. Monitor tags (is_setpoint=false) have automatically simulated values. Setpoint tags (is_setpoint=true) initialize to type-specific defaults and update only on SET_VALUES receipt. All tags are published on every telemetry tick.

**Monitor tag simulation --- initial values and per-tick update rules by data_type:**

  ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **data_type**    **Initial Value**   **Per-Tick Update**
  ---------------- ------------------- ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  f64              50.0                Sine wave: value = 50 + 25 \* sin(2π \* t / periodMs). Amplitude fixed at 25, average at 50. t increments by TICK_INTERVAL_MS (ms) each tick. periodMs = SINE_PERIOD_S \* 1000.

  i32              50                  Same as f64 but Math.round() applied.

  bool             false               Random toggle: each tick has 0.5% probability of flipping. \~1 toggle per 200 ticks = \~20 seconds at 10 Hz.

  str              \"sim\"             Static value. Never changes.
  ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

Setpoint tags (is_setpoint=true) initialize simValue based on data_type:

-   bool: initialize to false

-   f64, i32: initialize to 0

-   str: initialize to empty string (\"\")

Auto-simulation does not run for setpoint tags. All tags start with simT: 0 --- all f64/i32 monitor tags begin in phase with each other, which is intentional for a dev tool. All tag simulation state is stored in the in-memory tag map:

> {
>
> tag_id: number,
>
> tag_path: string,
>
> data_type: string,
>
> is_setpoint: boolean,
>
> module_id: string,
>
> // simulation state
>
> simValue: any, // monitor: auto-simulated; setpoint: from SET_VALUES or type default
>
> simT: number, // time accumulator for sine wave (monitor f64/i32 only)
>
> overridden: boolean // true if manually overridden via REST control API
>
> }

**8. Telemetry Loop**

A single setInterval runs at TICK_INTERVAL_MS. On each tick:

9.  For each module_id in the active set (simState.activeModules), advance simulated values by one tick (update simValue and simT) for monitor tags (is_setpoint=false) only. Setpoint tags are not auto-simulated. Modules not in the active set are skipped entirely.

10. Build one Protobuf TelemetryMessage per module_id containing all tags for that module.

11. Publish to caro/{module_id}/telemetry with QoS 0, retain: false.

TelemetryMessage structure per CARO_MQTT_Spec v1.7:

> TelemetryMessage {
>
> timestamp: uint64, // Date.now() in ms --- one timestamp per message, not per tag
>
> status: string, // \"ONLINE\" \| \"FAULT\"
>
> tags: \[
>
> {
>
> tag_id: uint32,
>
> value: \<encoded per data_type --- see Section 10\>
>
> }
>
> \]
>
> }
>
> *NOTE: The simulator always publishes all tags for a module on every tick --- not just deltas. The backend\'s LKV logic handles delta detection. This simplifies the simulator significantly.*

Per-module running state is managed via a Set in simState:

> simState.activeModules = new Set(allModuleIds); // all modules active on startup
>
> // POST /telemetry/stop/:module_id
>
> simState.activeModules.delete(module_id);
>
> // POST /telemetry/start/:module_id
>
> simState.activeModules.add(module_id);

**9. Command Handling**

The simulator handles one command type: SET_VALUES. All commands arrive and are responded to as JSON. Protobuf is used for telemetry publishing only.

**9.1 Topic Subscription**

On startup the simulator subscribes to caro/+/cmd with QoS 1. The + wildcard matches all module_ids. The simulator validates that the module_id in the topic matches a known module_id from the tag registry.

**9.2 SET_VALUES**

Incoming SET_VALUES CommandEnvelope shape (JSON):

> {
>
> \"command_id\": \"cmd-abc123\",
>
> \"command_type\": \"SET_VALUES\",
>
> \"values\": \[
>
> { \"tag_id\": 1003, \"value\": 42.5 },
>
> { \"tag_id\": 1004, \"value\": true }
>
> \]
>
> }

When a SET_VALUES command is received:

12. Parse JSON. Validate command_type === \'SET_VALUES\'.

13. For each {tag_id, value} pair in values: validate tag_id exists in the tag map for this module_id. If valid, update simValue to the received value. No type coercion is performed --- the simulator accepts the value as-is. If the tag_id is unknown, mark it as rejected in the CMD_ACK.

14. After CMD_ACK_DELAY_MS, publish CMD_ACK JSON to caro/{module_id}/cmd_ack (QoS 1):

> {
>
> \"command_id\": \"cmd-abc123\",
>
> \"results\": \[
>
> { \"tag_id\": 1003, \"accepted\": true, \"rejection_code\": null },
>
> { \"tag_id\": 1004, \"accepted\": true, \"rejection_code\": null },
>
> { \"tag_id\": 9999, \"accepted\": false, \"rejection_code\": \"UNKNOWN_TAG\" }
>
> \]
>
> }

**10. Protobuf Value Encoding**

Protobuf encoding is used for outbound telemetry only. Commands are plain JSON. Tag values in the TelemetryMessage use the appropriate oneof field per data_type:

  -------------------------------------------------------------------------------
  **data_type**   **Protobuf field**   **JS type**   **Notes**
  --------------- -------------------- ------------- ----------------------------
  f64             float_value          number        IEEE 754 double.

  i32             int_value            number        32-bit signed integer.

  bool            bool_value           boolean       true / false.

  str             string_value         string        UTF-8 string.
  -------------------------------------------------------------------------------

> *NOTE: The authoritative tag.proto schema is located at packages/proto/tag.proto in the CARO_Platform monorepo. The simulator references this shared file directly --- do not duplicate it under apps/mqtt-simulator/.*

Protobuf loading path in src/protobuf.js (ESM):

> // Resolve path from apps/mqtt-simulator/src/ to packages/proto/tag.proto
>
> const protoPath = new URL(\'../../../packages/proto/tag.proto\', import.meta.url).pathname;

**10.1 JSON Telemetry Format**

When TELEMETRY_ENCODING=json the simulator publishes a plain JSON payload to caro/{module_id}/telemetry instead of a Protobuf binary. The JSON structure mirrors the Protobuf TelemetryMessage, using native JS types for tag values:

> {
>
> \"timestamp\": 1743073812000,
>
> \"status\": \"ONLINE\",
>
> \"tags\": \[
>
> { \"tag_id\": 1003, \"value\": 62.34 },
>
> { \"tag_id\": 1004, \"value\": true },
>
> { \"tag_id\": 1005, \"value\": 12 },
>
> { \"tag_id\": 1006, \"value\": \"sim\" }
>
> \]
>
> }
>
> *NOTE: JSON mode is a simulator-only feature for HMI development convenience. It is not defined in CARO_MQTT_Spec. Production HMI backend always expects Protobuf.*

**11. REST Control API**

A lightweight Express server runs alongside the simulator on CONTROL_PORT (default 4000). It exposes simple endpoints for manual control during development and testing, serves the frontend at GET /, and provides the log polling endpoint. All endpoints return JSON.

> **⚠ This API has no authentication. It is accessible to anyone on the network. Use only on a trusted development network.**

All error responses use a consistent shape:

> { \"ok\": false, \"error\": \"descriptive error message\" }

**11.1 Endpoints**

  --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **Method**   **Path**                      **Description**
  ------------ ----------------------------- -------------------------------------------------------------------------------------------------------------------------------------------------------------
  GET          /                             Serves public/index.html --- the one-page control frontend.

  GET          /status                       Returns simulator status: running state, module list, tag count, tick interval, uptime.

  GET          /logs                         Returns the last LOG_BUFFER_SIZE log entries from the rolling in-memory buffer as a JSON array. Each entry: { ts: ISO string, level: string, msg: string }.

  POST         /telemetry/stop               Stops the telemetry loop. Tags stop publishing.

  POST         /telemetry/start              Restarts the telemetry loop if stopped.

  POST         /telemetry/stop/:module_id    Stops telemetry for one module only.

  POST         /telemetry/start/:module_id   Restarts telemetry for one module.

  POST         /override                     Manually set a tag\'s simulated value. Body: { tag_id: number, value: any }.

  POST         /override/clear/:tag_id       Clears a manual override --- tag resumes normal simulation.

  POST         /telemetry/encoding           Sets the telemetry encoding mode. Body: { encoding: \'protobuf\' \| \'json\' }. Takes effect on the next tick.

  POST         /reject/enable                Enables REJECT_ALL_WRITES mode. All subsequent SET_VALUES are rejected.

  POST         /reject/disable               Disables REJECT_ALL_WRITES mode. SET_VALUES are accepted normally.

  GET          /tags                         Returns full tag list with current simulated values, module_id, and override status.

  GET          /tags/:module_id              Returns tag list filtered to one module_id.
  --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**11.2 Log Buffer**

control.js maintains a rolling in-memory array of the last LOG_BUFFER_SIZE log entries (default 200). Every call to the simulator\'s logging functions appends an entry to this buffer in addition to writing to the console. When the buffer exceeds LOG_BUFFER_SIZE, the oldest entry is dropped.

Log entry structure:

> {
>
> \"ts\": \"2026-03-27T10:09:16.000Z\", // ISO 8601 timestamp
>
> \"level\": \"INFO\", // INFO \| WARN \| ERROR
>
> \"msg\": \"\[SIM\] Started: 2 modules, 13 tags, broker: mqtt://localhost:1883, tick: 100ms\"
>
> }

**11.3 Override Behavior**

A manual override pins a tag\'s simulated value and stops its automatic simulation. The tag continues to publish the overridden value on every tick until the override is cleared. This allows precise testing of specific value states --- for example setting a setpoint tag to a value outside eng_max to test OUT_OF_SYNC detection.

> // POST /override
>
> { \"tag_id\": 1003, \"value\": 9999.0 }
>
> // Response
>
> { \"ok\": true, \"tag_id\": 1003, \"value\": 9999.0, \"overridden\": true }
>
> // POST /override/clear/1003
>
> { \"ok\": true, \"tag_id\": 1003, \"overridden\": false }

**11.4 Status Response**

> // GET /status
>
> {
>
> \"running\": true,
>
> \"uptime_s\": 142,
>
> \"tick_ms\": 100,
>
> \"module_count\": 2,
>
> \"tag_count\": 13,
>
> \"reject_all\": false,
>
> \"encoding\": \"protobuf\", // current telemetry encoding mode: \"protobuf\" \| \"json\"
>
> \"modules\": \[
>
> { \"module_id\": \"RFModule_1\", \"running\": true, \"tag_count\": 7 },
>
> { \"module_id\": \"RFModule_2\", \"running\": false, \"tag_count\": 6 }
>
> \]
>
> }

**12. Simple Frontend**

A single-page HTML file (public/index.html) is served at GET /. It is plain HTML with vanilla JavaScript and basic CSS --- no framework, no build step. All interactions are static HTTP calls to the REST API.

The page is divided into two areas:

-   Control panel (top): status display (including current encoding mode), telemetry start/stop per module, encoding mode checkbox (Protobuf / JSON) that calls POST /telemetry/encoding on change, override form, reject mode toggle, and tag list with current values and override status. The encoding checkbox initial state is read from GET /status on page load.

-   Log panel (bottom): a scrolling log view that polls GET /logs every 1 second and renders all entries with timestamp, level, and message. New entries are appended at the bottom. The panel auto-scrolls to the latest entry.

> *NOTE: The log panel reflects the rolling buffer state at each poll. There is no real-time push --- entries may appear up to \~1 second after they are written to the console.*

**13. File Descriptions**

  -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **File**                   **Responsibility**
  -------------------------- --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  src/index.js               Entry point. Validates env vars, orchestrates startup sequence (Sections 5--8). Starts telemetry loop. Handles graceful shutdown on SIGINT/SIGTERM.

  src/registry.js            Exports loadTagRegistry(). Queries tag_registry via \@caro/db, builds tag map grouped by module_id, extracts module_id from meta. Returns Map\<module_id, SimTag\[\]\>.

  src/simulator.js           Exports initSimValues(tagMap), tickSimValues(tagMap, deltaMs), and getSimValue(tag). Implements fixed sine wave (f64/i32) and random toggle (bool) logic. Pure functions --- no I/O.

  src/mqtt.js                Exports connectMqtt(brokerUrl, clientId), publishTelemetry(client, moduleId, tags, encoding), publishCmdAck(client, moduleId, ack), subscribeCommands(client, onCommand). publishTelemetry checks the encoding argument and publishes either a Protobuf-encoded binary or a plain JSON payload. Handles MQTT lifecycle.

  src/protobuf.js            Exports encodeTelemetry(moduleId, tags). Telemetry encoding only. Commands are plain JSON --- no Protobuf decoding needed. References packages/proto/tag.proto from the monorepo root.

  src/control.js             Express REST control API server. Exports startControlServer(simState, logBuffer). Mounts all endpoints including POST /telemetry/encoding. Serves public/index.html at GET /. Maintains the rolling log buffer (LOG_BUFFER_SIZE entries). Tracks current encoding mode (initialised from TELEMETRY_ENCODING env var). Shares simState reference with simulator.js.

  public/index.html          One-page control frontend. Plain HTML + vanilla JS + basic CSS. Control panel for all simulator actions. Log panel polling GET /logs every 1 second with auto-scroll.

  packages/proto/tag.proto   Authoritative Protobuf schema per CARO_MQTT_Spec v1.7 Appendix A. Shared across all apps in the CARO_Platform monorepo. Do not duplicate.

  .env.example               All environment variables with defaults and descriptions. Copy of Section 4 table.

  README.md                  Quick start: install, configure .env, run. One paragraph on what the simulator does.
  -----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

**14. package.json**

> {
>
> \"name\": \"mqtt-simulator\",
>
> \"version\": \"1.0.0\",
>
> \"type\": \"module\",
>
> \"scripts\": {
>
> \"start\": \"node src/index.js\",
>
> \"dev\": \"nodemon \--ext js \--watch src src/index.js\"
>
> },
>
> \"dependencies\": {
>
> \"@caro/db\": \"\*\",
>
> \"express\": \"\^4.18.0\",
>
> \"mqtt\": \"\^5.0.0\",
>
> \"protobufjs\": \"\^7.0.0\"
>
> },
>
> \"devDependencies\": {
>
> \"nodemon\": \"\^3.0.0\"
>
> }
>
> }

**15. Logging**

Console logging only --- no log library needed for a dev tool. Every log call also appends to the in-memory log buffer in control.js (see Section 11.2), making all entries available to the frontend via GET /logs.

  ---------------------------------------------------------------------------------------------------------
  **Event**               **Level**   **Format**
  ----------------------- ----------- ---------------------------------------------------------------------
  Startup complete        INFO        \[SIM\] Started: {N} modules, {M} tags, broker: {url}, tick: {ms}ms

  SET_VALUES received     INFO        \[SIM\] SET_VALUES from {module_id}: {N} tags

  CMD_ACK published       INFO        \[SIM\] CMD_ACK → {module_id}: {N} accepted, {R} rejected

  Unknown module_id       WARN        \[SIM\] Command for unknown module_id: {id} --- ignored

  MQTT disconnect         WARN        \[SIM\] MQTT disconnected --- reconnecting\...

  DB error on startup     ERROR       \[SIM\] Failed to load tag registry: {error}

  Graceful shutdown       INFO        \[SIM\] Shutting down\...

  Control API started     INFO        \[SIM\] Control API listening on port {port}

  Override set            INFO        \[SIM\] Override set: tag_id={id} value={v}

  Override cleared        INFO        \[SIM\] Override cleared: tag_id={id}

  Telemetry stopped       INFO        \[SIM\] Telemetry stopped: {module_id ?? \'all modules\'}

  Encoding mode changed   INFO        \[SIM\] Telemetry encoding: {protobuf\|json}

  Reject mode toggled     INFO        \[SIM\] Reject all writes: {enabled}
  ---------------------------------------------------------------------------------------------------------

**16. Running Instructions**

Prerequisites: PostgreSQL running with caro_dev database and populated tag_registry table (Tag Registry Admin Tool Phase 2 complete). MQTT broker running on localhost:1883 (Mosquitto recommended for dev).

> \# Install Mosquitto broker (Windows)
>
> winget install EclipseFoundation.Mosquitto
>
> \# Start broker
>
> mosquitto -v
>
> \# In a new terminal --- install and run simulator
>
> cd apps/mqtt-simulator
>
> cp .env.example .env \# edit PGPASSWORD
>
> npm install
>
> npm run dev
>
> *NOTE: Once running, the control frontend is available at http://localhost:4000. The log panel will begin streaming console output immediately. Test the API directly with: curl http://localhost:4000/status*
>
> *NOTE: The HMI backend and the simulator both connect to the same MQTT broker. Start the broker first, then the simulator, then the HMI backend. The order of simulator vs backend does not matter --- both handle reconnection gracefully.*

**17. Out of Scope**

-   Simulating module handshake (SCHEMA / TAG_LIST / CONFIRM). The simulator is a running module, not a commissioning module. Handshake is out of scope for Phase 1.

-   REQUEST_SNAPSHOT handling. Continuous 10 Hz publishing provides equivalent coverage for development.

-   Simulating OUT_OF_RANGE or INTERLOCKED rejections. All valid SET_VALUES are accepted.

-   Multiple MQTT clients (one per module_id). One client publishes for all modules.

-   Persistent simulated state across restarts. Values reinitialize on every startup.

-   Hot reload of tag registry. A restart is required after applying a new registry revision.

-   Real-time log push. The frontend log panel uses polling (GET /logs every 1 second) --- WebSocket or SSE are out of scope.

-   Status/heartbeat topics (caro/{module_id}/status and caro/{module_id}/beat). These are out of scope for the Phase 1 dev simulator.
