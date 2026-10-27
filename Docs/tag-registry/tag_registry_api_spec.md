# Tag Registry Admin Tool — REST API Specification
**Draft** | Generated: 2026-04-02 | **Reconciled with the implementation:** 2026-10-17
Companion documents: [Functional Spec](tag_registry_spec.md) | [Bootstrap](tag_registry_bootstrap.md)

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

HTTP status codes used: 200 OK, 400 Bad Request, 403 Forbidden, 404 Not Found, 409 Conflict, 422 Unprocessable Entity, 500 Internal Server Error. No endpoint returns 201.

Errors are formatted by `@caro/server`'s `errorHandler`: `{ ok: false, error: { code, message, details? } }`, with the HTTP status from the thrown error. An unexpected error has no code of its own and is returned as 500 `INTERNAL_ERROR`. Errors from PostgreSQL carry their SQLSTATE in `.code` (e.g. `40001` for a serialization failure), so that string is passed through as the error code, still with status 500.

**Exception — file downloads.** `GET /api/v1/tag-defs` (§7) returns a binary `application/zip` body on success instead of the envelope. Its error responses still use the envelope.

### 2.3 Validation Errors

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Template graph validation failed",
    "details": [
      { "severity": "error", "code": "INVALID_REFERENCE", "message": "...", "ref": { "template_name": "rf_power_module" } }
    ]
  }
}
```

`details` entries are the shared validators' `ValidationMessage` objects: `{ severity, code, message, ref? }`, where `ref` may carry `template_name`, `field`, `tag_path`, `asset_name` and similar keys.

### 2.4 Template Hashes

Every template returned by the server carries a `hash` field: a 6-character hex string computed as SHA-1 over the canonically serialised template JSON (keys sorted, no whitespace). The client includes the `original_hash` of each template in batch save requests. The server uses this to detect concurrent modification. A `null` original_hash asserts that the template is new and the name must not already exist.

### 2.5 Identity

`applied_by` is currently hardcoded to `'dev'` on the server. The client does not supply this field. Authentication and user identity are out of scope for the prototype.

### 2.6 Configuration

| Variable | Description | Default | Phase |
|----------|-------------|---------|-------|
| PORT | HTTP port | 3001 | 1+2 |
| TEMPLATES_DIR | Absolute path to the templates/ folder | (required) | 1+2 |
| MAX_TAG_PATH_LENGTH | Logged at startup only. **Not applied**: the limit is the constant `MAX_TAG_PATH_LENGTH = 100` in `shared/constants.ts`, and setting the variable has no effect. | 100 | 1+2 |
| VALIDATE_REQUIRED_PARENT_TYPES | Comma-separated template_type values each tag must have as an ancestor. Empty = disabled. Served by `GET /config` and enforced **in the client only** (`useValidation`); the server never checks it on save or apply. | (unset) | 1+2 |
| VALIDATE_UNIQUE_PARENT_TYPES | If true, no tag may have more than one `module` or more than one `parameter` ancestor. Only those two types are checked (`UNIQUE_ANCESTOR_TYPES` in `shared/constants.ts`); other types may repeat. Client-side only, like the row above. | false | 1+2 |
| POSTGRES_HOST | PostgreSQL host | localhost | 2 only |
| POSTGRES_PORT | PostgreSQL port | 5432 | 2 only |
| POSTGRES_DATABASE | PostgreSQL database name | caro_dev | 2 only |
| POSTGRES_USER | PostgreSQL user | postgres | 2 only |
| POSTGRES_PASSWORD | PostgreSQL password | (required) | 2 only |
| PROJECT_ROOT | Gates `POST /api/v1/registry/apply` (§5.3). Unset/empty refuses every apply; `*` allows any root; any other value allows only an exact match. | (unset — refuses every apply) | 2 only |

> **Note:** `DATABASE_URL` must not be referenced anywhere in app code. Use the five `POSTGRES_*` variables instead, consumed by `@caro/db` (`packages/db/pool.ts`).
>
> **Note:** as of the multi-project work, env is loaded in two layers via `loadEnv()` from `@caro/server/env` — `PORT`/`TEMPLATES_DIR`/`MAX_TAG_PATH_LENGTH`/`VALIDATE_*` stay in this app's own `server/.env`; `POSTGRES_*` and `PROJECT_ROOT` moved to the monorepo root `.env`, shared with mqtt-simulator and caro-hmi. See root `CLAUDE.md` and `Docs/README.md` § Multi-Project Model.

### 2.7 GET /api/v1/config

Returns the server-side validation configuration so the client can apply the same validation rules that are active on the server, plus which database and project this server is connected to.

**Response:**

```json
{
  "ok": true,
  "data": {
    "requiredParentTypes": ["module"],
    "uniqueParentTypes": false,
    "databaseName": "caro_dev",
    "projectRoot": "CARO_1"
  }
}
```

**Parsing rules:**

- `requiredParentTypes` — derived from `VALIDATE_REQUIRED_PARENT_TYPES`: split on `,`, each token trimmed, empty strings filtered. Empty array when unset.
- `uniqueParentTypes` — derived from `VALIDATE_UNIQUE_PARENT_TYPES`: string `"true"` (case-insensitive) → `true`, anything else → `false`.
- `databaseName` — `POSTGRES_DATABASE`, falling back to `'caro_dev'` when unset (mirrors `@caro/db`'s own pool default, so an unconfigured install doesn't render blank).
- `projectRoot` — `PROJECT_ROOT` verbatim, or `null` when unset/empty. Drives the Update DB gate (§5.3) and the Registry/History page connection indicator.

Fields are hand-picked, not a spread of `process.env` — `POSTGRES_PASSWORD` never appears in this or any response.

**Client usage:** `AppShell` fetches this endpoint on mount and stores the result in `useUIStore.validationConfig`. `useValidation.ts` reads `requiredParentTypes`/`uniqueParentTypes` and passes them to `validateParentTypes()`. `RegistryPage` and `HistoryPage` read `databaseName`/`projectRoot` directly from the store for their connection indicator; `RegistryPage` also compares `projectRoot` against the selected root to gate the Update DB button (§5.3).

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
    { "template_name": "numeric_mon", "template_type": "tag", "file_path": "numeric_mon.json" },
    ...
  ]
}
```

> **Note:** This endpoint returns metadata only — not full template JSON. Clients needing full template data must call `GET /api/v1/templates/root/:name`. `file_path` is relative to `TEMPLATES_DIR`. New templates are written flat at its root, but the startup scan is recursive, so a file in a subfolder is still indexed and keeps its path. The list is the server's in-memory index, built once at startup and updated by its own writes; files changed on disk by anything else are not seen until a restart.

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

An empty `changes` and `deletions` returns the success shape with empty arrays and writes nothing.

1. Validate all `original_hash` values for both `changes` and `deletions`:
   - a mismatch → `STALE_TEMPLATE` (409); the client must re-fetch the root and discard local changes;
   - a `null` hash for a name that already exists → `TEMPLATE_NAME_CONFLICT` (409);
   - a non-null hash, or a deletion, for a name that doesn't exist → `TEMPLATE_NOT_FOUND` (404).
2. Check every `TagType` and `ModuleType` field default in `changes` against the `tag_types` / `module_types` tables. An unknown value → **400** `SCHEMA_VALIDATION_ERROR`.
3. Build the proposed template set (current templates + `changes` − `deletions`) and run `validateGraph` from `@caro/tag-registry-shared` on it. `INVALID_REFERENCE` errors surface naturally if any remaining template references a deleted one.
4. Run `simulateCascade` on `changes` to identify upstream parent templates not in the submitted batch that are affected by the changes.
5. If upstream impacts exist and `confirmed` is false → return `requires_confirmation` response (see below). No files written.
6. If `confirmed` is true or there are no upstream impacts → apply the field cascade, write each changed file (write to `<file>.tmp`, then rename), and unlink deleted template files. Return success.

Batch save does **not** run `validateTemplate`, `validateResolvedTags` (tag_name rules) or `validateParentTypes` on the server. Those run in the client before it allows a save; `validateResolvedTags` runs on the server only at registry apply (§5.3). Each file is written atomically, but the batch as a whole is not: an I/O failure part-way through leaves the earlier files written.

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
    "modified_files": ["rf_power_module.json", "Plant1_System_A.json"],
    "deleted_files":  ["old_template.json"]
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

With `confirmed: false` and at least one parent referencing the template, the server returns a preview of affected parents and writes nothing. If no parent references it, the template is deleted on the first call.

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

With `confirmed: true`, the server removes the child references from each parent (rewriting those files), then deletes the template file. Each file write is atomic; the sequence is not.

```json
{ "ok": true, "data": { "requires_confirmation": false, "deleted": true, "affected_parents": [ { "template_name": "rf_power_module", "references_removed": 1 } ] } }
```

Responses: 200 OK, 404 `TEMPLATE_NOT_FOUND`, 409 `STALE_TEMPLATE` (hash mismatch).

### 3.6 Validate Templates

`POST /api/v1/templates/validate` — Run full validation across all indexed templates without saving. Useful for startup checks or CI. It runs `validateTemplate` on every template, `validateGraph` on the whole set, and `validateResolvedTags` on the registry resolved from every template that is not some other template's child. `valid` is `false` if there is any error **or warning**. Parent-type rules are not checked.

**Response data:**

```json
{
  "valid": false,
  "errors": [
    {
      "severity": "error",
      "code": "INVALID_REFERENCE",
      "message": "references unknown template \"analog_v2\"",
      "ref": { "template_name": "rf_power_module" }
    }
  ],
  "warnings": []
}
```

---

## 4. Asset Tree Endpoints

Registry resolution is performed server-side during the apply operation (via `loadRoot` + `resolveRegistry`). No separate asset tree manipulation endpoints are implemented.

### 4.1 Lookup Tables

`GET /api/v1/tag-types` and `GET /api/v1/module-types` return every row of the `tag_types` / `module_types` table, ordered by `id`. The client fetches them through `client/src/api/tagTypes.ts` and `client/src/api/moduleTypes.ts`.

```json
{ "ok": true, "data": [ { "id": 1, "type_name": "f32", "display_name": "Float 32" } ] }
```

`data` is the array itself, not wrapped in an object.

---

## 5. Registry Endpoints

### 5.1 GET /api/v1/registry

Returns the active tag registry from the database via `@caro/db` `getActiveTags()`: the latest row per `tag_id`, non-retired rows only (`DISTINCT ON (tag_id) ... ORDER BY tag_id, registry_rev DESC`, then `WHERE retired = false`). Columns: `tag_id, registry_rev, tag_path, module, module_type, data_type, is_setpoint, trends, unit, format, eng_min, eng_max, tag_name, retired, meta`.

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
        "module": "RFPowerModule",
        "module_type": "MQTT",
        "data_type": "f32",
        "is_setpoint": true,
        "trends": false,
        "unit": "kW",
        "format": "#.##",
        "eng_min": 0,
        "eng_max": 100,
        "tag_name": "RF_Fwd.setpoint",
        "retired": false,
        "meta": [ ... ]
      }
    ]
  }
}
```

No query parameters in the current implementation.

### 5.2 Registry Diff (Client-Side)

Registry diff for the preview is computed client-side by `diffRegistry(proposed, dbTags)` in `client/src/utils/diffRegistry.ts`. No preview endpoint exists on the server. The apply endpoint repeats the classification server-side (§5.3) and that result is what gets written.

`diffRegistry` classifies each row as `added`, `modified`, `unchanged`, or `retired`. Modified rows include a `changedFields` array (listing which of `tag_path`, `data_type`, `is_setpoint`, `trends`, `meta` changed) and a `dbMeta` property (the database row's meta array, for field-level diff highlighting). Comparison uses a key-order-insensitive `deepEqual` so PostgreSQL JSONB key reordering does not produce false positives.

Sort order: added → modified → unchanged → retired.

### 5.3 POST /api/v1/registry/apply

Applies the resolved registry to the database.

**Request body:**

```json
{ "rootName": "Plant1_System_A", "comment": "Initial tag registry load" }
```

- `rootName` — required, non-empty string. Otherwise 400 `VALIDATION_ERROR`.
- `comment` — required, non-empty string (stored trimmed). Otherwise 400 `VALIDATION_ERROR`.
- `rootName` must match the server's configured `PROJECT_ROOT` (§2.6), checked after the two validations above and before the template is loaded. Unset/empty `PROJECT_ROOT` refuses every apply; `*` allows any root; otherwise an exact match is required. Returns 403 `PROJECT_ROOT_MISMATCH` on rejection.
- Returns 404 if the `rootName` template does not exist on disk.

Server processing (`registryService.applyRegistry`):

1. `loadRoot(rootName)` and `resolveRegistry()` server-side; client-supplied tag data is never used.
2. `validateResolvedTags()` on the result. Any error → 422 `SCHEMA_VALIDATION_ERROR`, with `TAG_NAME_EMPTY` / `TAG_NAME_TOO_LONG` / `DUPLICATE_TAG_NAME` / trend and setpoint type messages in `details`. `validateGraph` and the parent-type rules are **not** run here.
3. Classify against `getActiveTags()` **by `tag_path`**:
   - a path not in the database → added, with a new `tag_id` = current max `tag_id` (1000 if the table is empty) + 1, +2, …;
   - a path present but differing in `data_type`, `is_setpoint`, `trends`, `module`, `module_type`, `unit`, `format`, `eng_min`, `eng_max`, `tag_name` or `meta` (key-order-insensitive) → modified, keeping its `tag_id`;
   - an active path missing from the resolved set → retired.

   Every active tag in the database is compared, whatever root it came from (see `Docs/README.md` § Multi-Project Model). Because matching is by path, renaming a tag retires its `tag_id` and adds a new one, and renaming it back adds a third; changing only its module-relative name (`In_Tag_Name` on a level) is a modification and keeps the id.

   Steps 1–3 are `classifyRegistryChanges(templateMap, rootName)`, which the Tag Defs export (§7) also uses to check that the saved templates are applied.
4. Nothing changed → the no-changes response below, and no revision is created.
5. Otherwise `applyRegistryRevision()` in one SERIALIZABLE transaction: a `registry_revisions` row (`applied_by = 'dev'`), then one new append-only `tag_registry` row per added, modified and retired tag at the new `registry_rev`. A serialization failure is not retried; it surfaces as a 500 (§2.2).

**Tags whose `tag_path` exceeds 100 characters are dropped by `resolveRegistry` without any error or warning**, so they are never added; a tag whose path is renamed or moved past the limit is retired and not re-added. No validator checks `tag_path` length; `TAG_PATH_TOO_LONG` is declared but never emitted (§8).

**Rejection response (HTTP 403):**

```json
{
  "ok": false,
  "error": {
    "code": "PROJECT_ROOT_MISMATCH",
    "message": "rootName \"Narya_1\" does not match this server's configured PROJECT_ROOT \"CARO_1\""
  }
}
```

**Success response (HTTP 200):**

```json
{
  "ok": true,
  "data": {
    "ok": true,
    "registry_rev": 5,
    "added": 3,
    "modified": 1,
    "retired": 0
  }
}
```

`data` repeats `ok: true` because the service result is passed through unchanged.

**No-changes response (HTTP 200):**

```json
{
  "ok": true,
  "data": {
    "ok": true,
    "registry_rev": null,
    "message": "No changes to apply"
  }
}
```

**Error responses:** 400 `VALIDATION_ERROR`, 403 `PROJECT_ROOT_MISMATCH`, 404 `TEMPLATE_NOT_FOUND`, 422 `SCHEMA_VALIDATION_ERROR` (resolved-tag rules), 500 for database failures (§2.2).

---

## 6. Revision History Endpoints

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

Returns the `tag_registry` rows **written at** that revision — the tags added, modified or retired by that apply, not the full registry as of that revision — ordered by `tag_path ASC`. Columns: `tag_id, registry_rev, tag_path, module, module_type, data_type, is_setpoint, unit, format, eng_min, eng_max, tag_name, retired, meta` (**no `trends` column**).

**Path parameter:** `:rev` — parsed with `parseInt`. A value that doesn't start with a number returns 400 `VALIDATION_ERROR`.

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
        "data_type": "f32",
        "is_setpoint": true,
        "retired": false,
        "meta": [ ... ]
      }
    ]
  }
}
```

Returns 404 with code `NOT_FOUND` if no rows exist for the given revision number.

---

## 7. Tag Defs Export

### 7.1 GET /api/v1/tag-defs

Downloads the template-level Tag Defs export (functional spec §12.1; design decision RF_Control `Docs/CARO_MIGRATION.md` D32). The export reads saved templates from disk and reads the database only to check that they are applied and to get the revision. It is not gated by `PROJECT_ROOT`.

**Query parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| root | string | Yes | Template whose reachable graph scopes the export (the Registry page's selected root). |

**Server processing:**

1. `loadRoot(root)` loads every template reachable from `root`.
2. `validateGraph` runs on that set. Any error → 422 `VALIDATION_ERROR` with the messages in `details`. `resolveRegistry` skips broken references silently, so the server refuses rather than emit a file with tags quietly missing.
3. `listMqttModuleTemplates` selects `template_type: "module"` templates whose own `Module_Type` default is `MQTT`. None → 422 `NO_MQTT_MODULES`.
4. `validateTagDefs` runs per selected template. Any of the following → 422 `VALIDATION_ERROR`, with `TAG_NAME_EMPTY` / `DUPLICATE_TAG_NAME` / `TAG_NAME_LEAF_AND_GROUP` / `TAG_NAME_RESERVED_SEGMENT` / `TEMPLATE_NAME_INVALID` messages in `details`:
   - an empty module-relative name;
   - a case-insensitively duplicated name;
   - a name that is also the parent of another name;
   - a segment equal to `data_type` or `_template`;
   - a template that would mark a node (`_template`, spec §12.1) whose name is not a C identifier.
5. `classifyRegistryChanges(templateMap, root)` (the comparison apply uses, §5) must find nothing to add, modify or retire, and a revision must exist. Otherwise → 409 `REGISTRY_NOT_APPLIED`, with the counts in the message (`… differ from registry revision 9 (0 added, 1 modified, 0 retired) — apply them first`).
6. `buildTagDefsFile(templateMap, name, latest registry_rev)` runs for each selected template, and the results are zipped (`fflate`).

**Success response (HTTP 200):**

- `Content-Type: application/zip`
- `Content-Disposition: attachment; filename="TagDefs_YYYY-MM-DD_HHmmss.zip"` (server local time)
- Body: a ZIP with one `<template_name>.json` per MQTT module template, flat at the root, no subfolders. Each file:

```json
{
  "_generated": "GENERATED FILE - DO NOT EDIT. Produced by the CARO Tag Registry \"Generate Tag Defs\" export (template-level, no instance data). Regenerate instead of editing. \"tags\" is nested by tag_name segment; a node with a \"data_type\" key is a leaf. tag_registry_rev is the Tag Registry revision the export was taken at: the saved templates matched what that revision applied.",
  "template_name": "Narya_RF",
  "tag_registry_rev": 13,
  "tags": {
    "Mag_1": { "Fwd": {
      "Gain": { "data_type": "f32" },
      "kW":   { "data_type": "f32" }
    } },
    "RF_Enable": { "data_type": "bool" }
  }
}
```

| Field | Description |
|-------|-------------|
| `tags` | Tree nested by module-relative `tag_name` segment (`Mag_1.Fwd.Gain` → `tags.Mag_1.Fwd.Gain`). A node with a `data_type` key is a leaf; any other node is a group. Names are the `asset_name`s of levels below the module with `In_Tag_Name: true`; the module level is always excluded, and organizational levels with `In_Tag_Name: false` drop out (functional spec §12.1). |
| leaf `data_type` | Resolved `data_type` (`tag_types.type_name`). The leaf's only key. |
| `tag_registry_rev` | Integer: the latest `registry_rev` at export time. The `tags` are exactly what it applied (step 5). Database-wide, so it changes on any apply. The module reports it as `tag_registry_rev` in `HANDSHAKE_REQUEST` (CARO_MQTT_Spec §7.2). Replaced `content_hash` on 2026-10-21. |

Only `data_type` is emitted per tag. `direction` was removed on 2026-10-01; it was a flat-array field `{ tag_name, direction, data_type }` before then. `tag_id`, `unit`, `eng_min`, `eng_max`, `trends`, `scale`, `offset`, `format` and `is_setpoint` are excluded by design (D32). The files carry no timestamp, so an unchanged template regenerates byte-identically.

**Errors:** 400 `VALIDATION_ERROR` (`root` missing or empty), 404 `TEMPLATE_NOT_FOUND`, 422 `VALIDATION_ERROR` (graph errors, or module-relative name errors, in `details`), 422 `NO_MQTT_MODULES`, 409 `REGISTRY_NOT_APPLIED`.

---

## 8. Error Code Reference

Codes marked *not emitted* are declared in `shared/constants.ts` (or only listed here) but no code path produces them today.

| Code | HTTP Status | Description |
|------|-------------|-------------|
| TEMPLATE_NOT_FOUND | 404 | No template with the given template_name exists. |
| TEMPLATE_NAME_CONFLICT | 409 | A null-hash template in the batch uses a name that already exists on disk. |
| STALE_TEMPLATE | 409 | One or more original_hash values do not match the current file on disk. The entire batch is rejected. Client must re-fetch the full root hierarchy and discard local changes before retrying. |
| INVALID_REFERENCE | `details` entry | Template references a template_name that does not exist. From `validateGraph`, under 422 `VALIDATION_ERROR`. |
| CIRCULAR_REFERENCE | `details` entry | Template dependency graph contains a cycle. From `validateGraph`, under 422 `VALIDATION_ERROR`. |
| SCHEMA_VALIDATION_ERROR | 400 / 422 / `details` entry | Top-level 400 from batch save when a TagType/ModuleType default is not in its lookup table; top-level 422 from registry apply when resolved-tag rules fail; and the code of most `validateTemplate` / `validateResolvedTags` messages. |
| INVALID_ASSET_NAME | `details` entry | asset_name is empty or contains a dot character (`validateTemplate`). |
| INVALID_TEMPLATE_NAME | *not emitted* | Not declared in code. A dot in a template name is blocked only by the client's New Template dialog; the server accepts it. |
| DUPLICATE_SIBLING_NAME | `details` entry | Two siblings within the same parent share an asset_name (`validateTemplate`). |
| UNKNOWN_FIELD | *not emitted* | Instance sets a field not defined in the child template. |
| TAG_PATH_COLLISION | *not emitted* | Renaming would create a tag_path that duplicates an active tag. |
| TAG_PATH_TOO_LONG | *not emitted* | Over-length tag_paths are dropped silently instead (§5.3). |
| NOT_FOUND | 404 | `GET /registry/revisions/:rev`: no rows for that revision. |
| INTERNAL_ERROR | 500 | Unexpected server error (§2.2). |
| PARENT_TYPE_MISSING | client only | A tag is missing a required ancestor type (VALIDATE_REQUIRED_PARENT_TYPES). Raised by the client's validation panel; no endpoint checks it. |
| DUPLICATE_PARENT_TYPE | client only | A tag has more than one `module` or `parameter` ancestor (VALIDATE_UNIQUE_PARENT_TYPES). Client only, as above. |
| EMPTY_BRANCH | *not emitted* | A structural template in the root hierarchy contains no tag descendants (tracked in `platform_todo.md`). |
| TYPE_FOLDER_MISMATCH | *not emitted* | Leftover from the subfolder layout; declared in `shared/constants.ts` only. |
| TAG_NAME_EMPTY | `details` entry | A resolved tag has an empty `tag_name` — no level in its ancestor path has `In_Tag_Name` set to `true`. From `validateResolvedTags`: blocks save in the client, and fails registry apply with 422 `SCHEMA_VALIDATION_ERROR`. Also a Tag Defs export error (§7). |
| TAG_NAME_TOO_LONG | `details` entry | A resolved `tag_name` exceeds `MAX_TAG_NAME_LENGTH` (40 characters). Same surfaces as TAG_NAME_EMPTY (not the export). |
| DUPLICATE_TAG_NAME | `details` entry | Two or more resolved tags share the same `tag_name` (case-insensitive comparison, entire-registry scope). One error emitted per offending tag. No DB UNIQUE constraint. Same surfaces as TAG_NAME_EMPTY. |
| VALIDATION_ERROR | 400 / 422 | 400: a required request field is missing or malformed (`rootName`, `comment`, `:rev`, `root`). 422: graph validation failed on batch save, or graph / module-relative-name validation failed on Tag Defs export; the specific codes are in `details`. |
| NO_MQTT_MODULES | 422 | `GET /api/v1/tag-defs` (§7): no `module` template with `Module_Type: "MQTT"` is reachable from `root`. |
| REGISTRY_NOT_APPLIED | 409 | `GET /api/v1/tag-defs` (§7): the saved templates under `root` differ from the latest registry revision, or no revision exists. Apply first. |
| TAG_NAME_LEAF_AND_GROUP | — | `details` entry under 422 `VALIDATION_ERROR` from `GET /api/v1/tag-defs` (§7): a module-relative name is also the parent of another name (case-insensitive). |
| TAG_NAME_RESERVED_SEGMENT | — | `details` entry under 422 `VALIDATION_ERROR` from `GET /api/v1/tag-defs` (§7): a module-relative name has a segment equal to `data_type` (the leaf key) or `_template` (the template key). |
| TEMPLATE_NAME_INVALID | — | `details` entry under 422 `VALIDATION_ERROR` from `GET /api/v1/tag-defs` (§7): a template that marks a node with `_template` has a name that is not a C identifier (`[A-Za-z_][A-Za-z0-9_]*`). `ref.child_template` names it. |
| PROJECT_ROOT_MISMATCH | 403 | `POST /api/v1/registry/apply`'s `rootName` doesn't match the server's configured `PROJECT_ROOT` (§2.6, §5.3) — including when `PROJECT_ROOT` is unset/empty, which refuses every apply. |

---
