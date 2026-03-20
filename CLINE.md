# CARO_Platform - Tag Registry Admin Tool

## Overview

CARO_Platform is a monorepo containing the Tag Registry Admin Tool, a hierarchical tag registry system for industrial automation. This document summarizes the current architecture, key decisions, and file structure for future development context.

## Architecture

### Monorepo Structure
- **Root**: npm workspaces monorepo with packages/ and apps/
- **Phase 1**: File-based template storage, client-side registry calculation, no database
- **Technology Stack**:
  - Frontend: React + Vite + Tailwind CSS
  - Backend: Node.js + Express
  - State: Zustand stores
  - Validation: Shared pure functions (@caro/shared)
  - UI: Layered primitives/widgets system (@caro/ui)

### Tag Registry System
- **Templates**: JSON files defining reusable asset hierarchies (tags, parameters, modules)
- **Registry**: Flat tag list resolved from template hierarchies
- **Cascade**: Automatic field propagation when templates change
- **Validation**: Synchronous client feedback, authoritative server validation

## Key Decisions

### Phase 1 Scope
- No database - templates stored as JSON files on disk
- Client-side registry calculation using resolveRegistry()
- Hash-based optimistic locking for concurrent edits
- Cascade simulation with user confirmation for upstream impacts
- Single global root template selection

### Architecture Decisions
- **Shared Package**: @caro/shared contains environment-agnostic validation logic used by both client and server
- **UI Layers**: Primitives (stateless) → Widgets (domain-aware) → App Components
- **State Management**: Zustand with scoped stores (useTemplateGraphStore, useRegistryStore, useUIStore)
- **API Design**: RESTful with /api/v1 prefix, JSON envelope responses, error code mapping
- **File I/O**: Atomic writes using .tmp files + rename
- **Validation**: Client provides fast feedback, server enforces authoritatively

### Technical Decisions
- **JavaScript**: No TypeScript in Phase 1
- **Styling**: Tailwind utility classes with custom CSS for HMI widgets
- **Error Handling**: Structured error codes with HTTP status mapping
- **Template Hashing**: SHA-1 of canonical JSON for change detection
- **Asset Addressing**: root.{asset_names}.tag format, no dots in asset_names

## File Structure

```
CARO_Platform/
├── package.json                    # Workspaces root
├── .env.example                    # Environment variables
├── .gitignore
├── README.md
├── CLINE.md                        # This file
├── packages/
│   ├── shared/                     # @caro/shared - validation logic
│   │   ├── package.json
│   │   └── src/
│   │       ├── index.js           # Exports all functions
│   │       ├── validateTemplate.js
│   │       ├── validateGraph.js
│   │       ├── simulateCascade.js
│   │       ├── applyFieldCascade.js
│   │       ├── validateParentTypes.js
│   │       ├── resolveRegistry.js
│   │       ├── hashTemplate.js
│   │       └── constants.js       # ERROR_CODES, DATA_TYPES, etc.
│   └── ui/                         # @caro/ui - reusable UI components
│       ├── package.json
│       ├── tailwind.config.js
│       └── src/
│           ├── tokens/             # CSS custom properties + JS tokens
│           │   ├── index.css
│           │   └── tokens.js
│           ├── primitives/         # Stateless components
│           │   ├── Button.jsx
│           │   ├── Input.jsx
│           │   ├── Badge.jsx
│           │   ├── Table.jsx
│           │   ├── Modal.jsx
│           │   ├── Tooltip.jsx
│           │   ├── Dropdown.jsx
│           │   └── index.js
│           └── widgets/            # Domain-aware components
│               ├── TagPathLabel.jsx
│               ├── SeverityBadge.jsx
│               ├── FieldValueRow.jsx
│               ├── JsonViewer.jsx
│               └── index.js
└── apps/
    └── tag-registry/               # Tag Registry Admin Tool
        ├── package.json
        ├── server/                 # Node.js/Express backend
        │   ├── package.json
        │   └── src/
        │       ├── index.js        # Entry point, env validation
        │       ├── app.js          # Express app factory
        │       ├── routes/
        │       │   └── templates.js # API endpoints
        │       ├── services/
        │       │   └── templateService.js # File I/O logic
        │       └── middleware/
        │           ├── errorHandler.js
        │           └── asyncWrap.js
        ├── client/                 # React frontend
        │   ├── package.json
        │   ├── vite.config.js      # Proxy to server
        │   ├── tailwind.config.js
        │   ├── index.html
        │   └── src/
        │       ├── main.jsx
        │       ├── App.jsx
        │       ├── api/            # API client functions
        │       │   ├── client.js
        │       │   └── templates.js
        │       ├── stores/         # Zustand state management
        │       │   ├── useTemplateGraphStore.js
        │       │   ├── useRegistryStore.js
        │       │   └── useUIStore.js
        │       ├── hooks/          # Custom React hooks
        │       │   ├── useValidation.js
        │       │   └── useRootTemplate.js
        │       ├── components/
        │       │   ├── layout/     # AppShell, Sidebar
        │       │   ├── tree/       # AssetTree, TreeNode
        │       │   ├── panel/      # NodePanel, FieldRow
        │       │   ├── registry/   # RegistryTable
        │       │   └── shared/     # Modals, ValidationPanel
        │       ├── pages/          # EditorPage, RegistryPage
        │       ├── utils/          # resolveTree.js
        │       └── index.css
        └── templates/               # Seed template JSON files
            ├── tags/
            │   ├── numeric_mon.json
            │   ├── numeric_set.json
            │   ├── boolean_mon.json
            │   └── boolean_set.json
            ├── parameters/
            │   └── analog_control.json
            └── modules/
                ├── rf_power_module.json
                └── Plant1_System_A.json
```

## Development Workflow

1. **Template Editing**: Select root → Edit in tree/panel → Client-side validation → Batch save with cascade confirmation
2. **Registry Generation**: Client-side resolveRegistry() → Display flat tag table
3. **Cascade Handling**: simulateCascade() detects impacts → User confirmation → applyFieldCascade() propagates changes
4. **Validation**: Synchronous client checks → Authoritative server validation on save

## Phase 2 Preparation

- Database integration (PostgreSQL) for registry persistence
- Registry diff/apply workflow with revision history
- Server-side tree resolution for apply operations
- Retired tag tracking
- Authentication and user sessions

## Environment Variables

- `TEMPLATES_DIR`: Absolute path to templates/ folder
- `PORT`: HTTP port (default 3001)
- `MAX_TAG_PATH_LENGTH`: Max tag path length (default 100)
- `VALIDATE_REQUIRED_PARENT_TYPES`: Comma-separated required ancestor types
- `VALIDATE_UNIQUE_PARENT_TYPES`: Boolean for unique parent types

## Key Functions

### Shared Package
- `validateTemplate(template)`: Schema + field validation
- `validateGraph(templates)`: Cross-template validation
- `simulateCascade(current, changes)`: Predict cascade impacts
- `applyFieldCascade(templates, changed)`: Propagate template changes
- `resolveRegistry(templates, root)`: Generate flat tag list
- `hashTemplate(template)`: SHA-1 hash for change detection

### Client Stores
- `useTemplateGraphStore`: templateMap, dirtySet, save/discard
- `useRegistryStore`: tags array, sorting
- `useUIStore`: selectedNode, modals, activeTab

This architecture provides a solid foundation for hierarchical asset management with instant feedback and safe concurrent editing.