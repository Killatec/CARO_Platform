# CARO_HMI Functional Specification
**Date:** 2026-04-15
**Companion Documents**

Tag Registry Functional Spec | CARO_MQTT_Spec | CARO_DB_Spec | hmi_widget_spec

---

## Revision History

| Version | Date | Author | Summary |
|---|---|---|---|
| 2.4 | 2026-03-28 | PM / Claude | Pending setpoint architecture redesigned: audit_log table added (Section 8.6); pending_setpoint_values simplified to (tag_id, value, set_by, set_at) — cmd_status, command_id, rejection_code removed; changeset flow updated (Section 5.2) — backend logs request before MQTT publish, 1-second ACK timeout, pending updated only on accepted ACK via epsilon comparison against active mode revision; mode activation clears pending table entirely; out-of-sync latch redesigned — first good→bad transition logged only, any logged-in user resets, telemetry never writes to pending; OI-09 resolved. |
| 2.5 | 2026-04-19 | PM / Claude | §10.0: HmiDataContext extended with `tagPathIndex`; tagPathIndex lifecycle paragraph added. useLiveValue mount-effect optimization documented. Matches perf commits be308f5 and cceb114. |
| 2.6 | 2026-04-20 | PM / Claude | §10.1, §10.2: WS subscription model updated to reflect level-triggered reconciler (`desiredRef`/`serverRef`, microtask-batched flush, same-tick cancel). Matches perf commit 4977f4f. |
| 2.7 | 2026-04-20 | PM / Claude | §2, §4, §10.2, §10.3: pre-refactor frontend-state sections rewritten to match `@caro/hmi-context` / `useLiveValue` implementation. Global-store and context-registry concepts removed. Per-tag value shape corrected to `{ value }` only — no quality, timestamp, or module_id. |
| 2.8 | 2026-10-17 | PM / Claude | Reconciled against the implementation. New §1.1 Implementation Status; §2/§4 transport and auth status; §4.1 Header and page rendering as built; §4.2 machine configuration rewritten for `PROJECT_ROOT` + `registry.ts`; §5, §6.6, §8.4, §8.7 marked not built; §6.1–§6.5 meta order, TagDef fields and startup-only map; §8.6 no LISTEN/NOTIFY; §11 endpoint status column; §12 retention as built; §12.1 queue instead of WAL; §14 metrics panel, reconnect backoff, TLS status. MQTT/telemetry sections: §7 channel table gains a Status column (JSON-only telemetry, handshake not built, no TLS); §8.1 snapshot-on-connect and setpoint re-delivery; §8.2 historian enqueue rules; §8.8 duty-tracked list and `Module_Count` meaning corrected; §8.9 stall sentinel and recovery; §8.10 routing table covers `/commands` and REQUEST_SNAPSHOT; §9 marked not built; §10 transport (plain `ws`, no auth), 8 Hz, reconnect backoff; §10.4 validation and audit status. |
| 2.9 | 2026-10-18 | PM / Claude | Module handshake built (CARO_MQTT_Spec v2.1 §7): §1.1, §6.4, §7 channel table (`handshake_backend` / `handshake_module`), §8.1 startup sequence, §8.9 recovery, §8.10 routing and setpoint store (`commanded_setpoints`, post-CONFIRM push; startup and recovery re-delivery removed), §9 identity instead of hashes. |

---

## 1. Introduction

This document defines the functional and non-functional requirements for CARO_HMI, a generic web-based Human Machine Interface for industrial control systems. CARO_HMI is machine-agnostic: it operates against any system whose tags are registered in the CARO Tag Registry.

The Tag Registry Admin Tool (see companion documents) is the single source of truth for all tag definitions, template structures, and registry revisions. The HMI reads this registry at runtime and maps all operations — monitoring, setpoint control, trending, alarming, and auditing — to individual tags identified by their stable tag_id.

Intended audience: System architects, embedded firmware engineers, backend/frontend developers, QA, and HSE reviewers.

Document owner: Product Manager.

### 1.1 Implementation Status (as of 2026-10-17)

This document is the target specification. Large parts of it are not built yet; where the current behaviour differs, it is stated in place. Summary of what exists:

| Area | Status |
|---|---|
| Telemetry ingest, LKV cache, watchdog, WebSocket live values | Built (§8, §10). JSON telemetry only — Protobuf is not decoded. |
| Historian (TimescaleDB writes, CAGs, trend viewer) | Built (§8, §12; trend viewer spec). |
| Setpoint writes (`POST /tags/write`), module commands, system reset | Built (§8.10, §8.11, §10.4) — no audit rows, no role checks. |
| Setpoint store (`commanded_setpoints`) and the post-CONFIRM Set push | Built (migration 018; CARO_MQTT_Spec §6.3). `pending_setpoint_values` (016) is written but not read. No re-delivery on startup or watchdog recovery. |
| HMI tag source, Module_Info / Trend_Info tags, StatsBar | Built (§8.8, §14.1). |
| Multi-system page trees by `PROJECT_ROOT` | Built (§4.2). |
| Authentication, sessions, RBAC, WSS (§5) | **Not built** — auth is stubbed; every request runs as a dev supervisor. |
| Operation modes, mode compliance, out-of-sync latch (§6.6, §8.4) | **Not built**. |
| Audit log (§8.7, §13) | **Not built** — no `audit_log` table. |
| Module handshake (CARO_MQTT_Spec §7) | Built, except identity verification: every request from an MQTT-type registry module is answered. |
| Module commissioning (§9: `commissioned_modules`, validation) | **Not built**. |
| Registry change detection (§8.6) | **Not built** — the tag map is loaded once at startup; apply a registry and restart the HMI server. |
| Telemetry write-ahead buffer, DATA LOSS RISK warning (§12.1) | **Not built** — an in-memory queue only. |
| TLS on any channel (§14.3) | **Not built**. |

---

## 2. Technology Stack

The following technology decisions are locked based on proof-of-concept validation. They shall not be changed without a formal architecture review.

| Layer | Technology | Purpose |
|---|---|---|
| Backend runtime | Node.js 18+ / Express | HTTP server, REST API, MQTT subscriber, WebSocket server |
| Real-time transport | WebSocket (ws library) | Bidirectional streaming between backend and frontend |
| Telemetry encoding | Protocol Buffers 3 (protobufjs) — *target*; the backend currently decodes JSON telemetry only (the simulator can encode Protobuf) | Binary encoding for telemetry — significant bandwidth reduction over JSON |
| MQTT client | MQTT.js | Subscribe to device telemetry; publish commands and thresholds |
| Database (tag registry) | PostgreSQL | Authoritative tag definitions — read at startup and on change |
| Database (telemetry) | TimescaleDB | Time-series storage keyed by tag_id |
| Frontend framework | React 18 (18.3) | Component-based UI. Shares the @caro/ui package (design tokens and primitives) with the Tag Registry Admin Tool — consistent look and feel across all CARO_Platform tools. |
| State management | React Context (`@caro/hmi-context`) | Tag map and live-value subscriptions via `HmiContextProvider`. Selective re-renders via per-tag callback dispatch in `useLiveValue`. |
| Build tool | Vite 5+ (6.4 installed) | Dev server with HMR and production bundler |
| Package manager | npm | Dependency management |
| Language | TypeScript | All HMI app and shared package code. |
| Dev tooling | Concurrently + Nodemon | Run backend and frontend simultaneously; auto-reload on change |

---

## 3. Scope

CARO_HMI provides real-time tag monitoring, supervised setpoint delivery to embedded devices (including alarm threshold values), operation mode management with revision tracking, time-series historian, and full audit traceability of all user actions. Optional read-only cloud synchronization is supported. Out of scope: remote firmware upload, ERP/MES integration, cloud write-back or remote machine control, template and tag metadata editing (managed by the Tag Registry Admin Tool), and interlock evaluation (evaluated exclusively on embedded devices).

---

## 4. System Architecture

| Component | Role |
|---|---|
| Embedded Devices | Publish telemetry by tag_id via MQTT. Accept setpoint commands by tag_id. Evaluate all safety interlocks and alarms locally. Receive alarm threshold values as setpoint commands. |
| MQTT Broker | Local broker on trusted LAN. Routes telemetry from devices to backend. Routes commands from backend to devices. TLS required for command channels; telemetry unencrypted on trusted LAN. |
| Backend Server | Node.js / Express. Subscribes to device telemetry via MQTT. Maintains last-known-value cache keyed by tag_id. Bridges MQTT telemetry to WebSocket clients. Reads tag definitions from PostgreSQL Tag Registry at startup. Writes telemetry to TimescaleDB. Authenticates users and enforces RBAC (*not built — auth is stubbed*). |
| PostgreSQL (Tag Registry) | Authoritative source of all tag definitions. Read by backend at startup (*target:* also on registry change notification — not built). Schema defined in Tag Registry Functional Spec. |
| TimescaleDB | Stores time-series telemetry keyed by tag_id. Supports high-resolution, aggregated, and archived tiers. |
| Web Frontend | React 18 / Vite web application. Connects via HTTPS REST + WSS (*as built: plain HTTP and `ws://`*). `HmiContextProvider` from `@caro/hmi-context` provides the tag map and live-value subscriptions to all components. Widgets from `@caro/widgets` read live tag values via `useLiveValue(tagId)`. No global store. |
| Cloud Monitoring (optional) | Read-only forwarding of telemetry to cloud. No write-back or remote control permitted. |

> *NOTE: Network zone separation is required: embedded device network, backend LAN, and optional cloud DMZ must be logically or physically separated.*

### 4.1 HMI Shell — Generic Layout

The HMI application is divided into a generic shell and machine-specific content. The shell is identical for any CARO_Platform installation. The machine-specific content is loaded from a configuration folder at startup.

| Area | Generic / Machine-Specific | Description |
|---|---|---|
| Header | Generic | *Target:* performance metrics panel, active mode indicator, user info, logout. *As built:* title, a global Reset button (`POST /api/v1/reset`, then a `system-reset` window event) and a badge showing `projectRoot` ("No system configured" when unset). The performance metrics are a separate always-visible `StatsBar` above the content area (§14.1). There is no mode indicator, user info or logout. |
| Left nav panel | Machine-specific | Navigation tree rendered from the machine config tree.js. Shell renders the tree generically; content is machine-defined. |
| Main content | Machine-specific | Page component rendered for the selected nav node. Each node has exactly one page component, defined in tree.js. |
| Page router | Generic | Shell reads the selected node id (kept in the URL hash) and renders `<node.page />` with no props. No knowledge of page content. |

> *NOTE: The shell shares the same design tokens, primitives (@caro/ui), and widgets (@caro/widgets) as the Tag Registry Admin Tool — consistent look and feel across all CARO_Platform tools.*

### 4.2 Machine Configuration

*Target design (superseded by the as-built model below):* one config folder per machine type, a `tree.js` per folder, and an `HMI_CONFIG` environment variable selecting the active one.

**As built.** Machine-specific content lives in `apps/caro-hmi/client/src/hmi-definitions/`, one folder per `PROJECT_ROOT` value (`Narya1`, `demo`), plus `shared/` for boxes used across systems. Each system folder has a `tree.ts` exporting `tree: TreeNode[]` and a `pages/` folder (Narya1 also has `boxes/`).

```
apps/caro-hmi/client/src/hmi-definitions/
  registry.ts               ← explicit map: PROJECT_ROOT value → () => import('./<folder>/tree.js')
  shared/                   ← boxes reused across systems (HmiStatusBox, ModuleStatusBox, PoleBox, SpecABox, …)
  demo/
    tree.ts
    pages/
  Narya1/
    tree.ts
    pages/
    boxes/
```

```ts
// hmi-definitions/Narya1/tree.ts (abridged)
export const tree: TreeNode[] = [
  { id: 'overview', label: 'System Overview', page: SystemOverviewPage },
  { id: 'rf1',      label: 'RF1',             page: RF1Page },
];
```

There is no `HMI_CONFIG` variable. The server reports `PROJECT_ROOT` (root `.env`) through `GET /api/v1/config`. The client's `Shell` looks it up in `registry.ts` and dynamic-imports that system's tree, so each system is its own code-split chunk. An unregistered or unset root shows the nav tree's "No machine config loaded" state, never a fallback to `demo`. Switching systems means changing `PROJECT_ROOT` and restarting (`Docs/platform/multi_project_runbook.md`). The tree is navigation only; it is independent of the Tag Registry hierarchy.

**Page Components**

Page components are standard React components rendered with no props. They compose shared boxes and widgets (`@caro/widgets`), which locate their tags by asset path (`useResolveAssetPath`, or `useTagSubtree` — Section 6.7). Pages are entirely machine-specific and live in the hmi-definitions folder.

> *NOTE: Pages may use useTagSubtree with any path prefix — the path is not required to match the node's position in the tree. A parent node page may aggregate data from multiple subtrees. A leaf node page may display tags from an unrelated part of the hierarchy. The tree is navigation structure only.*

### 4.3 Client-Side Architecture

The client is organized in four layers. Machine-specific code is confined to `hmi-definitions/`; everything above that layer is reusable across machine configurations.

| Layer | Path | Description |
|---|---|---|
| Shell | `client/src/shell/` | App chrome — Header (global Reset button), sidebar nav, content area. Generic; no machine-specific knowledge. |
| Widgets | `@caro/widgets` | Monitoring and setpoint widgets (NumericMon, NumericSet, BooleanMon, BooleanSet, AnalogIn, Timer, SpectrumChart). Each widget self-wraps with an error boundary via the `withErrorBoundary` HOC — page definitions require no explicit error boundary wrappers. |
| Shared building blocks | `hmi-definitions/shared/` | Reusable layout constants (`styles.ts`) and composite boxes (e.g. RfModuleBox, HmiStatusBox, TrendStatusBox, ModuleStatusBox, PoleBox, SpecABox) built from widgets and shared styles. `ModuleStatusBox` renders `ModuleInfoTable` (WS-driven, §8.8). System-specific boxes live in `hmi-definitions/<system>/boxes/` (Narya1). |
| Page definitions | `hmi-definitions/<system>/pages/` | Pure layout — compose shared building blocks. No business logic. |

---

## 5. Authentication and Authorization

*Not built (§1.1). This section is the target design.* As built, `server/src/middleware/auth-stub.ts` attaches `{ user_id: 'dev', username: 'dev', role: 'supervisor' }` to every request, no endpoint checks a role, and the WebSocket accepts every connection.

Authentication is mandatory in all production environments. Role-based access control (RBAC) shall be enforced server-side.

### 5.1 User Roles and Permissions

| Permission | Operator | Supervisor | Administrator |
|---|---|---|---|
| View real-time dashboard | Yes | Yes | Yes |
| View historical trends | Yes | Yes | Yes |
| View audit logs | No | Yes | Yes |
| Machine Start / Stop | Yes | Yes | No |
| Send setpoint commands | No | Yes | No |
| Configure alarm thresholds | No | Yes | No |
| Create / edit operation modes | No | Yes | No |
| Approve mode activation | No | Yes (self or peer) | No |
| Commission new devices | No | No | Yes |
| View tag registry (read-only) | No | No | Yes |
| Manage users | No | No | Yes |
| Export audit log | No | Yes | Yes |

### 5.2 Supervisor Parameter Change Workflow

- Supervisor may freely adjust setpoint or threshold values in the HMI without immediate authentication challenge.
- Adjusted values are held as pending in the UI. A SET_VALUES command is sent to the device via MQTT `caro/{module_id}/cmd` (QoS1), carrying the changed tag_id/value pairs as an array.
- Before publishing to MQTT, the backend writes a `tag.write.request` entry to the audit log, capturing the actor, tag_id, before value (from LKV), and requested value.
- The backend waits up to 1 second for CMD_ACK from the device (configurable in system_settings). On ACK or timeout the Promise is resolved or rejected to the frontend widget, and a `tag.write.outcome` entry is written to the audit log with the outcome (accepted, rejected, or timeout). The two audit rows share a command_id for correlation.
- The `pending_setpoint_values` table is updated only on CMD_ACK with `accepted=true`. The backend compares the ACK-confirmed value against the active mode revision value (epsilon for f32, strict equality for bool). If within epsilon the tag is removed from pending; if outside epsilon the tag is added or kept in pending with the confirmed value.
- Adjusted values are NOT written to the permanent mode revision table until explicitly saved by the Supervisor.
- On save, the system shall require authentication confirmation (password or valid MFA session token).
- On successful authentication, values are promoted from the temporary table to the permanent mode revision and an audit record is created.
- If authentication fails or the Supervisor cancels, the temporary values remain active on the devices but are not promoted to a saved revision.

### 5.3 Session Policy

- Session timeout: 15 minutes of inactivity for all roles (configurable, minimum 5 minutes).
- MFA required for Supervisor and Administrator roles in production.
- Account locked after 5 consecutive failed login attempts for 15 minutes. Administrator can unlock early.
- All authentication events shall be audited (login, logout, timeout, lockout).

### 5.4 Authentication Implementation Details

The following implementation decisions are locked and shall be used unless a formal security review approves a change.

**Session Management**

Server-side sessions using `express-session` with `connect-pg-simple` store (PostgreSQL). Session data lives only on the server; the client receives only an opaque, httpOnly, Secure, SameSite=Strict session cookie named `caro_sid`.

**User Storage**

A `users` table in PostgreSQL containing: user_id, username, email, password_hash (Argon2id), mfa_secret (base32, encrypted at rest using AES-256-GCM with key stored in server environment — never in the database), role or custom group memberships, failed_attempts, locked_until, last_login.

**Login Sequence**

- POST /api/v1/auth/login with username + password.
- If password is valid and the role requires MFA, return `{ mfa_required: true }`.
- POST /api/v1/auth/verify-mfa with TOTP code — session is created and caro_sid cookie is set.
- Session expires after 15 minutes of inactivity (configurable, minimum 5 minutes).
- POST /api/v1/auth/logout destroys the server-side session record immediately — not just cookie expiry.

**Save-Time MFA Challenge**

When a Supervisor saves pending values (Section 5.2), the frontend triggers a modal requiring a fresh TOTP code or password re-entry. The backend re-validates the current session and MFA without destroying the session. On success, pending values are promoted to the permanent mode revision.

**WebSocket Authentication**

On WSS connection the client automatically sends the caro_sid cookie (standard browser behaviour). The backend WebSocket upgrade handler validates the session via express-session. Once attached, all subsequent WebSocket messages inherit the authenticated user context.

**Security Hardening**

- All cookies: `httpOnly: true, secure: true, sameSite: 'strict'`.
- Argon2id parameters: memory 64 MiB, iterations 2, parallelism 1.
- Account lockout after 5 failed attempts for 15 minutes. Administrator can unlock early.
- Every authentication event (login, MFA verification, timeout, lockout, logout, save-time challenge) is written to the audit log.

**Regulatory Compliance Note**

The current authentication implementation satisfies general industrial security requirements. Additional controls may be required for regulatory compliance in specific deployment contexts:

- 21 CFR Part 11 (FDA) — applicable in pharmaceutical and food manufacturing. May require audit trail tamper-evidence, electronic signature binding to records, and specific access control documentation.
- NERC CIP — applicable if controlling equipment connected to the bulk electric system. May require additional physical/logical access separation, security patch management, and incident reporting.

A formal gap analysis should be conducted before deployment in regulated environments. The above is informational only and does not constitute legal or compliance advice.

---

## 6. Tag-Centric Data Model

CARO_HMI operates exclusively against tags identified by tag_id. The Tag Registry database (PostgreSQL) is the authoritative source for all tag definitions. The HMI backend reads the registry at startup and on change notification.

### 6.1 Tag Registry Fields Used by HMI

| Field | Type | HMI Usage |
|---|---|---|
| tag_id | UINT32 | Primary identifier for all HMI operations: telemetry subscription, setpoint commands, trending queries, alarm binding, audit records. Transmitted as uint32 in all WebSocket messages. |
| tag_path | VARCHAR | Human-readable label displayed in dashboards and trend views. Fetched at startup; used for display only — never as an identifier on the wire. |
| data_type | VARCHAR | Determines input validation and display formatting. Scalar types: `f32`, `i16`, `i32`, `bool`, `string`. Array types: `f32[]`, `i16[]`. Only scalar numeric types (`f32`, `i16`, `i32`, `bool`) are trendable; array types are read-only non-trendable. |
| is_setpoint | BOOLEAN | If true, tag accepts write commands from Supervisor role. If false, tag is monitor-only. |
| meta | JSONB | Provenance chain, ordered **root-to-leaf** (`meta[0]` is the root level). Used for structure only — the `module` ancestor and `useTagSubtree` node types. Display fields come from the columns below. |
| tag_name, unit, format, eng_min, eng_max | VARCHAR / DOUBLE | Resolved by the Tag Registry at apply time and read directly; never re-derived from `meta`. |
| module, module_type | VARCHAR | Module ancestor name and its `Module_Type` (`MQTT` / `HMI`). |
| trends | BOOLEAN | If true, the tag's values are written to TimescaleDB by the telemetry loop. Used to filter time-series persistence — only tagged trends are stored. |

> *NOTE: The HMI always queries only the latest active (non-retired) version of each tag. The HMI never reads template JSON files directly — only the resolved tag_registry table.*

### 6.2 tag_id Wire Format

tag_id is transmitted as uint32 in all Protobuf messages and as a JSON number in MQTT and WebSocket messages (WebSocket `values` objects key it as a decimal string). This matches the uint32 field type in the Protobuf schema defined in CARO_MQTT_Spec Appendix A, and the INTEGER column type in the tag_registry table. tag_path is fetched from the Tag Registry at startup and cached in memory for display purposes only — it is never transmitted on the wire.

### 6.3 Tag Groups and Hierarchy

Each `meta` entry carries a `type` (template type) and `name` (asset_name), ordered root-to-leaf. *Target:* the HMI groups tags by their ancestor asset_names to build navigable dashboards without additional configuration. *As built:* dashboards are hand-written pages (§4.2); hierarchy is used only through asset-path lookup (`useResolveAssetPath`, `useTagSubtree`).

### 6.4 Device-Side Tag Identity

Embedded devices publish telemetry and receive commands using tag_id (uint32) directly. *Target:* devices learn their tag_ids during the module handshake (Section 9). *As built:* the handshake is implemented (CARO_MQTT_Spec §7): a device requests it and binds the tag_ids of the TAG_LIST the backend answers with, by module-relative tag_name; its compiled definitions carry names and types only, never tag_ids. The HMI layer operates exclusively with tag_id and has no knowledge of any device-internal addressing scheme.

### 6.5 Backend In-Memory Tag Map

At startup the backend builds a rich in-memory map keyed by tag_id from the Tag Registry. This map is the primary runtime data structure for all backend operations — command routing, write validation, display labels, and telemetry ingestion. No repeated database queries are needed during normal operation.

As built, each entry is a `TagDef` (`packages/hmi-context/src/types.ts`), built by `server/src/tag-map.ts` from `getActiveTags()`:

| Field | Type | Purpose |
|---|---|---|
| tag_id | number | Map key. Primary identifier for all operations. |
| tag_path | string | Asset path; used for display and asset-path lookup, never as a wire identifier. |
| tag_name | string \| null | Resolved display name (Tag Registry `In_Tag_Name` rule). |
| module_id | string | `name` of the `meta` level whose `type` is `'module'`; `'unknown'` if none. Routes commands to `caro/{module_id}/cmd`. |
| module_type | string | `tag_registry.module_type`, defaulting to `'MQTT'` when null. `CmdController` routes writes and commands on it (MQTT → broker, HMI → HmiTagSource, other → `MODULE_TYPE_NOT_SUPPORTED`). |
| data_type | string | Any `tag_types` value. Not used to validate writes today. |
| is_setpoint | boolean | `POST /tags/write` rejects non-setpoints with `TAG_NOT_WRITABLE`. |
| trendable | boolean | `tag_registry.trends`. Selects historian writes and trend subscriptions. |
| eng_min / eng_max / unit / format | number / string \| null | From the registry columns. eng limits are not enforced server-side. |
| meta | array | Full provenance chain, root-to-leaf. |

The map is built once at startup. It is not rebuilt when a new Tag Registry revision is applied; restart the HMI server after an apply.

### 6.6 Operation Modes

An operation mode is a named, revision-controlled snapshot of setpoint values for one or more tags. Modes allow the Supervisor to define and switch between different operating configurations (e.g. Production-HighSpeed, Maintenance-LowPower, Recipe-ABC-2026Q2) without changing the underlying Tag Registry definitions.

Modes are revision-controlled: each mode has a linear revision history. A new mode may be created by cloning any existing revision of any mode. All setpoint changes performed by a Supervisor are first applied to devices in real time via the pending workflow (Section 5.2) and are permanently stored only when the Supervisor explicitly chooses a target mode and revision at save time.

The current active mode name and revision number are maintained as a system-wide backend state value, sent to frontend clients via WebSocket on connect and on mode change. This allows the frontend to display a status such as 'Currently running: Production-HighSpeed v3' without per-tag tracking in the in-memory map.

*Not built (§1.1) — no mode tables, endpoints or UI exist. Sections 6.6.1–6.6.3 are the target design.*

#### 6.6.1 Data Model

Operation modes are stored in three PostgreSQL tables: `operation_modes`, `mode_revisions`, and `setpoint_values`. Full schema definitions are in CARO_DB_Spec Sections 6.1, 6.2, and 6.3.

Key constraints enforced by the backend:

- Every tag with `is_setpoint = true` must have a value in every mode revision 1 (full snapshot). Subsequent revisions store only changed tags (delta model).
- A mode revision becomes immutable once `activated_at` is set.
- Only one revision may be active system-wide at any time, tracked via `current_active_revision_id` in the `system_settings` table (CARO_DB_Spec Section 8.1).
- `setpoint_values` uses a delta model — revision 1 is always a full snapshot of all setpoint tags; subsequent revisions store only changed tags. Full state for revision N is reconstructed by querying all revisions <= N and taking the latest value per tag_id.

#### 6.6.2 Supervisor Save / Create Workflow

Extension of the pending workflow described in Section 5.2:

- Supervisor adjusts setpoints in the UI — values are immediately sent to devices and held in the temporary pending table.
- When the Supervisor clicks Save, the UI prompts: which mode to save to (dropdown of all modes, or 'Create new mode from current active mode'); optional new mode name and description if creating; required comment.
- On confirmation and MFA the backend creates a new `mode_revisions` row, copies all pending values into `setpoint_values`, removes those tags from `pending_setpoint_values`, and writes a `mode.saved` audit record.
- If creating a new mode, an `operation_modes` row is created first, then the revision.

#### 6.6.3 Activation Workflow

- Only Supervisors may activate a mode revision.
- Activation requires MFA and a mandatory comment.
- On activation the backend sets `mode_revisions.activated_at` and `activated_by`, publishes all setpoint values in that revision to devices via SET_VALUES commands (one per device, each carrying only that device's tags), and updates `current_active_revision_id`.
- Only one revision may be active at any time.

> *NOTE: On backend startup, the LKV cache is NOT pre-populated from the active mode revision. The backend requests a snapshot from each device once it has bound (CARO_MQTT_Spec §7) and builds the LKV from live device telemetry. The active mode revision is used only to display the current mode in the frontend — the device remains the source of truth for actual running values.*

### 6.7 useTagSubtree — Path-Based Subtree Query

The backend in-memory tag map supports a path-prefix subtree query via the `useTagSubtree` hook, exported from `@caro/hmi-context`. Given a dot-separated path prefix, it returns a nested tree of all tag map entries whose tag_path starts with that prefix. The tree is built once at hook call time from the in-memory map — a one-time snapshot.

This enables dashboard panel components to be written against a named path rather than individual tag_ids, making them reusable across multiple machine instances.

#### 6.7.1 Node Shape

Every node in the returned tree — both structural (intermediate) nodes and leaf (tag) nodes — has the same shape:

```js
{
  name: string,        // asset_name at this level in the hierarchy
  type: string,        // template_type from meta (e.g. 'parameter', 'module', 'tag')
  tag: TagDef | null,  // populated only for leaf nodes (type === 'tag')
  children: {          // populated only for structural nodes
    [asset_name: string]: NestedTagNode
  } | null
}
```

#### 6.7.2 Hook Signature

```js
// In @caro/hmi-context
function useTagSubtree(pathPrefix: string): NestedTagNode | null
// Returns null if no tags match the prefix
// Returns the subtree root node if matches found
// One-time snapshot at mount — does not update if registry reloads
```

#### 6.7.3 Construction Algorithm

On call, the hook iterates the full in-memory tag map and selects all entries where tag_path starts with pathPrefix followed by a dot (or equals pathPrefix exactly). For each matching tag it walks the meta array to reconstruct the nested node tree, inserting structural nodes as needed. The result is a tree rooted at the node corresponding to the last segment of pathPrefix.

#### 6.7.4 Example

Given `pathPrefix = 'Plant_A.RF_Module.RF_Fwd'` and a registry containing:

```
Plant_A.RF_Module.RF_Fwd.setpoint        (tag_id: 1003, type: f32, is_setpoint: true)
Plant_A.RF_Module.RF_Fwd.monitor         (tag_id: 1001, type: f32, is_setpoint: false)
Plant_A.RF_Module.RF_Fwd.interlock_enable (tag_id: 1004, type: bool, is_setpoint: true)
```

`useTagSubtree` returns:

```js
{
  name: "RF_Fwd",
  type: "parameter",
  tag: null,
  children: {
    "setpoint": { name: "setpoint", type: "tag", tag: { tag_id: 1003, ... }, children: null },
    "monitor":  { name: "monitor",  type: "tag", tag: { tag_id: 1001, ... }, children: null },
    "interlock_enable": { name: "interlock_enable", type: "tag", tag: { tag_id: 1004, ... }, children: null }
  }
}
```

> *NOTE: Widget validation is the dashboard component's responsibility. If expected tags are missing from the subtree — due to a wrong path or registry change — the component should render a clear error. See hmi_widget_spec Section 6.4 for dashboard panel composition examples.*

---

## 7. MQTT Interface

Full MQTT protocol specification is in `Docs/platform/CARO_MQTT_Spec.md`, including its §1.1 Implementation Status. Backend processing of each message is traced in `Docs/platform/CARO_Telemetry_Path_Reference.md`.

Summary of MQTT channels used by the backend:

| Channel | Direction | Purpose | Status |
|---|---|---|---|
| `caro/{module_id}/telemetry` | Module → Backend | Tag value updates. Change-only or full in normal operation; full snapshot in response to REQUEST_SNAPSHOT. | Built — **JSON only**; Protobuf (the spec's production target) is not decoded yet. |
| `caro/{module_id}/cmd` | Backend → Module | Commands: REQUEST_SNAPSHOT, SET_VALUES, RESET, and module-specific custom command types. JSON envelope with payload object. | Built. |
| `caro/{module_id}/cmd_ack` | Module → Backend | Command acknowledgement or rejection with reason code. | Built. |
| `caro/{module_id}/handshake_backend` | Backend → Module | TAG_LIST (answer to a request), REHANDSHAKE (ask a bound module to re-bind). | Built. |
| `caro/{module_id}/handshake_module` | Module → Backend | HANDSHAKE_REQUEST (with module identity), CONFIRM (missing / unknown names). | Built; identity not verified. |
| `caro/{module_id}/beat` | Backend → Module | Backend heartbeat to each MQTT module, every `HEARTBEAT_INTERVAL_MS` (default 1 s). | Built. |

> *NOTE: Target design: telemetry runs unencrypted on the trusted local LAN (QoS0); command and handshake channels use TLS and QoS1. As built, commands use QoS1 but there is no TLS or broker authentication on any channel. The backend watchdog monitors telemetry continuity — loss of telemetry from a module writes null (bad quality) for all of that module's tags in the LKV cache.*

---

## 8. Backend — Telemetry and WebSocket Bridge

The backend is both a telemetry consumer (receiving device data via MQTT) and a telemetry producer (publishing HMI-internal state via HmiTagSource). All telemetry — regardless of source — flows through a single transport-agnostic `TelemetryIntake` pipeline before reaching the LKV cache and WebSocket clients.

### 8.1 Last-Known-Value Cache

The backend maintains an in-memory last-known-value (LKV) cache keyed by tag_id (uint32). On startup all tags are initialized with `value = null` (bad quality). The cache transitions to a non-null value only when a live telemetry value is received from the device. When a device disconnects or telemetry is lost, the watchdog writes null back to the LKV for all of that module's tags.

Startup sequence:

- Backend loads tag registry from PostgreSQL — builds the full tag_id map with value=null for all tags.
- On each broker connect, including reconnects, the backend sends REHANDSHAKE to every MQTT module. Each module answers with a HANDSHAKE_REQUEST and binds from the TAG_LIST; after its CONFIRM the backend pushes every Set from `commanded_setpoints` and sends REQUEST_SNAPSHOT (CARO_MQTT_Spec Sections 6.3 and 7).
- Devices respond by publishing their current values via the telemetry channel.
- LKV value becomes non-null for each tag as values arrive.
- Frontend clients that connect during this window receive null values on tags not yet heard from — the correct and honest state.

| Cache Entry Field | Type | Description |
|---|---|---|
| tag_id | uint32 | Stable tag identifier from the Tag Registry. |
| value | typed or null | Latest confirmed value from device (`number`, `boolean`, `string`, or `number[]` for array types), or null if not yet received or device disconnected. Null = bad quality. |
| generation | uint32 | Monotonic counter bumped only when value changes (strict equality). Used by the WebSocket pipeline for per-client change detection. |

> *NOTE: There is no separate quality enum — null value means bad quality. There is no per-tag timestamp in the LKV cache. The WebSocket pipeline uses generation counters (not timestamps) to detect which tags have changed since a client's last update.*

**Database writes:** Telemetry is written to TimescaleDB using a module-level timestamp from the MQTT message, not a per-tag timestamp. Each MQTT telemetry message carries one timestamp that is shared by all tags in that message. The DB pipeline receives entries as `{ moduleTs, tags[] }` and writes them in batches.

### 8.2 Telemetry Loop

The backend runs two independent pipelines at decoupled rates:

**WebSocket pipeline (pull-based, default 8 Hz / 125 ms tick):** On each tick, for each connected WebSocket client, compares per-tag generation counters against the client's last-sent generations. Tags with newer generations are included in a JSON DELTA message tailored to that client's subscription set. Each client receives only its subscribed tags — not a shared broadcast.

**DB pipeline (push-based from TelemetryIntake):** For each incoming telemetry message, the trendable tags whose value changed are enqueued with the message's module-level timestamp. Periodic full snapshots (`TrendSnapshotScheduler`, at least one row per trendable tag per minute) and watchdog stall sentinels (null rows) are enqueued the same way. The pipeline flushes in batches to TimescaleDB. This is the sole write path for time-series persistence.

> *NOTE: Ticks with zero changes produce no TimescaleDB writes and no WebSocket traffic for any client.*

### 8.3 Snapshot on Connect

When a WebSocket client sends a SUBSCRIBE message, the backend immediately responds with a SNAPSHOT message containing the current LKV cache values (value only, no timestamps) for all requested tag_ids. This ensures the client has full state without waiting for the next delta tick. After the snapshot, the client receives only DELTA updates for subscribed tags. Null values in the snapshot indicate bad quality (device not yet heard from).

### 8.4 Mode Compliance State


*Not built (§1.1). This section is the target design.*

The backend maintains a `mode_compliance_state` for the active mode revision. This state is displayed in the HMI header alongside the active mode name.

| State | Meaning |
|---|---|
| IN_SYNC | All setpoint tags in the active mode revision match current device telemetry within epsilon. |
| OUT_OF_SYNC | One or more setpoint tags differ from their expected values by more than epsilon. A warning banner is shown in the HMI header, similar to handshake failure warnings. |

The compliance check runs on every incoming telemetry update for a setpoint tag. The comparison is:

```
if |telemetry_value - expected| > epsilon → OUT_OF_SYNC  (f32)
if telemetry_value !== expected → OUT_OF_SYNC             (bool, strict equality)
```

epsilon is a system-wide configurable value stored in system_settings. It applies to all f32 setpoint comparisons. Boolean setpoints use strict equality.

The expected value for each setpoint tag is maintained in the backend in-memory tag map as a single field alongside value, quality, and timestamp. Update rules:

- On backend startup: populated from the active mode revision setpoints.
- On mode activation: updated to the new revision values for all setpoint tags.
- On CMD_ACK with accepted=true: updated to the value from that SET_VALUES command.
- On CMD_ACK with accepted=false or timeout: NOT updated. Expected stays at previous value.

OUT_OF_SYNC latches on the first good→bad transition and does not re-trigger for subsequent drift on the same tag. It clears only on manual reset by any logged-in user. The reset is written to audit_log as `tag.sync.reset`. The latch state is in-memory only — a backend restart clears it, and the next out-of-sync telemetry tick re-asserts it. Telemetry never writes to pending_setpoint_values.

> *NOTE: Quality is represented by null value = bad quality. When a device disconnects, the watchdog writes null to the LKV for affected tags. This null propagates to clients as a normal delta. Frontend widgets check `value === null` to detect bad quality — they do not implement stale detection.*

### 8.5 Command Failure Handling

*Target design; as built there is no audit_log and no status lifecycle — `CmdController` waits 1 s for the CMD_ACK, returns the per-tag results to the caller, and stores accepted values (and every value of a timed-out command) in `commanded_setpoints` for the post-CONFIRM Set push; accepted values also go to `pending_setpoint_values` (CARO_MQTT_Spec §6.2–§6.3).*

Every setpoint write attempt is fully recorded in audit_log via two append-only rows sharing a command_id. The `pending_setpoint_values` table is a clean working-state table only — it contains no command lifecycle fields. Outcome tracking is the exclusive responsibility of audit_log.

| Status | Meaning |
|---|---|
| pending_send | Queued in the pending table, not yet published to MQTT. |
| sent | Published to MQTT broker, awaiting CMD_ACK from device. |
| acked | CMD_ACK received with accepted: true. Device confirmed the value. |
| rejected | CMD_ACK received with accepted: false. Device explicitly declined (OUT_OF_RANGE, INTERLOCKED, etc.). |
| timeout | No CMD_ACK received within 1 second. Outcome unknown — telemetry will resolve. |

The SET_VALUES command timeout is 1 second (configurable in system_settings). On timeout the status is set to timeout and pending state clears. The expected value in the tag map is NOT updated on timeout. The telemetry loop will detect any resulting OUT_OF_SYNC condition naturally.

On backend restart: in-flight commands have no DB state to clean up (pending_setpoint_values has no cmd_status column). Each device re-binds after the restart and is sent a REQUEST_SNAPSHOT (CARO_MQTT_Spec §7). Any resulting telemetry that differs from the active mode revision will assert the out-of-sync latch per Section 8.4.

> *NOTE: timeout and rejected produce the same application behavior — pending state clears, expected value unchanged, no OUT_OF_SYNC raised. The distinction is for observability only: timeout means no response was received; rejected means the device explicitly declined.*

### 8.6 Tag Registry Load

On startup the backend loads the full active tag registry from PostgreSQL via `@caro/db` `getActiveTags()` (DISTINCT ON the latest row per tag_id, non-retired; all columns including module, module_type, trends, tag_name and the display columns). This map is held in memory and used to: validate incoming tag_ids, populate display labels for WebSocket clients, and determine which tags are writable.

> *NOTE: Target design — not built. Nothing in the code issues LISTEN or NOTIFY, and no warning is shown; the backend simply keeps the registry it loaded at startup.* The backend detects Tag Registry changes via PostgreSQL LISTEN/NOTIFY — the Tag Registry Admin Tool fires NOTIFY registry_changes after each apply. However the backend does NOT auto-reload on notification. Auto-reload is unsafe during active device handshakes. Instead the backend displays a persistent HMI warning: 'Tag Registry has been updated — restart backend to apply changes.' An Administrator performs a controlled restart at an appropriate time.*

### 8.7 Audit Log

*Not built (§1.1) — there is no audit_log table and nothing writes audit rows. Sections 8.7.1–8.7.3 are the target design.*

The `audit_log` table (CARO_DB_Spec Section 10) is the authoritative record of all user-initiated and system-initiated events. It is append-only and immutable — rows are never updated or deleted. Full schema is defined in CARO_DB_Spec.

#### 8.7.1 Setpoint Write — Two-Row Pattern

Every setpoint write attempt produces exactly two audit_log rows that share a command_id UUID for correlation:

- `tag.write.request` — written before MQTT publish. Captures actor, tag_id, before_value (LKV snapshot), after_value (requested), command_id, module_id, ip. outcome is NULL.
- `tag.write.outcome` — written on CMD_ACK receipt or 1-second timeout. Captures the same command_id, outcome (accepted / rejected / timeout), after_value (ACK-confirmed value if accepted, NULL otherwise).

#### 8.7.2 Signable Events — meaning and record_hash

For signable events (mode.saved, mode.activated, module.validated), the backend must also populate two additional audit_log columns:
- `meaning` — a human-readable statement of the action's intent, entered or confirmed by the actor at save/activation/validation time.
- `record_hash` — SHA-256 hex digest of the canonical signed payload as defined in CARO_DB_Spec Section 11.2.

These columns are nullable for all other event types. They establish 21 CFR Part 11 readiness from initial deployment. See CARO_DB_Spec Section 11 for the full electronic signature architecture and migration path.

#### 8.7.3 Event Type Reference

All event types written to audit_log:

| event_type | Description |
|---|---|
| tag.write.request | Supervisor initiated a setpoint write. Logged before MQTT publish. |
| tag.write.outcome | CMD_ACK result or timeout. Shares command_id with tag.write.request. outcome: accepted / rejected / timeout. |
| tag.sync.lost | First telemetry good→bad transition for a setpoint tag. Latches — subsequent drift on same tag does not re-trigger. |
| tag.sync.reset | Manual reset of out-of-sync latch by any logged-in user. |
| mode.saved | Supervisor saved pending values as a new mode revision. comment required. |
| mode.activated | Supervisor activated a mode revision. Clears pending_setpoint_values table. comment required. |
| auth.login | Successful user login. |
| auth.logout | User logout (explicit or session timeout). |
| auth.lockout | Account locked after 5 consecutive failed login attempts. |
| auth.mfa | MFA verification event (login or save-time challenge). |
| module.validated | Administrator validated a commissioned module instance. |
| user.created | New user account created by Administrator. |
| user.modified | User account modified or role changed by Administrator. |

### 8.8 HMI-Originated Telemetry (HmiTagSource)

The HMI server is both a telemetry consumer (via MQTT bridge) and a telemetry producer for tags with `module_type = 'HMI'` in the tag registry. These tags represent HMI-internal state (e.g., module count, tag count, system status) that is published into the same telemetry pipeline as device data.

**Architecture:** At startup, the HMI server creates an `HmiTagSource` instance that:
1. Filters the tag registry for `module_type = 'HMI'`
2. Derives typed property names from `tag_path` (strips the module segment, joins remaining segments with `_`; e.g., `CARO_1.HMI.Module_Info.Data_Rate` → `Module_Info_Data_Rate`)
3. Exposes a Proxy-based interface so server code writes values as direct property assignments (e.g., `hmiTags.Module_Info_Module_Count = 11`)
4. Publishes a `TelemetryMessage` to `TelemetryIntake` on a configurable timer (default 250ms, env: `HMI_PUBLISH_INTERVAL_MS`)

**Data path:** HmiTagSource values flow through the same `TelemetryIntake` pipeline as MQTT telemetry — LKV write, generation bump, DB pipeline enqueue, WebSocket delta broadcast. Widgets subscribed to HMI tags receive updates identically to device tags.

**Zero HMI tags:** If the tag registry contains no `module_type = 'HMI'` tags, the HmiTagSource is created with empty maps and publishing is a no-op. No error.

**Transport-agnostic ingestion:** `TelemetryIntake.ingest(moduleId, message)` is the universal entry point for all telemetry regardless of source. `MqttBridge` and `HmiTagSource` are both adapters that call it. Future adapters (OPC-UA, Modbus, REST pollers) follow the same pattern.

**Telemetry_CPU (DutyTracker):** The HMI server measures its own telemetry processing duty cycle and publishes it as the HMI tag `Telemetry_CPU`. A lightweight `DutyTracker` utility (`server/src/duty-tracker.ts`) wraps hot-path functions with `performance.now()` timing:

- `MqttBridge.handleMessage()` — MQTT parse + ingest (telemetry branch)
- `TelemetryIntake.watchdogTick()` — module timeout scan
- `TelemetryIntake` rate timer — per-second stats computation
- `HmiTagSource` publish tick
- `WsServer.tick()` and `WsServer.trendFlush()` — WebSocket delta and trend flushes
- `TrendSnapshotScheduler` tick

The DB flush timer is not tracked.

Each wrapped call accumulates busy-time in milliseconds. Once per second, `DutyTracker.snapshot(intervalMs)` computes `(busyMs / intervalMs) * 100` and resets the accumulator. The result is written to `hmiTags.Telemetry_CPU` via the `onBeforePublish` callback on `HmiTagSource`, so it flows through the standard telemetry pipeline and appears on the dashboard like any other tag.

The snapshot call itself runs outside `track()` so it does not inflate the window it is closing.

**Module_Info tags:** On every publish tick, `HmiTagSource.updateModuleInfoTags()` is called before the telemetry message is assembled. It reads `TelemetryIntake.getModuleStats()` and writes six array/scalar tags under `CARO_1.HMI.Module_Info.*`:

| Tag | Type | Content |
|---|---|---|
| `Module_Info.Module_Count` | `i16` | Number of module groups in the tag map (every distinct module_id, including the HMI module), set once at startup. Used by `ModuleInfoTable` for mismatch detection. |
| `Module_Info.Status` | `i16[]` | Per-module `ModuleStatus` enum value (UNKNOWN=0, OK=1, WARNING=2, FAULT=3, STALLED=4). |
| `Module_Info.Data_Rate` | `f32[]` | Per-module KB/s (bytes ÷ 1024) in the last 1 s window. Bytes are measured as the length of the re-serialised JSON message, not the wire payload. |
| `Module_Info.Pkg_Rate` | `f32[]` | Per-module packets/s in the last measurement window. |
| `Module_Info.Tags_Per_Pkg` | `i16[]` | Per-module tag count from the most recent telemetry packet. |
| `Module_Info.Watchdog` | `i16[]` | Per-module packed-bit watchdog flags. Bit `i` (LSB-first) = 1 if module `i` has a latched watchdog timeout. 16 flags per `i16` word. |

Module ordering in all arrays is determined once at startup by `getModuleNames(tagMap)` — sorted by each module's minimum `tag_id`. The same ordering is used by the `ModuleInfoTable` widget.

### 8.9 Watchdog

The backend watchdog monitors telemetry continuity per module. When a module stops publishing telemetry for longer than the watchdog timeout (default 1 second, env: `WATCHDOG_TIMEOUT_MS`), it is considered stalled.

**Two-Set model:**

| Set | Behaviour | Drives |
|---|---|---|
| `timedOutModules` | Non-latching — added when timeout is detected, removed automatically when fresh telemetry arrives. | LKV null-write for all module tags; `moduleStatus = 'STALLED'` |
| `watchdogLatched` | Latching — added on first timeout, cleared only by explicit manual reset with a fresh `lastSeen`. | Red/green stall indicator in `ModuleInfoTable` (packed-bit watchdog column) |

**Tick:** The watchdog runs on a timer with interval `min(watchdogTimeoutMs, 500ms)` — independent of the configured timeout so sub-second detection is always possible regardless of the timeout value.

**On timeout trip:** All tags for the module are written to `null` in the LKV (bad quality), `moduleStatus` is set to `'STALLED'`, and one null row per trendable tag is enqueued to the historian so trends show a gap. A module never heard from trips on the first tick after startup.

**Auto-recovery:** The next telemetry message sets the module status from its `status` field and writes its values. On the following watchdog tick the module is removed from `timedOutModules` and `CmdController` sends it a REQUEST_SNAPSHOT (HMI module: an immediate publish), so tags that change-only telemetry never re-sends are refilled. Sets are not re-sent on recovery; a module that lost its connection re-binds and gets the post-CONFIRM Set push. The `watchdogLatched` entry persists until manually cleared.

**Manual reset:** `POST /api/v1/reset` (see §8.11). A module's latch is cleared only if `lastSeen` is within `watchdogTimeoutMs` of the reset time — i.e., the module must have resumed communication before it can be cleared.

### 8.10 Command Routing (CmdController)

The `CmdController` is the single dispatch point for all outbound commands. It replaces the earlier `CommandPublisher` and routes by `module_type`:

| module_type | SET_VALUES (`POST /tags/write`) | Broadcast RESET (`POST /reset`) | Command (`POST /commands`) | REQUEST_SNAPSHOT |
|---|---|---|---|---|
| MQTT | Published to `caro/{module_id}/cmd`. ACK tracked, 1-second timeout (`TIMEOUT` per tag). Accepted values, and every value of a timed-out command, stored in `commanded_setpoints`; accepted values also upserted to `pending_setpoint_values`. | Published; fire-and-forget. | Any `cmd_str` published as `command_type`; ACK tracked, 1-second timeout (`TIMEOUT` 504 / `COMMAND_REJECTED`). | After each handshake CONFIRM and on watchdog recovery; fire-and-forget. |
| HMI | Written directly to `HmiTagSource.setValue()`. Immediate accepted result. | Calls `HmiTagSource.reset()`. | `RESET` only → `HmiTagSource.reset()`; anything else `COMMAND_NOT_SUPPORTED` (400). | `HmiTagSource.publishNow()` on recovery. |
| Other | Returns `MODULE_TYPE_NOT_SUPPORTED` rejection for all tags. | Ignored. | Resolves without doing anything. | Ignored. |

The only delivery of stored values is the post-CONFIRM Set push: `HandshakeController` calls `getModuleSetpoints(moduleId)` (every Set of the module from `commanded_setpoints`, `null` where nothing is stored) and `pushSetpoints()`, which publishes them as one SET_VALUES with its ACK tracked. There is no re-delivery on startup or on watchdog recovery.

`MqttBridge` is scoped to MQTT-only modules — heartbeats, REHANDSHAKE and other MQTT commands are never sent to the HMI module. The HMI module receives telemetry via `TelemetryIntake.ingest()` from `HmiTagSource` only.

**HmiTagSource.reset():** Increments the `Reset_Count` HMI tag (if present in the tag registry). The incremented value is published on the next HmiTagSource tick. `Reset_Count` is initialized to `0` at startup (unlike other HMI tags which start as `null`).

### 8.11 System Reset Endpoint

`POST /api/v1/reset` — triggers a fan-out reset via the server-side `ResetBus`. Registered handlers called in order:

1. **watchdog** — calls `TelemetryIntake.resetAllWatchdogs()`, which clears the latch for all modules whose `lastSeen` is fresh.
2. **module-reset** — calls `CmdController.sendResetAll()`, which sends a RESET command to every known module (MQTT via broker, HMI via direct call).

Response: `{ ok: true, data: { reset: ["watchdog", "module-reset"] } }`

The client dispatches a `'system-reset'` CustomEvent on `window` after the response. No HTTP polling is required — module status is reflected in the next `Module_Info.*` tag update via the WebSocket pipeline.

---

## 9. Module Commissioning and Handshake

Before a physical device can participate in the system it must be commissioned. Commissioning binds a module instance defined in the Tag Registry to a physical device and validates firmware and tag-configuration integrity.

### 9.1 Tag Registry Rule — Module Ancestor Required

Every tag must have exactly one ancestor with `template_type = 'module'`. This is enforced via VALIDATE_REQUIRED_PARENT_TYPES in the Tag Registry Admin Tool. It ensures the backend can always resolve a module_id for any tag by walking its meta array. The module asset_name must match the physical device MQTT module_id exactly.

### 9.2 Commissioned Modules Table

The backend maintains a `commissioned_modules` table in PostgreSQL — one row per module instance. Full schema is defined in CARO_DB_Spec Section 5.1.

### 9.3 Commissioning Lifecycle

- A new module instance in the Tag Registry triggers a `commissioned_modules` row with `validated = false`.
- The physical device connects and requests the handshake (see CARO_MQTT_Spec Section 7). The backend holds the identity it reports (`fw_hash`, `tag_registry_template`; `tag_registry_rev` reserved) as pending.
- An Administrator reviews the pending module in the HMI and confirms with a required comment. Validation sets `validated = true` and stores the pending identity as the expected baseline.
- On every subsequent request the backend compares the reported identity against the stored baseline before answering. A mismatch triggers an error condition (CARO_MQTT_Spec §7.3).

> *NOTE: Full handshake protocol — topic names, message types, payload formats, identity verification, and module-relative tag_name rules — are defined in CARO_MQTT_Spec Section 7.*

> *NOTE: Commissioning is not yet implemented. The handshake itself is built (CARO_MQTT_Spec §7.5), but there is no `commissioned_modules` table: the backend binds every MQTT-type module in the registry without checking its identity, and accepts telemetry from any module_id. This section is the target design.*

---

## 10. WebSocket Real-Time API

The frontend opens one WebSocket to `/ws` on the HMI server. All WebSocket messages are JSON (Protobuf encoding is planned for Phase 6). Target design: WSS, with the session validated on upgrade. As built: plain `ws://`, no authentication. Message contracts: `hmi_API_spec.md` §11. Server and client mechanics: `Docs/platform/CARO_Telemetry_Path_Reference.md` §7–§8.

### 10.0 Context Provider Architecture

The client wraps the application in `HmiContextProvider` from `@caro/hmi-context`. The provider is split into two contexts to prevent WS stats ticks from triggering unnecessary re-subscriptions:

| Context | Contents | Update Rate |
|---|---|---|
| `HmiDataContext` | `tagMap`, `tagPathIndex`, `getLiveValue`, `subscribeLiveValue`, `writeTag` | Stable — only changes when the tag map is reloaded |
| `HmiStatsContext` | `wsStats` (connected, latency, subscribed count) | 1 Hz |

`tagPathIndex` is built once when the tag map loads (same lifecycle as `tagMap`); consumers should always resolve asset paths through it rather than scanning `tagMap` directly.

`useLiveValue` depends only on `HmiDataContext`. Stats ticks updating `HmiStatsContext` do not cause `useLiveValue`'s effect to re-run, eliminating WS subscription churn during normal operation. `useLiveValue`'s mount effect does not call `setLiveValue` — the `useState` initializer seeds the first value, and `subscribeLiveValue` delivers the current value synchronously so any post-render drift is reconciled without an extra state update.

### 10.1 Connection Lifecycle

| Event | Behavior |
|---|---|
| Client connects | Target: backend authenticates the session token. As built: every connection is accepted. |
| Client sends SUBSCRIBE | Backend sends a SNAPSHOT with the current values of the newly subscribed tag_ids, then streams DELTA messages for changed tags at up to 8 Hz (`WS_TICK_MS`, 125 ms). |
| Widget mounts | Reconciler adds the tag_id to `desiredRef` and schedules a microtask flush. If the tag_id is not yet in `serverRef`, the next flush emits a batched `SUBSCRIBE` containing this and any other newly-desired tag_ids. |
| Widget unmounts | Reconciler decrements the subscriber refcount for the tag_id. When it hits zero, the tag_id is removed from `desiredRef` and a flush is scheduled; the next flush emits a batched `UNSUBSCRIBE` containing this and any other newly-unwanted tag_ids. |
| Client sends PING | Backend responds with PONG carrying the original timestamp for latency measurement. Ping interval: 5 seconds. |
| Connection drops | The client immediately sets every subscribed tag to null (bad quality) and reconnects with exponential backoff: 1 s, doubling per failed attempt, capped at 30 s. On reconnect the client re-subscribes everything it wants and the backend sends a fresh SNAPSHOT before deltas resume. |

### 10.2 Frontend Auto-Subscription Model

The app wraps its component tree in `HmiContextProvider` from `@caro/hmi-context`. One WebSocket connection is shared across all widgets.

Widgets subscribe by calling `useLiveValue(tagId)`. The hook seeds initial state via the `useState` initializer (`getLiveValue(tagId)`) and registers a per-tag callback via `subscribeLiveValue`. The subscriber refcount for each `tagId` is the size of the callback Set maintained by the provider — no explicit register/unregister API. A widget that calls `useLiveValue` is unsubscribed automatically when it unmounts.

Subscription changes are batched by the level-triggered reconciler described in §10.1: `desiredRef` contains every `tagId` for which at least one hook is currently mounted; `serverRef` contains every `tagId` the client has told the server about. A microtask-batched `flush()` diffs the two sets and emits at most one `SUBSCRIBE` and one `UNSUBSCRIBE` per tick. Same-tick subscribe and unsubscribe of the same `tagId` cancel out — no wire messages.

### 10.3 Frontend State

The frontend does not have a global store. State lives in two places.

**Server-side LKV (`apps/caro-hmi/server/src/lkv.ts`):** `Map<tag_id, { value, generation }>`. Generation is a monotonic counter bumped only when `value` changes (strict equality, element-wise for arrays). The WS server uses per-client generation tracking to send snapshots and deltas without re-transmitting unchanged values.

**Client-side live-value map (`HmiContextProvider.valuesRef`):** `Map<tag_id, { value }>`. Populated on every SNAPSHOT and DELTA message. No generation tracking, no per-tag quality field, no per-tag timestamp. `value === null` is the only bad-quality sentinel. Quality is evaluated backend-side (watchdog writes `null` on telemetry loss); the frontend performs no stale detection.

Per-tag subscribers live in `HmiContextProvider.subscribersRef` (`Map<tag_id, Set<callback>>`). Each `useLiveValue` call registers one callback; it is removed on unmount. When a SNAPSHOT or DELTA arrives, the provider invokes every callback registered for the affected `tag_id`. Only components whose subscribed tag changed receive a state update — this is what enables selective re-renders across dense pages.

### 10.4 Tag Write Flow

Setpoint writes go through the REST API, not WebSocket. The endpoint accepts one or more tag_id/value pairs. The device is the single source of truth.

- User edits a value in a Set_Numeric or Set_Boolean widget and confirms.
- Widget calls `POST /api/v1/tags/write` with a values array of `{ tag_id, value }` pairs and an optional comment.
- Backend validates all tags pre-flight: existence, is_setpoint, and that the value is a number, a boolean, or a numeric string. If any tag fails, WRITE_VALIDATION_FAILED is returned and no MQTT commands are issued. (Target design: authorization and a check against the tag's data_type. Neither is built — auth is stubbed, and any numeric value is accepted for any numeric tag.)
- Backend groups valid tags by module_id and publishes one SET_VALUES command per device via MQTT `caro/{module_id}/cmd` (QoS1).
- Backend writes `tag.write.request` to audit_log (before value from LKV, requested value, actor, command_id). *Not yet built — there is no audit_log table.*
- Device processes the command and responds with CMD_ACK (or 1-second timeout fires). Backend writes `tag.write.outcome` to audit_log. If accepted=true, pending_setpoint_values is updated via epsilon comparison against active mode revision.
- Device reflects the new value in its next telemetry. The LKV cache is updated and the broadcast loop delivers the change to all subscribed WebSocket clients in the normal way.
- If the device rejects the command (OUT_OF_RANGE, INTERLOCKED, etc.), the LKV is never updated and the frontend continues showing the previous confirmed value — no rollback required.

> *NOTE: The Supervisor's widget will briefly show the previous value until the device echoes back via telemetry — typically 150-300 ms on a local network. A pending indicator may be shown on the widget while awaiting the CMD_ACK to communicate that a write is in flight.*

---

## 11. REST API

All REST endpoints shall be prefixed with `/api/v1/` to support future versioning.

| Endpoint Group | Methods | Description | Status |
|---|---|---|---|
| Authentication | POST | POST /auth/login, /auth/logout, /auth/verify-mfa. Refresh not required — sessions extended automatically on activity. | Not built |
| Tag Registry | GET | `GET /tags` (full tag map), `GET /tags/trendable`. Read-only. Single-tag and hierarchy queries are target design. | Partly built |
| Current Values | GET | Read current value of one or more tags by tag_id from the LKV cache. | Not built (values are WebSocket-only) |
| Setpoints | POST | POST /tags/write — write one or more setpoint tag_id/value pairs as an array. Backend fans out one SET_VALUES MQTT command per device. Pre-flight validation; per-tag outcome returned in the HTTP response once each device ACKs or times out. | Built |
| Commands / Reset | POST | `POST /commands` (one module, any command string), `POST /reset` (watchdog latch clear + RESET to all modules). | Built |
| Config | GET | `GET /config` → `{ projectRoot }`. | Built |
| Trends | GET | `GET /trends/tile`, `GET /trends/extent` (trend viewer spec §6). | Built |
| Audit Logs | GET | Query audit records (filters: user, tag_id, event type, time range). | Not built |
| Operation Modes | GET / POST | GET /modes — list modes and latest revision. GET /modes/{mode_id}/revisions — revision history. POST /modes — create new mode (clone optional). POST /modes/{mode_id}/save — save current pending values to a chosen revision (Supervisor + MFA). POST /modes/{revision_id}/activate — activate a revision (Supervisor + MFA). | Not built |
| Device Status | GET | Query online/offline/fault status of connected devices (Administrator only). | Not built (module status is published as `Module_Info.*` tags instead) |

Contracts for the built endpoints: `hmi_API_spec.md` (its §1.1 lists them).

---

## 12. Time-Series Data Retention

*Target tiers:*

| Tier | Resolution | Retention | Storage |
|---|---|---|---|
| High-resolution | 10 samples/sec | 3 months | TimescaleDB (raw) |
| Aggregated | 1 sample/sec | Months 3–6 | TimescaleDB (continuous aggregate) |
| Long-term archive | 1 sample/10 sec | Months 6–12 | TimescaleDB or cold storage |
| Manual archive | N/A | Beyond 1 year | Manual database backup; restore on request |

*As built* (retention policies in `db/timescale/migrations/`):

| Table | Content | Retention |
|---|---|---|
| `tag_samples` | Raw change-of-value samples (plus ≥1 snapshot row per tag per minute) | 14 days |
| `tag_samples_1s_cagg` | 1 s buckets (last / min / max / null_count) | 14 days |
| `tag_samples_10s_cagg` | 10 s buckets | 90 days |
| `tag_samples_1min_cagg` | 1 min buckets | 365 days |
| `tag_samples_10min_cagg` | 10 min buckets | No retention policy (kept indefinitely) |

Raw chunks compress after 10 minutes. Details: `Docs/db/DB_Config_Usage_And_Perf.md`.

### 12.1 Backup and Failure Policy

- Daily backup for both TimescaleDB and PostgreSQL; minimum 30-day backup retention. *(Operational; nothing in the repo schedules backups.)*
- Backend shall implement a local write-ahead buffer for telemetry during DB unavailability (minimum: 1 hour at maximum ingestion rate). *As built:* `DbPipeline` holds at most `TIMESCALE_DB_QUEUE_MAX` (5000) entries in memory and drops the oldest when full; nothing is persisted locally. If TimescaleDB is unreachable at startup, samples go to `NullDbWriter` (discarded) until `HistorianReconnector` connects.
- If WAL buffer fills, HMI shall display a DATA LOSS RISK warning. *As built:* no warning is displayed; drops are counted in the `Trend_Info.Dropped_Pkgs` tag and logged to the server console.
- Recovery procedures shall be documented before production deployment.

---

## 13. Audit and Traceability

See Section 8.7 for full audit log specification.

---

## 14. Non-Functional Requirements

### 14.1 Performance

- HMI dashboard real-time updates: end-to-end latency <= 500 ms under normal conditions.
- REST API read endpoints shall respond within 200 ms for current-state queries.
- Frontend shall sustain 60 FPS rendering with up to 500 active tags updating at 10 Hz.
- WebSocket snapshot delivery on client subscribe shall complete within 1 second for up to 10,000 active tags.
- Protobuf encoding is required for telemetry in production. No JSON fallback for telemetry channels. *As built: the reverse — JSON is the only telemetry encoding the backend accepts.*
- Delta-only WebSocket messages shall be the default — full snapshots only on connect, reconnect, or new subscription.
- The HMI shall display a live performance metrics panel showing: number of registered tags, WebSocket updates/sec, render FPS, active subscriptions, WebSocket latency (ms), and data rate (KB/s). Always visible as a runtime health indicator. *As built* (`client/src/shell/StatsBar.tsx`): connection state, Latency, Render (FPS), Rate (WebSocket messages/s), Data Rate (KB/s), Subscribed (tag count), and Svr CPU (`HMI.Telemetry_CPU`). The registered-tag count is not shown.

> *NOTE: The performance metrics panel is validated by the HMI_Test_1 proof-of-concept. Implementation should reuse the Metrics and StatusBar component patterns from that project.*

### 14.2 Availability

- Local backend services: target 99.5% availability during scheduled machine operation hours.
- Loss of cloud connectivity shall not affect local operation.
- WebSocket client auto-reconnects on connection drop. *As built:* exponential backoff starting at 1 s, doubling per failed attempt, capped at 30 s.
- Database backup policy and telemetry write-ahead buffer requirements are defined in CARO_DB_Spec Section 10.

### 14.3 Security

- All frontend-backend communication shall use TLS 1.2 or higher. *Not built — plain HTTP and `ws://`.*
- MQTT command and ack channels shall use TLS. Telemetry channels are unencrypted on trusted LAN. *Not built — no TLS on any MQTT channel.*
- Secrets shall not be stored in plaintext in source code or configuration files.
- Network zone separation is required between device network, backend LAN, and optional cloud DMZ.

### 14.4 Browser Compatibility

- Supported: Chrome, Firefox, Edge (latest 2 versions each).
- Responsive layout targeting tablets (768px+) and desktop (1280px+).

---

## Open Questions

- Who is the assigned technical authority for this system before production deployment?
- What is the Network Security Plan?
- What is the Protobuf schema version management policy?
- What are the final REST rate limit values?
- What is the Administrator onboarding and credential management process?
- What does the Operations Manual cover and what are the recovery procedures?
- What is the alarm threshold delivery protocol?
- What is the machine state machine definition per machine type?
- What is the cloud sync protocol — telemetry forwarding, authentication, rate limits?
- What does the HMI warning UI look like and what is the controlled restart procedure?
- What is the NTP provisioning strategy — local NTP server for device clock sync?
- What is the correct behavior when a module's reported identity does not match its commissioned baseline?

