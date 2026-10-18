# CARO_HMI REST API Specification
**Date:** 2026-03-28
**Companion Documents**

hmi_functional_spec | CARO_MQTT_Spec | Tag Registry Functional Spec | CARO_DB_Spec

---

## Revision History

| Version | Date | Author | Summary |
|---|---|---|---|
| 1.0 | 2026-03-26 | PM / Claude | Initial release. Auth, tag registry, setpoint write, audit log, trends stub, operation modes, device status, commissioned modules, WebSocket, error codes. |
| 1.1 | 2026-03-26 | PM / Claude | Setpoint write endpoint redesigned to accept one or more tag_id/value pairs (batch-first). Response grouped by device_id. Partial failure reporting per device. Single write is a batch of one. Aligns with SET_VALUES command type in CARO_MQTT_Spec. |
| 1.2 | 2026-03-26 | PM / Claude | Companion documents updated to include CARO_DB_Spec and updated versions of all companion specs. |
| 1.3 | 2026-03-26 | PM / Claude | Rate limiting defaults added: 100 req/min read, 20 req/min write, both configurable (OI-02 closed). Idempotency note added: write retries are safe — telemetry loop resolves ambiguity. command_id correlation via WebSocket not required — out-of-sync detection handles outcome visibility. |
| 1.4 | 2026-03-28 | PM / Claude | Audit log endpoint updated: tag.write split into tag.write.request and tag.write.outcome (two-row pattern with shared command_id); tag.sync.lost and tag.sync.reset added; comment no longer required on tag writes (mode save only). Sync reset endpoint added: POST /api/v1/tags/{tag_id}/sync-reset. PENDING_TABLE_EMPTY error code updated: no longer references cmd_status. |
| 1.5 | 2026-04-14 | PM / Claude | POST /tags/write: `comment` field changed from required to optional for individual tag writes. The HMI client sends a default value but the field is not validated as required. `comment` remains required only for mode save operations (Section 8, POST /modes/{mode_id}/save). |
| 2.1 | 2026-10-17 | PM / Claude | Reconciled against the implementation. New §1.1 Implementation Status (built endpoint list; auth stubbed; §3, §6, §8–§10 not built). §2.3/§2.4 marked target design. §4 `GET /tags` as built (no filtering, full TagDef, fixed pagination). New §5.3 `POST /reset`. §7 dispatch rule as built (raw-vs-bucketed by window size, `tag_samples` source, `committedThroughTs`, `min`/`max`, `prev`; no trendable check). §12 split into emitted vs target codes; `COMMAND_REJECTED` returns 500. Section 5: `POST /tags/write` response shape corrected to the built `{ devices: [{ module_id, command_id, results }] }`; validation codes as built. Section 11: transport as built (plain `ws://{host}/ws`, no session check), MODE_CHANGED marked not built, PING/PONG payloads, SUBSCRIBE semantics, TREND_DELTA sample semantics and value types. |
| 2.0 | 2026-09-22 | PM / Claude | Section 5.2 added: GET /api/v1/config — runtime `projectRoot` for multi-system client page-tree selection and localStorage namespacing. No auth check; `databaseName` deliberately omitted (unlike Tag Registry's `/config`). |
| 1.9 | 2026-06-02 | PM / Claude | Section 5.1 added: POST /api/v1/commands — module-type-agnostic command send. MQTT dispatches with CMD_ACK await (1s timeout). HMI dispatches RESET only; other cmd_str values return 400. Error codes added: VALIDATION_ERROR, COMMAND_NOT_SUPPORTED, COMMAND_REJECTED, TIMEOUT. |
| 1.8 | 2026-05-26 | PM / Claude | Section 7 tile response: `responseTailTs` renamed `committedThroughTs` on both raw and aggregate responses. Field now carries the `DbPipeline` monotonic watermark rather than a wall-clock timestamp; client uses it directly as the ring trim threshold (no −1000 ms offset). |
| 1.7 | 2026-05-11 | PM / Claude | Section 11 WebSocket: added SUBSCRIBE_TREND, UNSUBSCRIBE_TREND, TREND_DELTA message types (Step 11 live tail). Section 7 tile response: added `responseTailTs` field to aggregate response. Added TREND_FLUSH_HZ env var note. |
| 1.6 | 2026-04-29 | PM / Claude | Section 7 Trends: replaced stub with live endpoint documentation — GET /api/v1/trends/tile (v0.5+ wire contract with start_time/end_time/bucket_count, watermark fall-through, discriminated source response), GET /api/v1/trends/extent (hypertable extent), GET /api/v1/tags/trendable (trendable tag discovery). Added error codes: INVALID_TAG_IDS (trends), INVALID_RANGE, INVALID_BUCKET_COUNT, INVALID_BUCKET_S, MISSING_QUERY_PARAM. Detailed spec: Docs/hmi/trend-viewer/hmi_trend_viewer_spec.md. |

---

## 1. Overview

This document defines the REST API contract between the CARO_HMI React frontend and the Node.js/Express backend. All endpoints are prefixed with `/api/v1`. All request and response bodies are JSON. All timestamps are ISO 8601 UTC strings.

Real-time tag values are delivered exclusively via WebSocket (see Section 11). There is no REST endpoint for reading current tag values.

### 1.1 Implementation Status (as of 2026-10-17)

This document mixes the built API with the target design. The server (`apps/caro-hmi/server/src/app.ts`) mounts only these endpoints:

| Endpoint | Section |
|---|---|
| `GET /api/v1/config` | 5.2 |
| `GET /api/v1/tags` | 4 (behaviour differs — see there) |
| `GET /api/v1/tags/trendable` | 7 |
| `POST /api/v1/tags/write` | 5 |
| `POST /api/v1/commands` | 5.1 |
| `POST /api/v1/reset` | 5.3 |
| `GET /api/v1/trends/tile`, `GET /api/v1/trends/extent` | 7 |
| WebSocket `/ws` | 11 |

Everything else here is **specified but not built**: authentication (§3), `GET /tags/{tag_id}`, `GET /tags/hierarchy`, `POST /tags/{tag_id}/sync-reset`, audit (§6), operation modes (§8), device status (§9), commissioned modules (§10), and the `MODE_CHANGED` WebSocket message. Auth is stubbed: `middleware/auth-stub.ts` attaches `{ user_id: 'dev', username: 'dev', role: 'supervisor' }` to every request, so no endpoint returns 401 or 403 and role requirements are not enforced.

---

## 2. Conventions

### 2.1 Standard Response Envelope

```json
// Success
{ "ok": true, "data": { ... } }

// Error
{ "ok": false, "error": { "code": "ERROR_CODE", "message": "Human-readable description" } }
```

### 2.2 HTTP Status Codes

| Status | Meaning |
|---|---|
| 200 OK | Request succeeded. |
| 201 Created | Resource created. |
| 400 Bad Request | Missing or invalid parameters. |
| 401 Unauthorized | No valid session. Client should redirect to login. |
| 403 Forbidden | Authenticated but insufficient role. |
| 404 Not Found | Resource does not exist. |
| 409 Conflict | State conflict — duplicate name, already active, etc. |
| 422 Unprocessable | Request valid but business rule violated. |
| 500 Server Error | Unexpected server error. |

### 2.3 Authentication

*Target design — not built (§1.1).* All endpoints except `POST /auth/login` and `POST /auth/verify-mfa` require a valid `caro_sid` session cookie. Requests without a valid session return 401. The cookie is httpOnly, Secure, SameSite=Strict — sent automatically by the browser on every request and WSS upgrade.

### 2.4 Pagination

*Target design.* Paginated endpoints accept `page` (default: 1) and `page_size` (default: 50, max: 200) query parameters. No built endpoint paginates; `GET /tags` returns a fixed one-page block (§4). Responses include:

```json
"pagination": { "page": 1, "page_size": 50, "total": 342, "total_pages": 7 }
```

### 2.5 Role Abbreviations

| Abbreviation | Role |
|---|---|
| OP | Operator |
| SV | Supervisor |
| AD | Administrator |
| ALL | Any authenticated user |

---

## 3. Authentication Endpoints

*Not built (§1.1). This section is the target design.*

See hmi_functional_spec Section 5.4 for full session and MFA implementation details.

### POST /api/v1/auth/login
Step 1 — validate credentials

Request body:
```json
{ "username": "string", "password": "string" }
```

Responses:
```json
// MFA not required (Operator)
{ "ok": true, "data": { "mfa_required": false, "user": { "user_id": "...", "username": "...", "role": "operator" } } }

// MFA required (Supervisor / Administrator)
{ "ok": true, "data": { "mfa_required": true } }

// Invalid credentials
{ "ok": false, "error": { "code": "INVALID_CREDENTIALS", "message": "Invalid username or password" } }

// Account locked
{ "ok": false, "error": { "code": "ACCOUNT_LOCKED", "message": "Account locked until 2026-03-26T14:30:00Z" } }
```

### POST /api/v1/auth/verify-mfa
Step 2 — verify TOTP and create session

Request body:
```json
{ "totp_code": "123456" }
```

Responses:
```json
// Success — caro_sid cookie set
{ "ok": true, "data": { "user": { "user_id": "...", "username": "...", "role": "supervisor" } } }

// Invalid code
{ "ok": false, "error": { "code": "INVALID_MFA_CODE", "message": "Invalid or expired TOTP code" } }
```

### POST /api/v1/auth/logout
Destroy server-side session immediately

No request body. Destroys the session record server-side. Clears the caro_sid cookie.

```json
{ "ok": true, "data": {} }
```

### POST /api/v1/auth/verify-mfa-challenge
Save-time MFA re-validation (session preserved)

*Required role: SV*

Re-validates the current session for save-time operations without destroying it. Returns a short-lived challenge_token (valid 60 seconds) that must be included in the subsequent save or activate request.

Request body:
```json
{ "totp_code": "123456" }
```

Responses:
```json
// Success
{ "ok": true, "data": { "challenge_token": "<opaque token, valid 60s>" } }

// Invalid code
{ "ok": false, "error": { "code": "INVALID_MFA_CODE", "message": "Invalid or expired TOTP code" } }
```

---

## 4. Tag Registry Endpoints

Read-only. Tag definitions are managed exclusively by the Tag Registry Admin Tool.

### GET /api/v1/tags
List all active tags

*Required role: ALL*

Query parameters (target design): `module_id` (string, optional), `is_setpoint` (boolean, optional), `page`, `page_size`.

**As built:** all query parameters are ignored. The response is every tag in the server's in-memory tag map (loaded once at startup — a registry apply needs a server restart), each a full `TagDef`: `tag_id, tag_path, tag_name, data_type, is_setpoint, trendable, module_id, module_type, eng_min, eng_max, unit, format, meta`. `pagination` is always `{ page: 1, page_size: <total>, total: <total>, total_pages: 1 }`. The browser client calls this once on load (`HmiContextProvider`).

Target response:
```json
{
  "ok": true,
  "data": {
    "tags": [
      {
        "tag_id": 1001,
        "tag_path": "Plant1_System_A.RFPowerModule.RF_Fwd.setpoint",
        "data_type": "f32",
        "is_setpoint": true,
        "module_id": "RFPowerModule",
        "meta": [ { "type": "tag", "name": "setpoint", "fields": {} }, ... ]
      }
    ],
    "pagination": { "page": 1, "page_size": 50, "total": 42, "total_pages": 1 }
  }
}
```

### GET /api/v1/tags/{tag_id}
*Not built.* Get a single tag definition

*Required role: ALL*

```json
{ "ok": true, "data": { "tag": { "tag_id": 1001, "tag_path": "...", "data_type": "f32", "is_setpoint": true, "module_id": "RFPowerModule", "meta": [...] } } }
```

### GET /api/v1/tags/hierarchy
*Not built.*
Get tags grouped by device and hierarchy

*Required role: ALL*

Reconstructs the tag tree from the meta column. Used by the frontend to build navigable dashboard views.

```json
{
  "ok": true,
  "data": {
    "devices": [
      {
        "module_id": "RFPowerModule",
        "groups": [
          { "name": "RF_Fwd", "tags": [ { "tag_id": 1001, "tag_path": "...", "is_setpoint": true, "data_type": "f32" } ] }
        ]
      }
    ]
  }
}
```

---

## 5. Setpoint Write

A single endpoint handles all setpoint writes — single tag or batch. The payload always carries a `values` array. The backend fans out one SET_VALUES MQTT command per device, containing only that device's tags. Partial failures across devices are reported per device in the response.

### POST /api/v1/tags/write
Write one or more setpoint values

*Required role: SV*

Request body:
```json
{
  "values": [
    { "tag_id": 1001, "value": 90.0 },
    { "tag_id": 2001, "value": 25.0 }
  ],
  "comment": "string (optional)"
}
```

> *NOTE: `comment` is accepted but not required for individual tag writes. The HMI client sends a default value (`'HMI write'`). `comment` remains required for mode save operations (Section 8, POST /modes/{mode_id}/save).*

The backend validates each tag_id (must exist and is_setpoint = true), groups tags by module_id, and publishes one SET_VALUES MQTT command per device. Each command carries only that device's tags.

Success response. The request resolves once every module has ACKed or timed out (1 second), so it carries the per-tag outcome:
```json
{
  "ok": true,
  "data": {
    "devices": [
      { "module_id": "RFPowerModule", "command_id": "<UUID4>", "results": [ { "tag_id": 1001, "accepted": true }, { "tag_id": 1002, "accepted": false, "rejection_code": "OUT_OF_RANGE" } ] },
      { "module_id": "CoolingModule", "command_id": "<UUID4>", "results": [ { "tag_id": 2001, "accepted": false, "rejection_code": "TIMEOUT" } ] }
    ]
  }
}
```

- `results` is the module's CMD_ACK results array, passed through. With no ACK within 1 second every tag is `accepted: false, rejection_code: "TIMEOUT"`. A module's rejection is therefore reported here, with `ok: true` — check each result.
- HMI-module tags are written to `HmiTagSource` directly: `command_id` is `""` and every result is accepted.
- Tags of a module whose `module_type` is neither MQTT nor HMI get `rejection_code: "MODULE_TYPE_NOT_SUPPORTED"`.
- Accepted values, and every value of a module that timed out, are stored in `commanded_setpoints`; the module gets them in its next post-handshake Set push (CARO_MQTT_Spec §6.3). Accepted values also go to `pending_setpoint_values`. A rejected value is not stored.

**Value validation as built:** a value must be a number, a boolean, or a string that parses as a number (it is then sent as a number). The tag's `data_type` is not checked, and entries with a non-numeric `tag_id` are skipped silently. A `values` array that is missing or empty returns 400 `VALIDATION_ERROR`.

Partial validation failure response (some tags invalid before any MQTT command is sent):
```json
{
  "ok": false,
  "error": {
    "code": "WRITE_VALIDATION_FAILED",
    "message": "One or more tags failed validation",
    "details": [
      { "tag_id": 9999, "code": "TAG_NOT_FOUND" },
      { "tag_id": 1003, "code": "TAG_NOT_WRITABLE" },
      { "tag_id": 1001, "code": "TYPE_MISMATCH", "expected": "f32", "got": "boolean" }
    ]
  }
}
```

> *NOTE: All tags are validated before any MQTT command is sent. A validation failure returns 422 and no commands are issued. `TYPE_MISMATCH` is returned only for a value that is not a number, boolean or numeric string (detail: `{ tag_id, code, message }`). Device-side rejections arrive synchronously in `results` (above), not over the WebSocket.*

### POST /api/v1/tags/{tag_id}/sync-reset
*Not built* (the out-of-sync latch does not exist yet).

*Required role: ALL (any logged-in user)*

Clears the in-memory out-of-sync latch for the specified tag_id. Writes a `tag.sync.reset` entry to audit_log. No request body required.

Success response:
```json
{ "ok": true, "data": { "tag_id": 1001, "reset_at": "2026-03-28T14:00:00Z" } }
```

> *NOTE: Returns 200 even if the tag was not in an out-of-sync state — the reset is idempotent. Returns 404 if tag_id does not exist.*

---

## 5.1 Module Commands

Send an arbitrary command string to a module. The server dispatches on `module_type`. The client (`useCommandSender`) is module-type agnostic — it always calls this endpoint.

### POST /api/v1/commands

*Required role: SV*

Request body:
```json
{ "module_id": "Pole", "cmd_str": "RESET" }
```

Success response:
```json
{ "ok": true, "data": { "module_id": "Pole", "cmd_str": "RESET" } }
```

**MQTT dispatch:** Publishes `{ command_id, command_type: cmd_str, ts_utc_ms, payload: {} }` to `caro/{module_id}/cmd` and awaits a CMD_ACK with a 1-second timeout. Resolves on empty or all-accepted results. Rejects with `COMMAND_REJECTED` if the ACK carries an `error` field or any `accepted: false` result — returned as HTTP **500**, because the error is thrown without a status. Rejects with `TIMEOUT` (504) if no ACK arrives within 1 second. `cmd_str` is not validated against any list; it is forwarded as the MQTT `command_type`.

**Other module types:** a `module_id` whose module_type is neither MQTT nor HMI — or that isn't in the tag map at all — resolves without doing anything, so the response is 200.

**HMI dispatch:** Only `cmd_str = "RESET"` is supported — calls `hmiTagSource.reset()` and returns immediately. Any other `cmd_str` targeting an HMI module returns 400 `COMMAND_NOT_SUPPORTED`.

Error responses:
```json
{ "ok": false, "error": { "code": "VALIDATION_ERROR",       "message": "module_id must be a non-empty string" } }
{ "ok": false, "error": { "code": "COMMAND_NOT_SUPPORTED",  "message": "Command 'Foo' is not supported for HMI modules" } }
{ "ok": false, "error": { "code": "COMMAND_REJECTED",       "message": "Command rejected: UNKNOWN" } }
{ "ok": false, "error": { "code": "TIMEOUT",                "message": "Command timed out — no ACK received" } }
```

---

## 5.2 System Config

Runtime identity of the system this server is serving. The client uses `projectRoot` to select its page tree (`client/src/hmi-definitions/<PROJECT_ROOT>/`) and to namespace localStorage so two systems viewed from the same browser never read each other's saved state (see `Docs/platform/multi_project_runbook.md` §4).

### GET /api/v1/config

*No role required — no auth check.*

Success response:
```json
{ "ok": true, "data": { "projectRoot": "Narya1" } }
```

`projectRoot` is `PROJECT_ROOT` from the root `.env`, trimmed, or `null` if unset/empty. Fields are hand-picked, never spread from `process.env`.

Unlike Tag Registry's `/config`, this endpoint deliberately serves `projectRoot` only — no `databaseName`. HMI auth is stubbed, so this endpoint is reachable by anything that can reach the HMI port, and nothing in the client needs the database name.

---

## 5.3 System Reset

### POST /api/v1/reset

*No role check (auth stubbed).* No request body.

Fires every handler registered on the server's `ResetBus`, in registration order:

1. `watchdog` — `TelemetryIntake.resetAllWatchdogs()`: clears the latched watchdog flag of every module heard from within the watchdog timeout.
2. `module-reset` — `CmdController.sendResetAll()`: a fire-and-forget `RESET` command to every MQTT module, and `HmiTagSource.reset()` (increments `Reset_Count`) for the HMI module.

```json
{ "ok": true, "data": { "reset": ["watchdog", "module-reset"] } }
```

---

## 6. Audit Log

*Not built (§1.1). This section is the target design.*

### GET /api/v1/audit
Query audit log

*Required role: SV, AD*

Query parameters:

| Parameter | Type | Description |
|---|---|---|
| user_id | string | Filter by user. Optional. |
| tag_id | integer | Filter by tag_id. Optional. |
| event_type | string | Filter by event type (see table below). Optional. |
| from | ISO 8601 | Start of time range. Optional. |
| to | ISO 8601 | End of time range. Optional. |
| page | integer | Default: 1. |
| page_size | integer | Default: 50, max: 200. |

| event_type | Description |
|---|---|
| auth.login | Successful login |
| auth.logout | Logout |
| auth.mfa_verified | MFA code verified at login |
| auth.mfa_challenge | Save-time MFA challenge passed |
| auth.login_failed | Failed login attempt |
| auth.locked | Account locked after failed attempts |
| tag.write.request | Setpoint write initiated (before MQTT). Pair with tag.write.outcome via command_id. |
| tag.write.outcome | CMD_ACK received or 1-second timeout. Pairs with tag.write.request via command_id. outcome: accepted / rejected / timeout. |
| tag.sync.lost | First good→bad telemetry transition for a setpoint tag. System event — no actor. Latches until manually reset. |
| tag.sync.reset | Manual reset of out-of-sync latch by any logged-in user. |
| mode.created | Operation mode created |
| mode.saved | Mode revision saved |
| mode.activated | Mode revision activated |
| module.validated | Module instance validated by Administrator |
| user.created | User account created |
| user.modified | User account modified |
| user.role_changed | User role changed |

Response:
```json
{
  "ok": true,
  "data": {
    "records": [
      {
        "audit_id": "...",
        "ts": "2026-03-26T14:00:00Z",
        "user_id": "sv_001",
        "username": "pablo",
        "event_type": "tag.write.request",
        "tag_id": 1001,
        "before": 85.0,
        "after": 90.0,
        "comment": "Increase setpoint for batch run",
        "ip": "10.0.0.12"
      }
    ],
    "pagination": { "page": 1, "page_size": 50, "total": 128, "total_pages": 3 }
  }
}
```

---

## 7. Trends (TimescaleDB)

Trend endpoints provide historical tag data from TimescaleDB. Detailed contract: `Docs/hmi/trend-viewer/hmi_trend_viewer_spec.md` §6.

### GET /api/v1/trends/tile
Fetch a time-bucketed tile for one or more trendable tags.

*Required role: ALL (dev mode — no auth gate currently)*

Query parameters:

| Parameter | Type | Constraints |
|---|---|---|
| `tag_ids` | comma-separated integers | required; 1 ≤ count ≤ 8 |
| `start_time` | integer (ms since epoch) | required; positive |
| `end_time` | integer (ms since epoch) | required; must be > start_time |
| `bucket_count` | integer | required; 1..2500 |

Dispatch is done in `@caro/db` `getTrendTile` (`packages/db/timescale/trends.ts`) in two steps:

1. **Raw or bucketed.** The worst-case point count is `(end_time − start_time) in seconds × 10` (`SAMPLE_RATE_HZ`). If that is ≤ `bucket_count`, the response is **raw** change-of-value samples (`source: 'raw'`). Otherwise it is bucketed.
2. **Bucketed source.** `bucketSMs = round((end_time − start_time) / bucket_count)`, `bucketS = bucketSMs / 1000`, which must be in `(0, 14746]` or the request fails with `INVALID_BUCKET_S`. The source is picked by `bucketS`:
   - `< 1` → `tag_samples` (gap-filled buckets computed from the raw table);
   - `< 16` → `1s_cagg`;
   - `< 160` → `10s_cagg`;
   - `< 1600` → `1min_cagg`;
   - else → `10min_cagg`.

   Each CAG is queried with watermark-aware fall-through: if `end_time` is past the CAG's materialization watermark, the trailing portion is served from the next-finer source and `source: 'mixed'` is returned.

Full design: `Docs/hmi/trend-viewer/hmi_trend_viewer_spec.md` §6.3.

Raw response (COV samples, irregular timestamps):
```json
{
  "ok": true,
  "data": {
    "source": "raw",
    "startTime": 1776864000000,
    "endTime": 1776864480000,
    "committedThroughTs": 1776864479500,
    "series": [
      { "tagId": 42, "ts": [1776864001234, 1776864003445], "value": [1.9, 1.8], "prev": { "ts": 1776863998000, "value": 2.0 } }
    ]
  }
}
```

Aggregate response (regular bucket grid):
```json
{
  "ok": true,
  "data": {
    "source": "1s_cagg",
    "startTime": 1776864000000,
    "endTime": 1776864480000,
    "bucketSMs": 1920,
    "n": 500,
    "committedThroughTs": 1776864479500,
    "series": [
      { "tagId": 42, "value": [1.9, 1.8, null, 2.0], "min": [1.7, 1.8, null, 1.9], "max": [2.0, 1.9, null, 2.1] }
    ]
  }
}
```

`source` is one of `'raw'`, `'tag_samples'`, `'1s_cagg'`, `'10s_cagg'`, `'1min_cagg'`, `'10min_cagg'`, or `'mixed'`. `committedThroughTs` is the server's historian commit watermark (`DbPipeline.committedThroughMs`, or `Date.now()` before the first flush); aggregate buckets after it are returned as `null`. Raw series carry an optional `prev` — the last sample before `start_time` (looked back at most 5 minutes) — for drawing the line into the window. `bucketSMs` is the bucket width in **integer milliseconds** (`Math.round(spanMs / bucketCount)` — always an integer). `n` is the actual row count — equals `bucket_count` for aligned requests, `bucket_count + 1` for unaligned. `null` in a value array represents a null-quality sample or a gap bucket. `startTime` / `endTime` are serialized as plain numbers (safe within `Number.MAX_SAFE_INTEGER`).

Validation errors:

| Code | Trigger |
|---|---|
| `INVALID_TAG_IDS` | Empty list, count > 8, or a non-integer / non-positive ID. Whether the ID exists or is trendable is **not** checked; an unknown tag ID gets a series with no data (raw: empty arrays; aggregate: every bucket `null`) rather than an error. |
| `INVALID_RANGE` | `end_time ≤ start_time` or either timestamp is non-positive |
| `INVALID_BUCKET_COUNT` | `bucket_count` outside 1..2500 or non-integer |
| `INVALID_BUCKET_S` | Derived `bucketS` (internal float seconds) outside (0, MAX_BUCKET_S] (= (0, 14746]) — validated at route level before the DB call; normal clients never trigger this because the trend viewer clamps viewport span client-side |
| `MISSING_QUERY_PARAM` | Any required query parameter is absent |

### GET /api/v1/trends/extent
Return the hypertable-wide oldest and newest `ts` values in `tag_samples`.

*Required role: ALL (dev mode)*

No query parameters.

Response:
```json
{
  "ok": true,
  "data": {
    "oldestTs": 1745000000000,
    "newestTs": 1777489680000
  }
}
```

Both fields are `number | null`. Returns `null` / `null` if the hypertable is empty. Used by the perf test page (`/dev/trends-perf`) to compute historical tile windows. No new error codes — standard 500 on DB failure.

### GET /api/v1/tags/trendable
Return the list of tags that are enabled for historian trending.

*Required role: ALL (dev mode)*

No query parameters.

Response:
```json
{
  "ok": true,
  "data": {
    "tags": [
      { "tag_id": 101, "tag_path": "Beam_Current.Gun.Current" }
    ]
  }
}
```

The server filters the in-memory tag map by the `trendableTagIds` set (built at startup from the tag registry's `trends` column). Used by the perf test page to discover tag IDs for sweep runs.

---

## 8. Operation Modes

*Not built (§1.1). This section is the target design.*

### GET /api/v1/modes
List all operation modes with latest revision

*Required role: ALL*

```json
{
  "ok": true,
  "data": {
    "modes": [
      {
        "mode_id": "m_001",
        "name": "Production-HighSpeed",
        "description": "Standard production run",
        "created_by": "sv_001",
        "created_at": "2026-03-01T10:00:00Z",
        "latest_revision": {
          "revision_id": "r_005",
          "revision_number": 5,
          "saved_at": "2026-03-24T08:00:00Z",
          "activated_at": "2026-03-24T08:05:00Z",
          "is_active": true
        }
      }
    ]
  }
}
```

### GET /api/v1/modes/{mode_id}/revisions
Get revision history for a mode

*Required role: ALL*

```json
{
  "ok": true,
  "data": {
    "mode_id": "m_001",
    "name": "Production-HighSpeed",
    "revisions": [
      {
        "revision_id": "r_005",
        "revision_number": 5,
        "comment": "Increased RF_Fwd setpoint",
        "saved_by": "sv_001",
        "saved_at": "2026-03-24T08:00:00Z",
        "activated_at": "2026-03-24T08:05:00Z",
        "is_active": true
      }
    ],
    "pagination": { "page": 1, "page_size": 50, "total": 5, "total_pages": 1 }
  }
}
```

### GET /api/v1/modes/{mode_id}/revisions/{revision_id}/values
Get setpoint values for a revision

*Required role: ALL*

```json
{
  "ok": true,
  "data": {
    "revision_id": "r_005",
    "values": [ { "tag_id": 1001, "tag_path": "...RF_Fwd.setpoint", "value": 90.0, "data_type": "f32" } ]
  }
}
```

### POST /api/v1/modes
Create a new operation mode

*Required role: SV*

Optionally clones from an existing revision via `clone_from_revision_id`.

Request body:
```json
{ "name": "Recipe-ABC-2026Q2", "description": "optional", "clone_from_revision_id": "r_005" }
```

Response:
```json
{ "ok": true, "data": { "mode_id": "m_002", "name": "Recipe-ABC-2026Q2", "revision_id": "r_001" } }
```

### POST /api/v1/modes/{mode_id}/save
Save pending values as a new mode revision

*Required role: SV — requires challenge_token*

Promotes all pending values from `pending_setpoint_values` into a new `mode_revisions` row. Pending table is cleared on success.

Request body:
```json
{ "comment": "Increased setpoints for batch run #42 (required)", "challenge_token": "<from /auth/verify-mfa-challenge>" }
```

Responses:
```json
{ "ok": true, "data": { "mode_id": "m_001", "revision_id": "r_006", "revision_number": 6, "values_saved": 3 } }

// Nothing pending
{ "ok": false, "error": { "code": "PENDING_TABLE_EMPTY", "message": "No pending values to save" } }
```

### POST /api/v1/modes/{revision_id}/activate
Activate a mode revision

*Required role: SV — requires challenge_token*

Sets revision as active system-wide. Publishes all setpoint values to devices via SET_VALUES commands. Only one revision active at a time.

Request body:
```json
{ "comment": "Activating for production shift (required)", "challenge_token": "<from /auth/verify-mfa-challenge>" }
```

Responses:
```json
{ "ok": true, "data": { "revision_id": "r_005", "mode_name": "Production-HighSpeed", "revision_number": 5, "commands_issued": 12, "activated_at": "2026-03-26T08:05:00Z" } }

// Already active
{ "ok": false, "error": { "code": "ALREADY_ACTIVE", "message": "revision r_005 is already active" } }

// Immutable
{ "ok": false, "error": { "code": "REVISION_IMMUTABLE", "message": "This revision has already been activated" } }
```

---

## 9. Device Status

*Not built (§1.1). This section is the target design.*

### GET /api/v1/devices
List commissioned devices and current status

*Required role: AD*

```json
{
  "ok": true,
  "data": {
    "devices": [
      { "module_id": "RFPowerModule", "validated": true, "online": true, "last_seen_at": "2026-03-26T14:00:00Z", "fw_hash": "abc123...", "tag_count": 18 }
    ]
  }
}
```

---

## 10. Commissioned Modules

*Not built (§1.1). This section is the target design.*

### GET /api/v1/modules
List commissioned module instances

*Required role: AD*

Query parameter: `validated=true|false` (optional, default returns all).

```json
{
  "ok": true,
  "data": {
    "modules": [
      {
        "module_id": "RFPowerModule",
        "validated": false,
        "online": true,
        "pending_fw_hash": "abc123...",
        "pending_tag_config_hash": "def456...",
        "tag_count": 18,
        "validated_by": null,
        "validated_at": null,
        "comment": null
      }
    ]
  }
}
```

### POST /api/v1/modules/{module_id}/validate
Validate a commissioned module instance

*Required role: AD*

Sets `validated = true` and captures the pending identity (`fw_hash`, template) reported in the module's HANDSHAKE_REQUEST as the expected baseline (CARO_MQTT_Spec §7.3). Device must be online and have completed the handshake. Comment is required.

Request body:
```json
{ "comment": "Installed in Cabinet B, Bay 3, serial SN-20240312 (required)" }
```

Responses:
```json
{ "ok": true, "data": { "module_id": "RFPowerModule", "validated": true, "validated_at": "2026-03-26T14:10:00Z", "expected_fw_hash": "abc123...", "expected_tag_config_hash": "def456..." } }

// Device not ready
{ "ok": false, "error": { "code": "DEVICE_NOT_READY", "message": "Device has not completed the handshake" } }

// Already validated
{ "ok": false, "error": { "code": "ALREADY_VALIDATED", "message": "Module RFPowerModule is already validated" } }
```

---

## 11. WebSocket API

The WebSocket connection is the primary real-time data channel.

- **Target design:** `wss://{host}/ws`; the `caro_sid` cookie is sent automatically on the WSS upgrade, and the backend validates the session before accepting.
- **As built:** `ws://{host}/ws` on the HMI server port (the client uses `ws://${window.location.host}/ws`, proxied by Vite in development). Every connection is accepted; there is no session check.

Server and client mechanics are traced in `Docs/platform/CARO_Telemetry_Path_Reference.md` §7–§8.

| Message Type | Direction | Description |
|---|---|---|
| SUBSCRIBE | Client → Server | Subscribe to tag_ids for LKV live values. Server replies with a SNAPSHOT of the **newly** subscribed tag_ids (empty `values` if none are new), then streams DELTA updates. |
| UNSUBSCRIBE | Client → Server | Unsubscribe from tag_ids (LKV channel). No reply. |
| SNAPSHOT | Server → Client | Current LKV values for the tag_ids just subscribed. After a reconnect the client re-subscribes everything, so the snapshot covers all of them. Values only (no timestamps). |
| DELTA | Server → Client | Changed LKV values only, up to 8 Hz (125 ms tick). Filtered per client to subscribed tags only. Values only (no timestamps). |
| PING | Client → Server | `{ "type": "PING", "ts": <client ms> }`. The client sends one every 5 s. |
| PONG | Server → Client | `{ "type": "PONG", "ts": <same value> }`. The client computes latency from it. |
| MODE_CHANGED | Server → Client | Broadcast when the active mode revision changes. *Not yet built — operation modes do not exist yet.* |
| SUBSCRIBE_TREND | Client → Server | Subscribe to the trend stream for the given tag_ids. Non-trendable tag_ids are ignored (logged server-side). No reply. |
| UNSUBSCRIBE_TREND | Client → Server | Unsubscribe from the trend stream for the given tag_ids. No reply. |
| TREND_DELTA | Server → Client | Flushed at `TREND_FLUSH_HZ` (default 4 Hz) to every client with trend subscriptions. One sample per subscribed tag per ingest of its module since the last flush, plus one synthetic sample (server time, current LKV value) for each subscribed tag that had none. |

`tagIds` must be an array; a non-array payload is ignored. Within an array, only positive integers are used and the rest are ignored, so one bad id never discards the batch. Unparseable messages and unknown types are ignored without a reply.

All WebSocket messages use JSON encoding. SNAPSHOT and DELTA carry a `values` object keyed by tag_id with the value only (no timestamp, no quality enum). A null value means bad quality.

```json
// SUBSCRIBE
{ "type": "SUBSCRIBE", "tagIds": [1001, 1002, 1003] }

// UNSUBSCRIBE
{ "type": "UNSUBSCRIBE", "tagIds": [1001] }

// SNAPSHOT (sent immediately on subscribe)
{ "type": "SNAPSHOT", "values": { "1001": 85.5, "1002": 12.3, "1003": null } }

// DELTA (sent on tick when values change)
{ "type": "DELTA", "values": { "1001": 86.1 } }

// SUBSCRIBE_TREND (Step 11)
{ "type": "SUBSCRIBE_TREND", "tagIds": [42, 87] }

// UNSUBSCRIBE_TREND (Step 11)
{ "type": "UNSUBSCRIBE_TREND", "tagIds": [42] }

// TREND_DELTA (Step 11, sent at TREND_FLUSH_HZ cadence)
{ "type": "TREND_DELTA", "samples": [
    { "moduleTs": 1776864001234, "tagId": 42, "value": 1.9 },
    { "moduleTs": 1776864001234, "tagId": 87, "value": 0.0 }
  ]
}
```

`TREND_DELTA.samples` is a flat array of `{ moduleTs: number, tagId: number, value: number | boolean | string | null }`. `value` is the tag's LKV value at that ingest, whether or not it changed in that message, so a tag publishing at 10 Hz yields about 10 samples per second. `moduleTs` is the telemetry message's module timestamp, the same clock as `tag_samples` rows, except on synthetic samples, which carry server `Date.now()`. Each client buffers at most 500 samples per tag between flushes, dropping the oldest. `TREND_FLUSH_HZ` is configurable via server env var (default 4). Detailed spec: `Docs/hmi/trend-viewer/hmi_trend_viewer_spec.md` §4.4 and §10.6.

> *NOTE: Protobuf encoding is reserved for future optimization (Phase 6). The current implementation uses JSON for all WebSocket messages.*

MODE_CHANGED payload:
```json
{ "type": "MODE_CHANGED", "mode_name": "Production-HighSpeed", "revision_number": 5, "activated_by": "pablo", "activated_at": "2026-03-26T08:05:00Z" }
```

---

## 12. Error Code Reference

Codes the built server emits:

| Code | HTTP | Where | Description |
|---|---|---|---|
| WRITE_VALIDATION_FAILED | 422 | `POST /tags/write` | One or more tags failed pre-flight validation; no MQTT command is issued. Per-tag reasons in `details`. |
| TAG_NOT_FOUND | `details` entry | `POST /tags/write` | tag_id not in the server's tag map. |
| TAG_NOT_WRITABLE | `details` entry | `POST /tags/write` | Tag exists but `is_setpoint` is false. |
| TYPE_MISMATCH | `details` entry | `POST /tags/write` | Value is not a number, boolean or numeric string (the tag's data_type is not checked). |
| TIMEOUT | per-tag `rejection_code` / 504 | `/tags/write` result; `POST /commands` | No CMD_ACK within 1 second. |
| MODULE_TYPE_NOT_SUPPORTED | per-tag `rejection_code` | `/tags/write` result | Tag's module_type is neither MQTT nor HMI. |
| VALIDATION_ERROR | 400 | `/tags/write`, `/commands` | Missing or malformed body field (`values`, `module_id`, `cmd_str`). |
| COMMAND_NOT_SUPPORTED | 400 | `POST /commands` | Non-RESET command for the HMI module. |
| COMMAND_REJECTED | **500** | `POST /commands` | The module's CMD_ACK had an `error` field or an `accepted: false` result. The error is thrown without a status, so `errorHandler` defaults to 500. |
| INVALID_TAG_IDS | 400 | `/trends/tile` | tag_ids empty, more than 8, or a non-integer / non-positive ID. Trendable membership is not checked. |
| INVALID_RANGE | 400 | `/trends/tile` | end_time ≤ start_time, or either timestamp non-positive or not an integer. |
| INVALID_BUCKET_COUNT | 400 | `/trends/tile` | bucket_count outside 1..2500 or non-integer. |
| INVALID_BUCKET_S | 400 | `/trends/tile` | Derived bucketS outside (0, 14746] for a bucketed request. The trend viewer clamps its span so it does not send these. |
| MISSING_QUERY_PARAM | 400 | `/trends/tile` | A required query parameter is absent or empty. |
| INTERNAL_ERROR | 500 | any | Unexpected server error (`errorHandler` default). |

Target-design codes not produced by the built server (their endpoints are not built — §1.1): INVALID_CREDENTIALS, INVALID_MFA_CODE, ACCOUNT_LOCKED, SESSION_EXPIRED, FORBIDDEN (401/403), MODE_NOT_FOUND, REVISION_NOT_FOUND, REVISION_IMMUTABLE, ALREADY_ACTIVE, ALREADY_VALIDATED, DEVICE_NOT_READY, INVALID_CHALLENGE_TOKEN, PENDING_TABLE_EMPTY.

## Open Questions

- Should `challenge_token` be stored in-memory or derived via HMAC?
- Can activated revisions be cloned (REVISION_IMMUTABLE policy)?

