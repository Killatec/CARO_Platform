# Tag Registry Admin Tool — REST API Specification
**Draft v1.14** | Generated: 2026-03-23
Companion documents: [Functional Spec v1.16](tag_registry_spec_v1_16.md) | [Bootstrap v1.19](tag_registry_bootstrap_v1_19.md)

---

## 1. Overview

This document defines the REST API contract between the React frontend and the Node.js/Express backend of the Tag Registry Admin Tool.

All endpoints are prefixed with `/api/v1`. All request and response bodies are JSON. All timestamps are ISO 8601 UTC strings.

The root template is selected via a global dropdown in the client. On selection, the client fetches the full reachable template graph from the server. All editing is local. The primary write endpoint is `POST /api/v1/templates/batch`, which handles both changes and deletions atomically.

---

## 2. Conventions

### 2.1 HTTP Methods

| Method | Semantics |
|--------|-----------|
| GET | Read-only. No side effects. |
| POST | Create a new resource or trigger an operation. |
| DELETE | Remove a resource. |

### 2.2 Standard Response Envelope

```json
{ "ok": true, "data": { ... } }
{ "ok": false, "error": { "code": "TEMPLATE_NOT_FOUND", "message": "..." } }
```

HTTP status codes: 200 OK, 201 Created, 400 Bad Request, 404 Not Found, 409 Conflict, 422 Unprocessable Entity, 500 Internal Server Error.

### 2.3 Validation Errors

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "...",
    "details": [ { "field": "asset_name", "message": "must not contain a dot" } ]
  }
}
```

### 2.4 Template Hashes

Every template returned by the server carries a `hash` field: a 6-character hex string computed as SHA-1 over the canonically serialised template JSON (keys sorted, no whitespace). The client includes the `original_hash` of each template in batch save requests. The server uses this to detect concurrent modification. A `null` original_hash asserts that the template is new and the name must not already exist.

### 2.5 Identity

`applied_by` is currently hardcoded to `'dev'` on the server. The client does not supply this field. Authentication and user identity are out of scope for the prototype.

### 2.6 Configuration

| Variable | Description | Default | Phase |
|----------|-------------|---------|-------|
| PORT | HTTP port | 3001 | 1+2 |
| TEMPLATES_DIR | Absolute path to the templates/ folder | (required) | 1+2 |
| MAX_TAG_PATH_LENGTH | Maximum permitted tag_path character length | 100 | 1+2 |
| VALIDATE_REQUIRED_PARENT_TYPES | Comma-separated template_type values each tag must have as an ancestor. Empty = disabled. | (unset) | 1+2 |
| VALIDATE_UNIQUE_PARENT_TYPES | If true, no tag may have more than one ancestor of the same template_type. | false | 1+2 |
| PGHOST | PostgreSQL host | localhost | 2 only |
| PGPORT | PostgreSQL port | 5432 | 2 only |
| PGDATABASE | PostgreSQL database name | caro_dev | 2 only |
| PGUSER | PostgreSQL user | postgres | 2 only |
| PGPASSWORD | PostgreSQL password | (required) | 2 only |

> **Note:** `DATABASE_URL` must not be referenced anywhere in Phase 1 or Phase 2 code. Use the five `PG*` variables instead, consumed by `@caro/db` pool.js.

---

## 3. Template Endpoints

Templates are stored as JSON files on disk under `TEMPLATES_DIR`. The `template_type` field in each file is the source of truth.

### 3.1 List Templates

`GET /api/v1/templates` — Return all known templates, optionally filtered by type. Used to populate the root dropdown and the TemplatesTree panel.

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| type | string | No | Filter by template_type. |

**Response data:**

```json
{
  "templates": [
    { "template_name": "numeric_mon", "template_type": "tag", "file_path": "tags/numeric_mon.json" },
    ...
  ]
}
```

> **Note:** This endpoint returns metadata only — not full template JSON. Clients needing full template data must call `GET /api/v1/templates/root/:name`.

### 3.2 Get Template

`GET /api/v1/templates/:template_name` — Return the full JSON content and hash of a single template.

**Response data:**

```json
{ "template": { ...full JSON... }, "hash": "a3f9c2" }
```

### 3.3 Load Root

`GET /api/v1/templates/root/:template_name` — Return all templates reachable from the named root as a flat map, each with full JSON and hash. This is the primary fetch for starting an editing session, and is also used by the client to fetch individual template subgraphs on demand (e.g. when a TemplatesTree leaf is clicked or a template is dropped onto the System Tree).

**Response data:**

```json
{
  "root_template_name": "Plant1_System_A",
  "templates": {
    "Plant1_System_A": { "hash": "a3f9c2", "template": { ...full JSON... } },
    "rf_power_module":  { "hash": "b7d1e5", "template": { ...full JSON... } },
    "analog_control":   { "hash": "c2a8f1", "template": { ...full JSON... } },
    "numeric_mon":      { "hash": "d4e1f0", "template": { ...full JSON... } }
  }
}
```

The map includes the root template itself and every template reachable via the children graph. Templates referenced outside this root (upstream parents) are not included.

### 3.4 Batch Save

`POST /api/v1/templates/batch` — The single write endpoint for all template changes and deletions. Accepts modified/created templates and templates queued for deletion, all with their original hashes. Stateless: no `pending_id` is issued or stored.

**Request body:**

```json
{
  "changes": [
    {
      "template_name": "rf_power_module",
      "original_hash": "b7d1e5",
      "template": { ...full JSON... }
    },
    {
      "template_name": "new_param",
      "original_hash": null,
      "template": { ...full JSON... }
    }
  ],
  "deletions": [
    {
      "template_name": "old_template",
      "original_hash": "a3f9c2"
    }
  ],
  "confirmed": false
}
```

**Server processing:**

1. Validate all `original_hash` values for both `changes` and `deletions`. Any mismatch → reject with `STALE_TEMPLATE` (409). Client must re-fetch root and discard local changes.
2. Build the proposed template set: current on-disk templates + `changes` − `deletions`.
3. Run `validateGraph` from `@caro/shared` on the proposed template set. `INVALID_REFERENCE` errors surface naturally if any remaining template references a deleted one.
4. Run `simulateCascade` on `changes` to identify upstream parent templates not in the submitted batch that are affected by the changes.
5. If upstream impacts exist and `confirmed` is false → return `requires_confirmation` response (see below). No files written.
6. If `confirmed` is true or there are no upstream impacts → write all files atomically including cascade updates, and unlink deleted template files. Return success.

Graph validation errors (e.g. `INVALID_REFERENCE`, `CIRCULAR_REFERENCE`) are returned as `VALIDATION_ERROR` with the specific codes in the `details` array — not as top-level error codes.

**Requires-confirmation response (HTTP 200):**

```json
{
  "ok": true,
  "data": {
    "requires_confirmation": true,
    "diff": {
      "fields_added":            [...],
      "fields_removed":          [...],
      "fields_changed":          [...],
      "instance_fields_changed": [
        {
          "template_name": "...",
          "asset_name":    "...",
          "field":         "...",
          "old_value":     ...,
          "new_value":     ...
        }
      ]
    },
    "affectedParents": [
      {
        "parent_template_name": "rf_power_module",
        "asset_name":           "ForwardPower",
        "dropped_instance_values": [
          { "field": "eng_min", "asset_name": "ForwardPower" }
        ]
      }
    ]
  }
}
```

> **Note:** `affectedParents` is per-instance, not per-template. A parent template with two affected child instances produces two separate entries, one per `asset_name`.

**Success response (HTTP 200):**

```json
{
  "ok": true,
  "data": {
    "requires_confirmation": false,
    "modified_files": ["modules/rf_power_module.json", "modules/Plant1_System_A.json"],
    "deleted_files":  ["tags/old_template.json"]
  }
}
```

> **Note:** The client holds the original batch in memory. On `requires_confirmation`, it shows the CascadeModal and resubmits the same `changes` and `deletions` arrays with `confirmed: true`.

### 3.5 Delete Template

`DELETE /api/v1/templates/:template_name` — This endpoint remains available but is no longer called by the client in normal flow. Template deletions are now handled as part of the batch save request (see section 3.4). This endpoint may be used for tooling or CI purposes.

**Request body:**

```json
{ "original_hash": "b7d1e5", "confirmed": false }
```

First call (`confirmed: false`): server returns preview of affected parents. No files written.

```json
{
  "ok": true,
  "data": {
    "requires_confirmation": true,
    "affected_parents": [
      { "template_name": "rf_power_module", "references_removed": 1 }
    ]
  }
}
```

Second call (`confirmed: true`): server removes template and all references atomically.

Responses: 200 OK, 404 `TEMPLATE_NOT_FOUND`, 409 `STALE_TEMPLATE` (hash mismatch).

### 3.6 Validate Templates

`POST /api/v1/templates/validate` — Run full validation across all template files on disk without saving. Useful for startup checks or CI.

**Response data:**

```json
{
  "valid": false,
  "errors": [
    {
      "template_name": "rf_power_module",
      "severity": "error",
      "code": "INVALID_REFERENCE",
      "message": "references unknown template \"analog_v2\""
    }
  ],
  "warnings": [
    {
      "template_name": "rf_power_module",
      "severity": "warning",
      "code": "TYPE_FOLDER_MISMATCH",
      "message": "template_type \"parameter\" does not match subfolder \"modules\""
    }
  ]
}
```

---

## 4. Asset Tree Endpoints (Phase 2 — Not Yet Implemented)

These endpoints were originally planned to support server-side tree resolution. In the implemented Phase 2, registry resolution is performed server-side only during the apply operation (via `loadRoot` + `resolveRegistry`). No separate asset tree manipulation endpoints are implemented.

---

## 5. Registry Endpoints (Phase 2)

### 5.1 GET /api/v1/registry

Returns the active tag registry from the database. Uses a subquery to get the latest row per `tag_id` and filter to non-retired rows only:

```sql
SELECT * FROM (
  SELECT DISTINCT ON (tag_id) tag_id, registry_rev, tag_path, data_type, is_setpoint, retired, meta
  FROM tag_registry ORDER BY tag_id, registry_rev DESC
) latest WHERE retired = false
```

**Response:**

```json
{
  "ok": true,
  "data": {
    "tags": [
      {
        "tag_id": 1,
        "registry_rev": 3,
        "tag_path": "Plant1_System_A.RFPowerModule.RF_Fwd.setpoint",
        "data_type": "f64",
        "is_setpoint": true,
        "retired": false,
        "meta": [ ... ]
      }
    ]
  }
}
```

No query parameters in the current implementation.

### 5.2 Registry Diff (Client-Side)

Registry diff is computed entirely client-side by `diffRegistry(proposed, dbTags)` in `client/src/utils/diffRegistry.js`. No preview endpoint exists on the server.

`diffRegistry` classifies each row as `added`, `modified`, `unchanged`, or `retired`. Modified rows include a `changedFields` array (listing which of `tag_path`, `data_type`, `is_setpoint`, `meta` changed) and a `dbMeta` property (the database row's meta array, for field-level diff highlighting). Comparison uses a key-order-insensitive `deepEqual` so PostgreSQL JSONB key reordering does not produce false positives.

Sort order: added → modified → unchanged → retired.

### 5.3 POST /api/v1/registry/apply

Applies the resolved registry to the database.

**Request body:**

```json
{ "rootName": "Plant1_System_A", "comment": "Initial tag registry load" }
```

- `rootName` — required. Must be a valid template name. Returns 400 if missing.
- `comment` — required. Non-empty string. Returns 400 if missing or empty.
- Returns 404 if the `rootName` template does not exist on disk.

Server loads the template graph via `loadRoot()`, resolves server-side via `resolveRegistry()`, diffs against `getActiveRegistry()`, writes inside a SERIALIZABLE transaction.

**Success response (HTTP 200):**

```json
{
  "ok": true,
  "data": {
    "registry_rev": 5,
    "added": 3,
    "modified": 1,
    "retired": 0
  }
}
```

**No-changes response (HTTP 200):**

```json
{
  "ok": true,
  "data": {
    "registry_rev": null,
    "message": "No changes to apply"
  }
}
```

**Error response (HTTP 500):**

```json
{
  "ok": false,
  "error": { "message": "Failed to apply registry" }
}
```

---

## 6. Revision History Endpoints (Phase 2)

### 6.1 GET /api/v1/registry/revisions

Returns all rows from `registry_revisions` ordered by `registry_rev DESC`.

**Response:**

```json
{
  "ok": true,
  "data": {
    "revisions": [
      {
        "registry_rev": 5,
        "applied_by": "dev",
        "applied_at": "2026-03-23T14:30:00.000Z",
        "comment": "Add Chan2 tags"
      }
    ]
  }
}
```

### 6.2 GET /api/v1/registry/revisions/:rev

Returns all `tag_registry` rows for a specific revision, ordered by `tag_path ASC`.

**Path parameter:** `:rev` — integer revision number. Returns 400 if non-integer.

**Response:**

```json
{
  "ok": true,
  "data": {
    "tags": [
      {
        "tag_id": 1,
        "registry_rev": 5,
        "tag_path": "Plant1_System_A.RFPowerModule.RF_Fwd.setpoint",
        "data_type": "f64",
        "is_setpoint": true,
        "retired": false,
        "meta": [ ... ]
      }
    ]
  }
}
```

Returns 404 if no rows exist for the given revision number.

---

## 7. Error Code Reference

| Code | HTTP Status | Description |
|------|-------------|-------------|
| TEMPLATE_NOT_FOUND | 404 | No template with the given template_name exists. |
| TEMPLATE_NAME_CONFLICT | 409 | A null-hash template in the batch uses a name that already exists on disk. |
| STALE_TEMPLATE | 409 | One or more original_hash values do not match the current file on disk. The entire batch is rejected. Client must re-fetch the full root hierarchy and discard local changes before retrying. |
| INVALID_REFERENCE | 422 | Template references a template_name that does not exist. |
| CIRCULAR_REFERENCE | 422 | Template dependency graph contains a cycle. |
| SCHEMA_VALIDATION_ERROR | 422 | Template does not conform to its JSON Schema. |
| INVALID_ASSET_NAME | 422 | asset_name is empty or contains a dot character. |
| INVALID_TEMPLATE_NAME | 422 | template_name contains a dot (.) character. |
| DUPLICATE_SIBLING_NAME | 409 | Two siblings within the same parent share an asset_name. |
| UNKNOWN_FIELD | 422 | Instance sets a field not defined in the child template. |
| TAG_PATH_COLLISION | 409 | Renaming would create a tag_path that duplicates an active tag. |
| TAG_PATH_TOO_LONG | 422 | A resolved tag_path exceeds MAX_TAG_PATH_LENGTH. |
| PARENT_TYPE_MISSING | 422 | A tag is missing a required ancestor type (VALIDATE_REQUIRED_PARENT_TYPES). |
| DUPLICATE_PARENT_TYPE | 422 | A tag has more than one ancestor of the same type (VALIDATE_UNIQUE_PARENT_TYPES). |
| EMPTY_BRANCH | warning | A structural template in the root hierarchy contains no tag descendants. Declared but not yet emitted in Phase 1 validation. |
| VALIDATION_ERROR | 422 | One or more validation rules failed. See details array. Graph validation errors from batchSave (INVALID_REFERENCE, CIRCULAR_REFERENCE) are returned as VALIDATION_ERROR with specific codes in the details array — not as top-level error codes. |

---

## 8. Open Items

- Authentication and session management are out of scope for the prototype. `applied_by` is hardcoded to `'dev'` until a real auth system is implemented.
- Stale conflict merging: when a batch is rejected due to `STALE_TEMPLATE`, attempt to merge the client's local changes with the refreshed server state rather than discarding them.
- WebSocket or SSE endpoint for live notification when another session modifies a template.
- Bulk import endpoint for loading an existing flat tag list into the template hierarchy.
- Rate limiting and request size limits are not specified for the prototype.
- Rename tracking endpoint: future endpoint to rename a `tag_path` in both JSON files and the database while preserving `tag_id` continuity.
- `data_type` as FK: Phase 2+ consideration — `data_type` column in `tag_registry` intended to become a BIGINT FK referencing a data_types lookup table.
