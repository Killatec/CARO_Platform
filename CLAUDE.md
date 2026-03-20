# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

Run from the repo root (`C:\KillaTec\CARO_Platform`):

```bash
# Setup
cp .env.example .env
npm install

# Development (two terminals)
npm run dev:server   # Backend on http://localhost:3001 (nodemon, hot-reloads JS and JSON)
npm run dev:client   # Frontend on http://localhost:5173 (Vite, proxies /api to :3001)

# Production
cd apps/tag-registry/client && npm run build
npm run start
```

No tests or linting are configured (Phase 2 items).

## Architecture Overview

CARO_Platform is a **hierarchical tag registry admin tool** for industrial automation. An npm workspaces monorepo. Phase 1 uses file-based JSON template storage with client-side registry resolution — no database.

### Monorepo Layout

```
packages/shared/     # @caro/shared — pure validation/business logic (no framework deps)
packages/ui/         # @caro/ui — React primitives → domain widgets → design tokens
apps/tag-registry/
  server/src/        # Express API
  client/src/        # React + Vite + Zustand frontend
  templates/         # JSON template seed files (tags/, parameters/, modules/)
```

### Data Model

Templates are JSON files with `template_type` ('tag' | 'parameter' | 'module' | 'system'), `template_name` (unique ID), `fields` (key-value metadata), and optional `children` (references to other templates with per-instance field overrides). Tag paths use `root.{asset_names}.tag` dot notation — no dots allowed inside asset_names.

### Key Data Flows

**Editing & saving:**
1. User edits → `useValidation` hook runs `validateTemplate()` + `validateGraph()` synchronously
2. `simulateCascade()` previews upstream impacts → user confirms
3. Client batches `PATCH /api/v1/templates` with `original_hash` (optimistic lock)
4. Server re-validates, applies `applyFieldCascade()`, writes atomically (.tmp + rename)

**Registry view:**
- Client calls `resolveRegistry(templates, root)` from `@caro/shared` to produce a flat tag list displayed in `RegistryTable`

### Shared Package (`packages/shared/src/`)

Environment-agnostic functions used by **both** client and server — the single source of truth for business logic:

| Function | Purpose |
|---|---|
| `validateTemplate(t)` | Schema + field validation for one template |
| `validateGraph(templates)` | Cross-template: circular refs, invalid refs, parent types |
| `simulateCascade(current, changes)` | Predicts what parents would change |
| `applyFieldCascade(templates, changed)` | Propagates field changes upward |
| `resolveRegistry(templates, root)` | Builds flat tag list from hierarchy |
| `hashTemplate(t)` | SHA-1 of canonical JSON (optimistic locking key) |

Constants (`constants.js`): `ERROR_CODES`, `DATA_TYPES` (f32, f64, i32, i32_array, bool, string).

### Backend (`apps/tag-registry/server/src/`)

- `index.js` → `app.js` (Express factory with CORS, JSON, routes)
- `routes/templates.js`: `GET /api/v1/templates`, `GET /api/v1/templates/:name`, `PATCH /api/v1/templates` (batch save), `DELETE /api/v1/templates/:name`, `POST /api/v1/templates/validate`
- `services/templateService.js`: all file I/O, indexing, atomic writes, cascade application
- `middleware/errorHandler.js`: maps `ERROR_CODES` → HTTP status codes

### Frontend (`apps/tag-registry/client/src/`)

**Zustand stores** (scoped, no single global store):
- `useTemplateGraphStore` — `templateMap`, `dirtySet`, `hashes`, `originalTemplateMap`, save/discard actions
- `useRegistryStore` — resolved `tags[]`, sorting
- `useUIStore` — `selectedNode`, `activeTab`, modal open state

**Pages:**
- `EditorPage` — tree view (`AssetTree`/`TreeNode`) + editor panel (`NodePanel`/`FieldRow`) + `ValidationPanel`
- `RegistryPage` — `RegistryTable` of resolved flat tags

**API layer:** `api/client.js` (base HTTP wrapper) → `api/templates.js` (typed REST calls)

### UI Package (`packages/ui/src/`)

Three-layer hierarchy: **tokens** (CSS custom properties + JS) → **primitives** (stateless: Button, Input, Badge, Modal, Tooltip, etc.) → **widgets** (domain-aware: TagPathLabel, SeverityBadge, FieldValueRow, JsonViewer).

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3001` | Server HTTP port |
| `TEMPLATES_DIR` | `./apps/tag-registry/templates` | Path to JSON template files |
| `MAX_TAG_PATH_LENGTH` | `100` | Max characters in a resolved tag path |
| `VALIDATE_REQUIRED_PARENT_TYPES` | _(empty)_ | Comma-separated required ancestor types |
| `VALIDATE_UNIQUE_PARENT_TYPES` | `false` | Enforce unique parent types |

## Phase 2 Prep Notes

The codebase is intentionally structured to make Phase 2 additions clean:
- PostgreSQL will replace file-based template storage
- `resolveRegistry()` will move server-side
- Revision history, diff/apply workflow, retired tag tracking, and auth will be added
- JavaScript → TypeScript migration is planned
