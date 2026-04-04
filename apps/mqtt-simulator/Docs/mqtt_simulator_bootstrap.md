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
> mqtt-simulator/ ← this app
>
> Docs/ ← spec documents
>
> server/
>
> index.js ← entry point, dotenv, ping, migrations, app.listen
>
> app.js ← Express factory, CORS, routes mount
>
> routes/
>
> simulator.js ← POST /start, POST /stop, GET /status
>
> services/
>
> mqttClient.js ← connect(), disconnect(), getClient()
>
> simulatorService.js ← start(), stop(), getStatus(), tick loop, command handler
>
> registry.js ← loadTagRegistry() — calls \@caro/db, maps rows to SimTag
>
> middleware/
>
> asyncWrap.js
>
> errorHandler.js
>
> __tests__/
>
> client/ ← React+Vite frontend (port 5174)
>
> src/
>
> components/SimulatorPanel.jsx
>
> stores/useSimulatorStore.js
>
> api/simulator.js
>
> public/
>
> e2e/
>
> tests/
>
> .env.example
>
> README.md
>
> *NOTE: The simulator follows apps/tag-registry/ conventions — separate server/ and client/ directories, Express REST API, React+Vite frontend. It is part of the npm workspaces monorepo and imports \@caro/db for database access.*

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

On startup the simulator queries tag_registry for the latest revision of each active tag.
The query lives in packages/db/registry.js (getActiveTags()) --- do not duplicate SQL in app code.

Correct query pattern (DISTINCT ON subquery first, then outer WHERE):

> SELECT \* FROM (
>
> SELECT DISTINCT ON (tag_id)
>
> tag_id, registry_rev, tag_path, data_type, is_setpoint, trends, retired, meta
>
> FROM tag_registry
>
> ORDER BY tag_id, registry_rev DESC
>
> ) latest
>
> WHERE retired = false

*NOTE: Applying WHERE retired = false before DISTINCT ON is incorrect --- it excludes retired rows
from consideration and can surface stale non-retired rows from older revisions. Always use the
subquery pattern above.*

module_id is extracted from the meta array --- it is the asset_name of the first ancestor node
whose type is \'module\'. meta is ordered root-to-tag (meta[0] = root, meta[last] = tag leaf);
find() is order-agnostic and works correctly either way:

> function getModuleId(meta) {
>
> // meta is ordered root-to-tag; find() is order-agnostic
>
> const moduleAncestor = meta.find(m =\> m.type === \'module\');
>
> return moduleAncestor?.name ?? \'unknown\';
>
> }

apps/mqtt-simulator/server/services/registry.js calls getActiveTags() and maps rows to SimTag shape.
tag_id is coerced to Number --- PostgreSQL returns INTEGER columns as strings via node-postgres.

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

Incoming CommandEnvelope shape per CARO_MQTT_Spec §6.1 (JSON):

> {
>
> \"command_id\": \"cmd-abc123\",
>
> \"command_type\": \"SET_VALUES\",
>
> \"ts_utc_ms\": 1743073812000,
>
> \"payload\": {
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
>
> }

*NOTE: values are nested under payload.payload.values --- not at the top level of the envelope.
Earlier Bootstrap versions showed values at the top level; this was incorrect. Follow CARO_MQTT_Spec §6.1.*

When a SET_VALUES command is received:

12. Parse JSON. Validate command_type === \'SET_VALUES\'.

13. For each {tag_id, value} pair in payload.values: validate tag_id exists in the tag map for this module_id and is a setpoint (is_setpoint === true). If valid, update simValue to the received value. If tag_id unknown or not a setpoint, mark as rejected (UNKNOWN_TAG) in the CMD_ACK.

14. Immediately publish CMD_ACK JSON to caro/{module_id}/cmd_ack (QoS 1) per CARO_MQTT_Spec §6.2.
Then publish a telemetry message for the affected module immediately (do not wait for next tick).

*NOTE: CMD_ACK_DELAY_MS is not implemented --- ACK is sent immediately.*

CMD_ACK shape per CARO_MQTT_Spec §6.2:

> {
>
> \"command_id\": \"cmd-abc123\",
>
> \"command_type\": \"SET_VALUES\",
>
> \"ts_utc_ms\": 1743073812050,
>
> \"results\": \[
>
> { \"tag_id\": 1003, \"accepted\": true },
>
> { \"tag_id\": 1004, \"accepted\": true },
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

The Express API server runs on PORT (default 3002). All endpoints are prefixed /api/v1/simulator/.
All responses use the { ok, data } / { ok, error: { code, message } } envelope matching
apps/tag-registry/ conventions. Base URL: http://localhost:3002.

> **⚠ This API has no authentication. Use only on a trusted development network.**

**11.1 Implemented Endpoints**

  -----------------------------------------------------------------------------------------------------------------------------------------
  **Method**   **Path**                          **Description**
  ------------ --------------------------------- ------------------------------------------------------------------------------------------
  POST         /api/v1/simulator/start           Start simulator. Body: { intervalMs? } (default 1000ms). Returns { ok, data: status }.
                                                 Returns 409 if already running. Returns 202 — MQTT connect is async.

  POST         /api/v1/simulator/stop            Stop simulator. Returns 409 if not running.

  GET          /api/v1/simulator/status          Returns { ok, data: { running, intervalMs, tagCount, modules, uptime_s, tickCount } }.
  -----------------------------------------------------------------------------------------------------------------------------------------

**11.2 Not Yet Implemented Endpoints**

The following endpoints were specified in the original Bootstrap §11 but are not yet implemented.
Add them as needed when HMI or test tooling requires them:

  -----------------------------------------------------------------------------------------------------------------------------------------
  **Method**   **Path**                          **Description**
  ------------ --------------------------------- ------------------------------------------------------------------------------------------
  GET          /api/v1/simulator/logs            Rolling in-memory log buffer (LOG_BUFFER_SIZE entries).

  POST         /api/v1/simulator/telemetry/stop/:module_id    Stop telemetry for one module.

  POST         /api/v1/simulator/telemetry/start/:module_id   Restart telemetry for one module.

  POST         /api/v1/simulator/override        Pin a tag value. Body: { tag_id, value }.

  POST         /api/v1/simulator/override/clear/:tag_id       Clear a manual override.

  POST         /api/v1/simulator/telemetry/encoding           Set encoding mode. Body: { encoding: \'protobuf\' \| \'json\' }.

  POST         /api/v1/simulator/reject/enable   Enable REJECT_ALL_WRITES mode.

  POST         /api/v1/simulator/reject/disable  Disable REJECT_ALL_WRITES mode.

  GET          /api/v1/simulator/tags            Full tag list with current values and override status.

  GET          /api/v1/simulator/tags/:module_id Tag list for one module.
  -----------------------------------------------------------------------------------------------------------------------------------------

**11.3 Status Response (current shape)**

> // GET /api/v1/simulator/status
>
> {
>
> \"ok\": true,
>
> \"data\": {
>
> \"running\": true,
>
> \"intervalMs\": 100,
>
> \"tagCount\": 16,
>
> \"modules\": \[\"RF1\"\],
>
> \"uptime_s\": 142,
>
> \"tickCount\": 1420
>
> }
>
> }

**12. Frontend**

React+Vite client at apps/mqtt-simulator/client/ (port 5174). Mirrors apps/tag-registry/client/
conventions: Tailwind CSS v4, Zustand store, single-page layout, no router.

Key files:

-   src/stores/useSimulatorStore.js --- Zustand store: { running, intervalMs, tagCount, uptime_s, error }

-   src/components/SimulatorPanel.jsx --- polls GET /api/v1/simulator/status every 2s,
    Start/Stop buttons call POST /api/v1/simulator/start and /stop

-   src/api/simulator.js --- typed REST calls to the simulator API

-   vite.config.js --- port 5174, proxies /api → http://localhost:3002

-   src/index.css --- @import "tailwindcss"; @source "../../../../packages/ui/src";

Start: cd apps/mqtt-simulator/client && npm run dev

> *NOTE: Original Bootstrap §12 specified plain HTML + vanilla JS. Implementation uses React+Vite
> for consistency with apps/tag-registry/client/ conventions. The log panel, per-module controls,
> encoding toggle, and override form described in the original §12 are not yet implemented ---
> see mqtt_simulator_deltas.md for the full list.*

**13. File Descriptions**

  ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  **File**                              **Responsibility**
  ------------------------------------- -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  server/index.js                       Entry point. Validates env vars, starts Express server, handles graceful shutdown.

  server/app.js                         Express app factory. CORS, JSON body parser, routes mount, error handler.

  server/routes/simulator.js            POST /start, POST /stop, GET /status — delegates to simulatorService.

  server/services/mqttClient.js         connect(), disconnect(), getClient(). MQTT lifecycle and event logging.

  server/services/simulatorService.js   start(), stop(), getStatus(). Tick loop, command handler (SET\_VALUES, REQUEST\_SNAPSHOT, RESET), immediate publish on command.

  server/services/registry.js           loadTagRegistry(). Calls getActiveTags() from \@caro/db, maps rows to SimTag shape, coerces tag\_id to Number.

  server/middleware/asyncWrap.js        Wraps async route handlers, forwards errors to Express error handler.

  server/middleware/errorHandler.js     Global Express error handler. Returns \{ ok: false, error: \{ code, message \} \}.

  client/src/stores/useSimulatorStore.js  Zustand store: \{ running, intervalMs, tagCount, uptime\_s, error \}.

  client/src/components/SimulatorPanel.jsx  Polls GET /status every 2s, Start/Stop buttons, interval input.

  client/src/api/simulator.js           getStatus(), startSim(), stopSim() — typed REST calls.

  client/src/api/client.js              Base HTTP fetch wrapper. Adds cache: 'no-store' to all GETs. Same pattern as apps/tag-registry/client/src/api/client.js.

  client/src/App.jsx                    Root React component. Renders SimulatorPanel. No router --- single page.

  client/src/main.jsx                   Vite entry point. Mounts App into #root.

  .env.example                          All environment variables with defaults and descriptions.

  README.md                             Quick start: install, configure .env, run.
  ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

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
