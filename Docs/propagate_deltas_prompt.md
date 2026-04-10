# Delta Propagation Prompt — Pre-Commit Cleanup

This prompt propagates all open delta entries to their target docs, then clears the delta files. Do each section one at a time, confirming the edit before moving to the next.

---

## Delta TR-001 — data_type and is_setpoint moved to fields

### Target: `Docs/tag_registry_spec.md`

**1a. Section 1 Glossary, line 14** — change the `tag template` definition from:
```
| tag template | A leaf template defining a single data point. No children. Carries a `data_type`, an `is_setpoint` boolean flag, and tag-level fields. |
```
to:
```
| tag template | A leaf template defining a single data point. No children. Tag-level fields include `data_type` (field_type `TagType`, default `f32`) and `is_setpoint` (field_type `Boolean`, default `false`), resolved from the fields record. |
```

**1b. Section 4.2** — in the `validateTemplate` bullet (line ~74), change:
```
where `field_type` is one of `"Numeric" | "String" | "Boolean"`
```
to:
```
where `field_type` is one of `"Numeric" | "String" | "Boolean" | "TagType"`
```

**1c. Section 4.2** — in the `resolveRegistry` bullet (line ~79), the text already mentions `data_type`, `is_setpoint` — that's still correct since the resolver extracts them from fields. No change needed here.

**1d. Section 4.2** — in the `constants` bullet (line ~80), change:
```
`constants` — error codes, `DATA_TYPES` enum, `MAX_TAG_PATH_LENGTH` default.
```
to:
```
`constants` — error codes, `DEFAULT_DATA_TYPE`, `MAX_TAG_PATH_LENGTH` default.
```

**1e. Section 6 — Data Types (lines 126–134)** — replace the entire table:
```
| Value | Description |
|-------|-------------|
| `f64` | 64-bit IEEE 754 floating-point |
| `i32` | 32-bit signed integer |
| `bool` | Boolean |
| `str` | UTF-8 string |
```
with:
```
| Value | Display Name | Description |
|-------|-------------|-------------|
| `f32` | Float 32 | 32-bit IEEE 754 floating-point |
| `bool` | Boolean | Boolean |

Data types are stored in the `tag_types` database table (see DB Spec §3.3). The hardcoded `DATA_TYPES` enum has been removed; `DEFAULT_DATA_TYPE = 'f32'` is the only constant. The server validates `TagType` field values against `tag_types.type_name` on template save. New types can be added by inserting rows into `tag_types`.
```

**1f. Section 7.1 Field Definitions (lines 139–157)** — change `field_type` description from:
```
`field_type` is always one of: `"Numeric"` | `"String"` | `"Boolean"`. The `default` value must be the correct JS type (number, string, boolean).
```
to:
```
`field_type` is one of: `"Numeric"` | `"String"` | `"Boolean"` | `"TagType"`. For `Numeric`, `String`, and `Boolean`, the `default` value must be the correct JS type (number, string, boolean). For `TagType`, the `default` is a string referencing a `tag_types.type_name` value (e.g. `"f32"`); the server validates it against the `tag_types` table on save.
```

**1g. Section 7.3 Tag Template (lines 181–193)** — update the example JSON to show data_type and is_setpoint as fields:
Replace:
```json
{
  "template_type": "tag",
  "template_name": "numeric_set",
  "fields": {
    "unit":    { "field_type": "String",  "default": "" },
    "eng_min": { "field_type": "Numeric", "default": 0.0 },
    "eng_max": { "field_type": "Numeric", "default": 100.0 }
  }
}
```
with:
```json
{
  "template_type": "tag",
  "template_name": "numeric_set",
  "fields": {
    "data_type":   { "field_type": "TagType",  "default": "f32" },
    "is_setpoint": { "field_type": "Boolean",  "default": true },
    "Trends":      { "field_type": "Boolean",  "default": true },
    "unit":        { "field_type": "String",   "default": "" },
    "eng_min":     { "field_type": "Numeric",  "default": 0.0 },
    "eng_max":     { "field_type": "Numeric",  "default": 100.0 }
  }
}
```

**1h. Section 10.4 Tag-Specific Rules (line 254)** — change:
```
- `data_type` must be one of the defined enum values (Section 6).
```
to:
```
- Fields with `field_type: "TagType"` must have a `default` value matching a row in `tag_types.type_name`. The server validates this on template save. The `data_type` and `is_setpoint` values are extracted from the resolved fields record by the registry resolver (defaults: `data_type` → `'f32'`, `is_setpoint` → `false`).
```

### Target: `Docs/tag_registry_api_spec.md`

**1i.** In the example JSON responses at lines ~336-337 and ~451-452, change `"data_type": "f64"` to `"data_type": "f32"` (2 occurrences).

### Target: `Docs/tag_registry_handoff.md`

**1j.** No changes needed — handoff describes what is built, not the data model details. The spec docs are the authority.

---

## Delta TR-002 — tag_types lookup table, migration 009, f32 cleanup

### Target: `Docs/CARO_DB_Spec.md`

**2a. Section 2.4 — migration list** (lines ~99-109) — add migration 009:
After the line:
```
-   008_revert_data_type_to_string.sql
```
add:
```
-   009_cleanup_tag_types.sql
```

**2b. Section 3.3 tag_types NOTE** (line ~215) — change:
```
> *NOTE: Seeded with f32, f64, i32, i32_array, bool, string. New types
> added via INSERT. display_name can be renamed freely — all FK
> references use type_name.*
```
to:
```
> *NOTE: After migration 009, only `f32` and `bool` remain. Migration 009 renamed all `f64` references in `tag_registry.data_type` to `f32`, then deleted unused types (`f64`, `i32`, `i32_array`, `string`). New types can be added via INSERT. `display_name` can be renamed freely — all FK references use `type_name`.*
```

**2c. Section 2.3 JSONB Value Column** (lines ~84-89) — change:
```
This handles all current data types
(f64, i32, bool, str) and future array types without schema changes.
```
to:
```
This handles all current data types
(f32, bool) and future types without schema changes.
```

### Target: `Docs/platform_handoff.md`

**2d. Line 67 — migration list** — change:
```
Applied: `001` `002` `003` `004` `006` `007` `008`
```
to:
```
Applied: `001` `002` `003` `004` `006` `007` `008` `009`
```

---

## Delta P-001 — HMI tables not yet implemented (platform_deltas.md)

**Status:** Still open — no propagation needed. Leave in place.

---

## Delta HMI-001 — HmiContextProvider restored loading guard

### Target: `Docs/hmi_bootstrap.md`

**3a.** If HmiContextProvider is documented in hmi_bootstrap.md, add a note that the provider returns `null` until `tagMapLoaded` is true, preventing child components from rendering before the tag map is available. If not already documented, skip.

### Clear delta:

After propagation, replace the content of `Docs/hmi_deltas.md` Delta HMI-001 section with `_(no open divergences)_`.

---

## Clear Propagated Deltas

After all propagations above are complete:

**4a. `Docs/tag_registry_deltas.md`** — remove TR-001 and TR-002 sections entirely. Replace with:
```
_(no open divergences)_

---
```

**4b. `Docs/hmi_deltas.md`** — remove HMI-001 section. Replace with:
```
_(no open divergences)_

---
```

**4c. `Docs/platform_deltas.md`** — keep P-001 (still open). No change.

---

## Update platform_todo.md

**5a.** The completed `[x]` items in the HMI section should be removed (they are done). Keep only the unchecked `[ ]` items. Remove these lines:
```
- [x] Scaffold `@caro/hmi-context` package — ...
- [x] Scaffold `@caro/widgets` package — ...
- [x] HMI server core — ...
- [x] Fix tag-map.ts meta field resolution — ...
```

---

## Verify

After all edits, run:
- `grep -n "f64" Docs/tag_registry_spec.md Docs/tag_registry_api_spec.md Docs/CARO_DB_Spec.md` — should return zero matches (except possibly in revision history tables which are historical records)
- `grep -n "DATA_TYPES" Docs/tag_registry_spec.md` — should return zero matches
- `cat Docs/tag_registry_deltas.md` — should show no open divergences
- `cat Docs/hmi_deltas.md` — should show no open divergences
