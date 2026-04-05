# CARO_HMI REST API Specification
**Version:** 1.4
**Date:** 2026-03-28
**Status:** Pending reconciliation — companion doc references and platform changes not yet updated

**Companion Documents**

CARO_HMI Functional Spec v2.4 | CARO_MQTT_Spec v1.8 | Tag Registry Functional Spec v1.17 | CARO_DB_Spec v1.3

---

## Revision History

| Version | Date | Author | Summary |
|---|---|---|---|
| 1.0 | 2026-03-26 | PM / Claude | Initial release. Auth, tag registry, setpoint write, audit log, trends stub, operation modes, device status, commissioned modules, WebSocket, error codes. |
| 1.1 | 2026-03-26 | PM / Claude | Setpoint write endpoint redesigned to accept one or more tag_id/value pairs (batch-first). Response grouped by device_id. Partial failure reporting per device. Single write is a batch of one. Aligns with SET_VALUES command type in CARO_MQTT_Spec v1.2. |
| 1.2 | 2026-03-26 | PM / Claude | Companion documents updated to include CARO_DB_Spec v1.0 and updated versions of all companion specs. |
| 1.3 | 2026-03-26 | PM / Claude | Rate limiting defaults added: 100 req/min read, 20 req/min write, both configurable (OI-02 closed). Idempotency note added: write retries are safe — telemetry loop resolves ambiguity. command_id correlation via WebSocket not required — out-of-sync detection handles outcome visibility. |
| 1.4 | 2026-03-28 | PM / Claude | Audit log endpoint updated: tag.write split into tag.write.request and tag.write.outcome (two-row pattern with shared command_id); tag.sync.lost and tag.sync.reset added; comment no longer required on tag writes (mode save only). Sync reset endpoint added: POST /api/v1/tags/{tag_id}/sync-reset. PENDING_TABLE_EMPTY error code updated: no longer references cmd_status. |

---

## 1. Overview

This document defines the REST API contract between the CARO_HMI React frontend and the Node.js/Express backend. All endpoints are prefixed with `/api/v1`. All request and response bodies are JSON. All timestamps are ISO 8601 UTC strings.

Real-time tag values are delivered exclusively via WebSocket (see Section 11). There is no REST endpoint for reading current tag values.

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

All endpoints except `POST /auth/login` and `POST /auth/verify-mfa` require a valid `caro_sid` session cookie. Requests without a valid session return 401. The cookie is httpOnly, Secure, SameSite=Strict — sent automatically by the browser on every request and WSS upgrade.

### 2.4 Pagination

Paginated endpoints accept `page` (default: 1) and `page_size` (default: 50, max: 200) query parameters. Responses include:

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

See CARO_HMI Functional Spec v2.4 Section 5.4 for full session and MFA implementation details.

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

Query parameters: `module_id` (string, optional), `is_setpoint` (boolean, optional), `page`, `page_size`.

Response:
```json
{
  "ok": true,
  "data": {
    "tags": [
      {
        "tag_id": 1001,
        "tag_path": "Plant1_System_A.RFPowerModule.RF_Fwd.setpoint",
        "data_type": "f64",
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
Get a single tag definition

*Required role: ALL*

```json
{ "ok": true, "data": { "tag": { "tag_id": 1001, "tag_path": "...", "data_type": "f64", "is_setpoint": true, "module_id": "RFPowerModule", "meta": [...] } } }
```

### GET /api/v1/tags/hierarchy
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
          { "name": "RF_Fwd", "tags": [ { "tag_id": 1001, "tag_path": "...", "is_setpoint": true, "data_type": "f64" } ] }
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
  "comment": "string (required)"
}
```

The backend validates each tag_id (must exist and is_setpoint = true), groups tags by module_id, and publishes one SET_VALUES MQTT command per device. Each command carries only that device's tags.

Success response (all devices accepted):
```json
{
  "ok": true,
  "data": {
    "devices": [
      { "module_id": "RFPowerModule", "command_id": "<UUID4>", "status": "pending_ack", "tags": [ { "tag_id": 1001, "value": 90.0 }, { "tag_id": 1002, "value": 85.0 } ] },
      { "module_id": "CoolingModule", "command_id": "<UUID4>", "status": "pending_ack", "tags": [ { "tag_id": 2001, "value": 25.0 } ] }
    ],
    "total_tags": 3,
    "total_devices": 2
  }
}
```

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
      { "tag_id": 1001, "code": "TYPE_MISMATCH", "expected": "f64", "got": "boolean" }
    ]
  }
}
```

> *NOTE: All tags are validated before any MQTT command is sent. A validation failure returns 422 and no commands are issued. Device-side rejections (OUT_OF_RANGE, INTERLOCKED, etc.) are reported asynchronously via the WebSocket stream after CMD_ACK is received.*

### POST /api/v1/tags/{tag_id}/sync-reset

*Required role: ALL (any logged-in user)*

Clears the in-memory out-of-sync latch for the specified tag_id. Writes a `tag.sync.reset` entry to audit_log. No request body required.

Success response:
```json
{ "ok": true, "data": { "tag_id": 1001, "reset_at": "2026-03-28T14:00:00Z" } }
```

> *NOTE: Returns 200 even if the tag was not in an out-of-sync state — the reset is idempotent. Returns 404 if tag_id does not exist.*

---

## 6. Audit Log

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

## 7. Trends (Deferred — TimescaleDB)

Trend endpoints are reserved for future implementation. Request/response shapes are TBD pending TimescaleDB integration.

### GET /api/v1/trends/{tag_id}
Query historical tag values — TBD

*Required role: ALL*

Query parameters, aggregation strategy, resolution, and response shape: TBD. See OI-01.

---

## 8. Operation Modes

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
    "values": [ { "tag_id": 1001, "tag_path": "...RF_Fwd.setpoint", "value": 90.0, "data_type": "f64" } ]
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

Sets `validated = true` and captures pending hashes as expected baseline. Device must be online and have completed the handshake. Comment is required.

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

The WebSocket connection is the primary real-time data channel. Connection: `wss://{host}/ws` — the `caro_sid` cookie is sent automatically on the WSS upgrade. The backend validates the session before accepting.

| Message Type | Direction | Description |
|---|---|---|
| SUBSCRIBE | Client → Server | Subscribe to tag_ids. Server responds with SNAPSHOT then streams updates. |
| UNSUBSCRIBE | Client → Server | Unsubscribe from tag_ids. |
| SNAPSHOT | Server → Client | Full current LKV cache values for all subscribed tag_ids. Sent on subscribe or reconnect. |
| DELTA | Server → Client | Changed values only, up to 10 Hz. Filtered per client to subscribed tags only. |
| PING | Client → Server | Latency measurement. |
| PONG | Server → Client | Echoes PING timestamp. |
| MODE_CHANGED | Server → Client | Broadcast when active mode revision changes. JSON only. |

> *NOTE: SUBSCRIBE, UNSUBSCRIBE, SNAPSHOT, DELTA, PING, and PONG use Protobuf encoding defined in CARO_MQTT_Spec v1.8 Appendix A. MODE_CHANGED is JSON.*

MODE_CHANGED payload:
```json
{ "type": "MODE_CHANGED", "mode_name": "Production-HighSpeed", "revision_number": 5, "activated_by": "pablo", "activated_at": "2026-03-26T08:05:00Z" }
```

---

## 12. Error Code Reference

| Code | HTTP | Description |
|---|---|---|
| INVALID_CREDENTIALS | 401 | Username or password incorrect. |
| INVALID_MFA_CODE | 401 | TOTP code invalid or expired. |
| ACCOUNT_LOCKED | 401 | Account locked after repeated failures. |
| SESSION_EXPIRED | 401 | Session has expired — redirect to login. |
| FORBIDDEN | 403 | Authenticated but role insufficient. |
| TAG_NOT_FOUND | 404 | tag_id does not exist in the active registry. |
| TAG_NOT_WRITABLE | 422 | Tag exists but is_setpoint = false. |
| WRITE_VALIDATION_FAILED | 422 | One or more tags in a batch write failed validation. No MQTT commands issued. See details array. |
| TYPE_MISMATCH | 422 | Value type does not match tag data_type. |
| MODE_NOT_FOUND | 404 | mode_id does not exist. |
| REVISION_NOT_FOUND | 404 | revision_id does not exist. |
| REVISION_IMMUTABLE | 409 | Revision already activated — cannot be modified. |
| ALREADY_ACTIVE | 409 | Revision is already the active revision. |
| ALREADY_VALIDATED | 409 | Module is already validated. |
| DEVICE_NOT_READY | 422 | Device offline or handshake not completed. |
| INVALID_CHALLENGE_TOKEN | 401 | Save-time MFA token missing, invalid, or expired. |
| PENDING_TABLE_EMPTY | 422 | No rows in pending_setpoint_values to promote. |
| INTERNAL_ERROR | 500 | Unexpected server error. |

---

## 13. Open Issues

| # | Issue | Owner | Priority | Target |
|---|---|---|---|---|
| OI-01 | Define trends endpoint — query parameters, aggregation types, response shape, and TimescaleDB schema. Deferred until TimescaleDB integration begins. | Backend | Low | v1.3 |
| OI-02 | RESOLVED in v1.3 — rate limiting defaults added: 100 req/min read, 20 req/min write. | --- | --- | Resolved v1.3 |
| OI-03 | Define challenge_token storage — short-lived in-memory token vs signed stateless token (e.g. HMAC). Lifetime is 60 seconds. | Backend | Medium | v1.3 |
| OI-04 | Define REVISION_IMMUTABLE policy — can an activated revision be cloned to a new editable one? | PM | Medium | v1.3 |
| OI-05 | Define user management endpoints — create, modify, role change, MFA reset, unlock (Administrator only). | Backend | Low | v1.3 |
