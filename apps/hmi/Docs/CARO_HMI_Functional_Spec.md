# CARO_HMI Functional Specification
**Version:** 2.4
**Date:** 2026-03-28
**Status:** Pending reconciliation — companion doc references and platform changes not yet updated

**Companion Documents**

Tag Registry Functional Spec v1.17 | CARO_MQTT_Spec v1.8 | CARO_DB_Spec v1.3 | CARO_Widget_Spec v1.4

---

## Revision History

| Version | Date | Author | Summary |
|---|---|---|---|
| 2.4 | 2026-03-28 | PM / Claude | Pending setpoint architecture redesigned: audit_log table added (Section 8.6); pending_setpoint_values simplified to (tag_id, value, set_by, set_at) — cmd_status, command_id, rejection_code removed; changeset flow updated (Section 5.2) — backend logs request before MQTT publish, 1-second ACK timeout, pending updated only on accepted ACK via epsilon comparison against active mode revision; mode activation clears pending table entirely; out-of-sync latch redesigned — first good→bad transition logged only, any logged-in user resets, telemetry never writes to pending; OI-09 resolved. |

---

## 1. Introduction

This document defines the functional and non-functional requirements for CARO_HMI, a generic web-based Human Machine Interface for industrial control systems. CARO_HMI is machine-agnostic: it operates against any system whose tags are registered in the CARO Tag Registry.

The Tag Registry Admin Tool (see companion documents) is the single source of truth for all tag definitions, template structures, and registry revisions. The HMI reads this registry at runtime and maps all operations — monitoring, setpoint control, trending, alarming, and auditing — to individual tags identified by their stable tag_id.

Intended audience: System architects, embedded firmware engineers, backend/frontend developers, QA, and HSE reviewers.

Document owner: Product Manager. Technical authority: TBD (assign before production deployment).

---

## 2. Technology Stack

The following technology decisions are locked based on proof-of-concept validation. They shall not be changed without a formal architecture review.

| Layer | Technology | Purpose |
|---|---|---|
| Backend runtime | Node.js 18+ / Express | HTTP server, REST API, MQTT subscriber, WebSocket server |
| Real-time transport | WebSocket (ws library) | Bidirectional streaming between backend and frontend |
| Telemetry encoding | Protocol Buffers 3 (protobufjs) | Binary encoding for telemetry — significant bandwidth reduction over JSON |
| MQTT client | MQTT.js | Subscribe to device telemetry; publish commands and thresholds |
| Database (tag registry) | PostgreSQL | Authoritative tag definitions — read at startup and on change |
| Database (telemetry) | TimescaleDB | Time-series storage keyed by tag_id |
| Frontend framework | React 18 | Component-based UI. Shares the @caro/ui package (design tokens and primitives) with the Tag Registry Admin Tool — consistent look and feel across all CARO_Platform tools. |
| State management | Zustand 4.5+ | Lightweight selective global state — prevents unnecessary re-renders |
| Build tool | Vite 5+ | Dev server with HMR and production bundler |
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
| Backend Server | Node.js / Express. Subscribes to device telemetry via MQTT. Maintains last-known-value cache keyed by tag_id. Bridges MQTT telemetry to WebSocket clients. Reads tag definitions from PostgreSQL Tag Registry at startup. Writes telemetry to TimescaleDB. Authenticates users and enforces RBAC. |
| PostgreSQL (Tag Registry) | Authoritative source of all tag definitions. Read by backend at startup and on registry change notification. Schema defined in Tag Registry Functional Spec v1.16. |
| TimescaleDB | Stores time-series telemetry keyed by tag_id. Supports high-resolution, aggregated, and archived tiers. |
| Web Frontend | React 18 web application. Connects via HTTPS REST + WSS. Displays real-time tag values, trends, and audit logs. Uses Zustand for global state and auto-subscription context for tag management. |
| Cloud Monitoring (optional) | Read-only forwarding of telemetry to cloud. No write-back or remote control permitted. |

> *NOTE: Network zone separation is required: embedded device network, backend LAN, and optional cloud DMZ must be logically or physically separated.*

### 4.1 HMI Shell — Generic Layout

The HMI application is divided into a generic shell and machine-specific content. The shell is identical for any CARO_Platform installation. The machine-specific content is loaded from a configuration folder at startup.

| Area | Generic / Machine-Specific | Description |
|---|---|---|
| Header | Generic | Performance metrics panel, active mode indicator, user info, logout. Always visible. |
| Left nav panel | Machine-specific | Navigation tree rendered from the machine config tree.js. Shell renders the tree generically; content is machine-defined. |
| Main content | Machine-specific | Page component rendered for the selected nav node. Each node has exactly one page component, defined in tree.js. |
| Page router | Generic | Shell reads the selected node id and renders node.page. No knowledge of page content. |

> *NOTE: The shell shares the same design tokens, primitives (@caro/ui), and widgets (@caro/widgets) as the Tag Registry Admin Tool — consistent look and feel across all CARO_Platform tools.*

### 4.2 Machine Configuration

Machine-specific content lives in a configuration folder under `hmi-definitions/`. The active configuration is selected via a single environment variable. Switching machine types requires only a config path change — no shell code changes.

**Folder Structure**

```
apps/caro-hmi/
  hmi-definitions/
    rf-generator/           ← one folder per machine type
      tree.js               ← nav tree definition and page imports (authoritative)
      pages/
        RFModuleOverview.jsx
        RFFwdPage.jsx
        RFRevPage.jsx
        SystemStatusPage.jsx
    cooling-system/         ← another machine config
      tree.js
      pages/
      ...
```

**tree.js**

The tree.js file is the single source of truth for the machine config. It exports the nav tree array with explicit page component references. Every node — parent and leaf — has its own page component. The tree structure is independent of the Tag Registry hierarchy.

```js
// hmi-definitions/rf-generator/tree.js
import { RFModuleOverviewPage } from './pages/RFModuleOverview';
import { RFFwdPage } from './pages/RFFwdPage';
import { RFRevPage } from './pages/RFRevPage';
import { SystemStatusPage } from './pages/SystemStatusPage';

export const tree = [
  {
    id: 'rf_module_1',
    label: 'RF Module 1',
    page: RFModuleOverviewPage,
    children: [
      { id: 'rf_fwd', label: 'RF Forward', page: RFFwdPage },
      { id: 'rf_rev', label: 'RF Reverse', page: RFRevPage }
    ]
  },
  { id: 'system_status', label: 'System Status', page: SystemStatusPage }
];
```

**Environment Config**

```
# .env
HMI_CONFIG=hmi-definitions/rf-generator
```

The HMI shell imports tree.js from the configured path at startup. The shell has no knowledge of page content — it renders node.label in the nav tree and node.page in the main content area.

**Page Components**

Page components are standard React components. They receive the selected tree node as a prop and use `useTagSubtree` (Section 6.6) and widgets (`@caro/widgets`) to compose their content. Pages are entirely machine-specific and live in the hmi-definitions folder.

> *NOTE: Pages may use useTagSubtree with any path prefix — the path is not required to match the node's position in the tree. A parent node page may aggregate data from multiple subtrees. A leaf node page may display tags from an unrelated part of the hierarchy. The tree is navigation structure only.*

---

## 5. Authentication and Authorization

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
- The `pending_setpoint_values` table is updated only on CMD_ACK with `accepted=true`. The backend compares the ACK-confirmed value against the active mode revision value (epsilon for f64/i32, strict equality for bool). If within epsilon the tag is removed from pending; if outside epsilon the tag is added or kept in pending with the confirmed value.
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
| tag_id | UINT32 | Primary identifier for all HMI operations: telemetry subscription, setpoint commands, trending queries, alarm binding, audit records. Transmitted as uint32 in all Protobuf messages. |
| tag_path | VARCHAR | Human-readable label displayed in dashboards and trend views. Fetched at startup; used for display only — never as an identifier on the wire. |
| data_type | VARCHAR | Determines input validation and display formatting (f64, i32, bool, str). |
| is_setpoint | BOOLEAN | If true, tag accepts write commands from Supervisor role. If false, tag is monitor-only. |
| meta | JSONB | Provenance chain (leaf-to-root). Used to group tags in the UI by hierarchy and to display context (asset name, template type). |
| trends | BOOLEAN | If true, the tag's values are written to TimescaleDB by the telemetry loop. Used to filter time-series persistence — only tagged trends are stored. |

> *NOTE: The HMI always queries only the latest active (non-retired) version of each tag. The HMI never reads template JSON files directly — only the resolved tag_registry table.*

### 6.2 tag_id Wire Format

tag_id is transmitted as uint32 in all Protobuf messages and WebSocket traffic. This matches the uint32 field type in the Protobuf schema defined in CARO_MQTT_Spec v1.8 Appendix A, and the INTEGER column type in the tag_registry table. tag_path is fetched from the Tag Registry at startup and cached in memory for display purposes only — it is never transmitted on the wire.

### 6.3 Tag Groups and Hierarchy

The HMI uses the `meta` JSONB array to reconstruct the tag hierarchy for display purposes. Each entry carries a `type` (template type) and `name` (asset_name), ordered leaf-to-root. The HMI groups tags by their ancestor asset_names to build navigable dashboards without requiring additional configuration.

### 6.4 Device-Side Tag Identity

Embedded devices publish telemetry and receive commands using tag_id (uint32) directly. Devices are pre-configured with their assigned tag_ids during the module handshake (Section 8). The HMI layer operates exclusively with tag_id and has no knowledge of any device-internal addressing scheme.

### 6.5 Backend In-Memory Tag Map

At startup the backend builds a rich in-memory map keyed by tag_id from the Tag Registry. This map is the primary runtime data structure for all backend operations — command routing, write validation, display labels, and telemetry ingestion. No repeated database queries are needed during normal operation.

| Field | Type | Purpose |
|---|---|---|
| tag_id | uint32 | Map key. Primary identifier for all operations. |
| tag_path | VARCHAR | Display label for frontend. Never used as identifier on the wire. |
| module_id | string | MQTT module_id derived from the module asset_name in the meta column. Used to route commands to the correct `caro/{module_id}/cmd` topic. |
| data_type | string | Value type (f64, i32, bool, str). Used for write validation and Protobuf encoding. |
| is_setpoint | boolean | If true, tag accepts SET_VALUES commands (via useTagWriter). If false, write attempts are rejected with NOT_AUTHORIZED. |
| eng_min / eng_max | number | Engineering limits. Reserved for future server-side OUT_OF_RANGE pre-validation before commands are sent to devices. |
| meta | array | Full provenance chain. Available for hierarchy grouping and display context. |
| trends | boolean | Whether this tag's values are written to TimescaleDB on each telemetry tick. Sourced from tag_registry.trends column. |

> *NOTE: The module_id for each tag is resolved by walking the tag's meta array and finding the entry where `type === 'module'`. The `name` field of that entry is the module_id. This requires every tag to have exactly one module ancestor — enforced by the VALIDATE_REQUIRED_PARENT_TYPES rule in the Tag Registry (see Section 8.1).*

The in-memory map is rebuilt whenever the backend detects a new Tag Registry revision has been applied by the Tag Registry Admin Tool (see OI-14).

### 6.6 Operation Modes

An operation mode is a named, revision-controlled snapshot of setpoint values for one or more tags. Modes allow the Supervisor to define and switch between different operating configurations (e.g. Production-HighSpeed, Maintenance-LowPower, Recipe-ABC-2026Q2) without changing the underlying Tag Registry definitions.

Modes are revision-controlled: each mode has a linear revision history. A new mode may be created by cloning any existing revision of any mode. All setpoint changes performed by a Supervisor are first applied to devices in real time via the pending workflow (Section 5.2) and are permanently stored only when the Supervisor explicitly chooses a target mode and revision at save time.

The current active mode name and revision number are maintained as a system-wide backend state value, sent to frontend clients via WebSocket on connect and on mode change. This allows the frontend to display a status such as 'Currently running: Production-HighSpeed v3' without per-tag tracking in the in-memory map.

#### 6.6.1 Data Model

Operation modes are stored in three PostgreSQL tables: `operation_modes`, `mode_revisions`, and `setpoint_values`. Full schema definitions are in CARO_DB_Spec v1.3 Sections 6.1, 6.2, and 6.3.

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

> *NOTE: On backend startup, the LKV cache is NOT pre-populated from the active mode revision. The backend sends REQUEST_SNAPSHOT to all devices and builds the LKV from live device telemetry. The active mode revision is used only to display the current mode in the frontend — the device remains the source of truth for actual running values.*

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
Plant_A.RF_Module.RF_Fwd.setpoint        (tag_id: 1003, type: f64, is_setpoint: true)
Plant_A.RF_Module.RF_Fwd.monitor         (tag_id: 1001, type: f64, is_setpoint: false)
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

> *NOTE: Widget validation is the dashboard component's responsibility. If expected tags are missing from the subtree — due to a wrong path or registry change — the component should render a clear error. See CARO_Widget_Spec v1.4 Section 6.4 for dashboard panel composition examples.*

---

## 7. MQTT Interface

Full MQTT protocol specification is in CARO_MQTT_Spec v1.8.

Summary of MQTT channels used by the backend:

| Channel | Direction | Purpose |
|---|---|---|
| `caro/{module_id}/telemetry` | Device → Backend | Tag value updates (Protobuf). Change-only in normal operation; full snapshot in response to REQUEST_SNAPSHOT. |
| `caro/{module_id}/cmd` | Backend → Module | Typed commands: REQUEST_SNAPSHOT, SET_VALUES, RESET. Generic JSON envelope with payload object. |
| `caro/{module_id}/cmd_ack` | Device → Backend | Command acknowledgement or rejection with reason code. |
| `caro/{module_id}/handshake` | Backend → Module | Module handshake messages: schema delivery and tag list. |
| `caro/{module_id}/handshake_ack` | Device → Backend | Handshake acknowledgements and firmware/tag-config hash confirmation. |
| `caro/{module_id}/beat` | Backend → Module | Backend heartbeat published to each module at regular interval. |

> *NOTE: Telemetry runs unencrypted on the trusted local LAN (QoS0). All command and handshake channels use TLS and QoS1. Backend watchdog monitors telemetry continuity — loss of telemetry from a module triggers quality=bad for all of that module's tags in the LKV cache. See CARO_MQTT_Spec v1.8 for full protocol details.*

---

## 8. Backend — Telemetry and WebSocket Bridge

The backend bridges MQTT device telemetry to WebSocket frontend clients. This is the core of the server architecture.

### 8.1 Last-Known-Value Cache

The backend maintains an in-memory last-known-value (LKV) cache keyed by tag_id (uint32). On startup all tags are initialized with quality=bad. The cache transitions to quality=good only when a live telemetry value is received from the device.

Startup sequence:

- Backend loads tag registry from PostgreSQL — builds the full tag_id map with quality=bad for all tags.
- Backend sends a REQUEST_SNAPSHOT command to every known device via `caro/{module_id}/cmd` (see CARO_MQTT_Spec v1.8 Section 6).
- Devices respond by publishing their current values via the telemetry channel.
- LKV transitions to quality=good for each tag as values arrive.
- Frontend clients that connect during this window receive quality=bad on tags not yet heard from — the correct and honest state.

| Cache Entry Field | Type | Description |
|---|---|---|
| tag_id | uint32 | Stable tag identifier from the Tag Registry. |
| value | typed | Latest confirmed value from device (f64, i32, bool, or str). |
| quality | enum | good = live device value received; bad = not yet heard from device, or device disconnected. |
| timestamp | uint64 ms | Unix timestamp of the most recent update. |
| module_id | string | MQTT module_id that last published this tag. |

### 8.2 Telemetry Loop

The backend runs a telemetry loop at up to 10 Hz (100 ms interval). On each tick it:

- Collects all tag_ids whose LKV cache value has changed since the last tick.
- Writes the changed values to TimescaleDB keyed by tag_id and timestamp — this is the sole write path for time-series persistence.
- For each connected WebSocket client, computes the intersection of changed tag_ids with that client's subscription set, encodes only the intersecting tags as a Protobuf message, and sends it to that client. Each client receives a tailored message — not a shared broadcast.

> *NOTE: Ticks with zero changes produce no TimescaleDB writes and no WebSocket traffic for any client.*

### 8.3 Snapshot on Connect

When a WebSocket client sends a SUBSCRIBE message, the backend immediately responds with a SnapshotMessage containing the current LKV cache values for all requested tag_ids. This ensures the client has full state without waiting for the next delta tick. After the snapshot, the client receives only delta updates for subscribed tags.

### 8.4 Mode Compliance State

The backend maintains a `mode_compliance_state` for the active mode revision. This state is displayed in the HMI header alongside the active mode name.

| State | Meaning |
|---|---|
| IN_SYNC | All setpoint tags in the active mode revision match current device telemetry within epsilon. |
| OUT_OF_SYNC | One or more setpoint tags differ from their expected values by more than epsilon. A warning banner is shown in the HMI header, similar to handshake failure warnings. |

The compliance check runs on every incoming telemetry update for a setpoint tag. The comparison is:

```
if |telemetry_value - expected| > epsilon → OUT_OF_SYNC  (f64/i32)
if telemetry_value !== expected → OUT_OF_SYNC             (bool, strict equality)
```

epsilon is a system-wide configurable value stored in system_settings. It applies to all f64 and i32 setpoint comparisons. Boolean setpoints use strict equality.

The expected value for each setpoint tag is maintained in the backend in-memory tag map as a single field alongside value, quality, and timestamp. Update rules:

- On backend startup: populated from the active mode revision setpoints.
- On mode activation: updated to the new revision values for all setpoint tags.
- On CMD_ACK with accepted=true: updated to the value from that SET_VALUES command.
- On CMD_ACK with accepted=false or timeout: NOT updated. Expected stays at previous value.

OUT_OF_SYNC latches on the first good→bad transition and does not re-trigger for subsequent drift on the same tag. It clears only on manual reset by any logged-in user. The reset is written to audit_log as `tag.sync.reset`. The latch state is in-memory only — a backend restart clears it, and the next out-of-sync telemetry tick re-asserts it. Telemetry never writes to pending_setpoint_values.

> *NOTE: Quality is evaluated by the backend per tag. When quality changes (good/uncertain/bad) it is pushed to clients as a delta via the normal telemetry loop. Frontend widgets do not implement stale detection — they render whatever quality the backend sends.*

### 8.5 Command Failure Handling

Every setpoint write attempt is fully recorded in audit_log via two append-only rows sharing a command_id. The `pending_setpoint_values` table is a clean working-state table only — it contains no command lifecycle fields. Outcome tracking is the exclusive responsibility of audit_log.

| Status | Meaning |
|---|---|
| pending_send | Queued in the pending table, not yet published to MQTT. |
| sent | Published to MQTT broker, awaiting CMD_ACK from device. |
| acked | CMD_ACK received with accepted: true. Device confirmed the value. |
| rejected | CMD_ACK received with accepted: false. Device explicitly declined (OUT_OF_RANGE, INTERLOCKED, etc.). |
| timeout | No CMD_ACK received within 1 second. Outcome unknown — telemetry will resolve. |

The SET_VALUES command timeout is 1 second (configurable in system_settings). On timeout the status is set to timeout and pending state clears. The expected value in the tag map is NOT updated on timeout. The telemetry loop will detect any resulting OUT_OF_SYNC condition naturally.

On backend restart: in-flight commands have no DB state to clean up (pending_setpoint_values has no cmd_status column). The backend sends REQUEST_SNAPSHOT to all devices on reconnect. Any resulting telemetry that differs from the active mode revision will assert the out-of-sync latch per Section 8.4.

> *NOTE: timeout and rejected produce the same application behavior — pending state clears, expected value unchanged, no OUT_OF_SYNC raised. The distinction is for observability only: timeout means no response was received; rejected means the device explicitly declined.*

### 8.6 Tag Registry Load

On startup the backend loads the full active tag registry from PostgreSQL (`SELECT tag_id, tag_path, data_type, is_setpoint, meta FROM tag_registry WHERE retired = false` using DISTINCT ON to get the latest revision per tag_id). This map is held in memory and used to: validate incoming tag_ids, populate display labels for WebSocket clients, and determine which tags are writable.

> *NOTE: The backend detects Tag Registry changes via PostgreSQL LISTEN/NOTIFY — the Tag Registry Admin Tool fires NOTIFY registry_changes after each apply. However the backend does NOT auto-reload on notification. Auto-reload is unsafe during active device handshakes. Instead the backend displays a persistent HMI warning: 'Tag Registry has been updated — restart backend to apply changes.' An Administrator performs a controlled restart at an appropriate time. See OI-14.*

### 8.7 Audit Log

The `audit_log` table (CARO_DB_Spec Section 10) is the authoritative record of all user-initiated and system-initiated events. It is append-only and immutable — rows are never updated or deleted. Full schema is defined in CARO_DB_Spec v1.3.

#### 8.7.1 Setpoint Write — Two-Row Pattern

Every setpoint write attempt produces exactly two audit_log rows that share a command_id UUID for correlation:

- `tag.write.request` — written before MQTT publish. Captures actor, tag_id, before_value (LKV snapshot), after_value (requested), command_id, module_id, ip. outcome is NULL.
- `tag.write.outcome` — written on CMD_ACK receipt or 1-second timeout. Captures the same command_id, outcome (accepted / rejected / timeout), after_value (ACK-confirmed value if accepted, NULL otherwise).

#### 8.7.2 Signable Events — meaning and record_hash

For signable events (mode.saved, mode.activated, module.validated), the backend must also populate two additional audit_log columns:
- `meaning` — a human-readable statement of the action's intent, entered or confirmed by the actor at save/activation/validation time.
- `record_hash` — SHA-256 hex digest of the canonical signed payload as defined in CARO_DB_Spec v1.3 Section 11.2.

These columns are nullable for all other event types. They establish 21 CFR Part 11 readiness from initial deployment. See CARO_DB_Spec v1.3 Section 11 for the full electronic signature architecture and migration path.

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

---

## 9. Module Commissioning and Handshake

Before a physical device can participate in the system it must be commissioned. Commissioning binds a module instance defined in the Tag Registry to a physical device and validates firmware and tag-configuration integrity.

### 9.1 Tag Registry Rule — Module Ancestor Required

Every tag must have exactly one ancestor with `template_type = 'module'`. This is enforced via VALIDATE_REQUIRED_PARENT_TYPES in the Tag Registry Admin Tool. It ensures the backend can always resolve a module_id for any tag by walking its meta array. The module asset_name must match the physical device MQTT module_id exactly.

### 9.2 Commissioned Modules Table

The backend maintains a `commissioned_modules` table in PostgreSQL — one row per module instance. Full schema is defined in CARO_DB_Spec v1.3 Section 5.1.

### 9.3 Commissioning Lifecycle

- A new module instance in the Tag Registry triggers a `commissioned_modules` row with `validated = false`.
- The physical device connects and the backend executes the handshake (see CARO_MQTT_Spec v1.8 Section 7). The backend holds received firmware and tag-config hashes as pending.
- An Administrator reviews the pending module in the HMI and confirms with a required comment. Validation sets `validated = true` and stores the pending hashes as the expected baseline.
- On every subsequent connection the backend re-runs the handshake and compares received hashes against the stored baseline. A mismatch triggers an error condition (behavior TBD — see OI-15).

> *NOTE: Full handshake protocol — topic names, message types, payload formats, hash validation, and tag_path truncation rules — are defined in CARO_MQTT_Spec v1.8 Section 7.*

---

## 10. WebSocket Real-Time API

The frontend establishes a WSS connection after authentication. The backend bridges MQTT device telemetry to WebSocket clients using the Protobuf message format defined in CARO_MQTT_Spec v1.8 Appendix A.

### 10.1 Connection Lifecycle

| Event | Behavior |
|---|---|
| Client connects | Backend authenticates session token. Connection accepted or rejected. |
| Client sends SUBSCRIBE | Backend sends SnapshotMessage for requested tag_ids, then begins streaming DeltaMessages for changed tags at up to 10 Hz. |
| Widget mounts | Auto-subscription context adds its tag_ids to the unified subscription set and sends an updated SUBSCRIBE message. |
| Widget unmounts | Auto-subscription context removes its tag_ids and sends an updated SUBSCRIBE message (or UNSUBSCRIBE if set is now empty). |
| Client sends PING | Backend responds with PONG carrying the original timestamp for latency measurement. Ping interval: 5 seconds. |
| Connection drops | Backend marks all subscribed tags as quality=bad in the client's view. Client auto-reconnects after 3 seconds. On reconnect, a fresh SnapshotMessage is sent before deltas resume. |

### 10.2 Frontend Auto-Subscription Model

The frontend uses a `TagSubscriptionContext` provider that wraps the entire application. This context:

- Tracks which tag_ids each mounted widget has registered as a dependency.
- Maintains a single unified WebSocket subscription for all widgets — one connection shared across all components.
- Debounces subscription updates by 100 ms to avoid subscription churn during rapid mounts and unmounts.
- Sends a single SUBSCRIBE message containing all currently needed tag_ids whenever the set changes.
- Auto-unsubscribes when widgets unmount — no manual lifecycle management required in widget code.

Widget implementation pattern:

```js
// Inside any widget component:
const tagValue = useTagStore(state => state.tags[tagId]);
useRegisterTags([tagId1, tagId2], 'MyWidget');
// Subscription is automatic — no useEffect or subscribe() call needed
```

### 10.3 Frontend State — Zustand Store

The global Zustand store shape:

```js
{
  tags: { [tag_id: uint32]: { value, quality, timestamp, module_id } },
  connected: boolean,
  updateCount: number,
  latency: number | null,
  subscribedCount: number
}
```

Components subscribe to specific tag slices using Zustand selectors. Only the components displaying a changed tag_id re-render on each delta update. This selective re-render pattern is what enables 60 FPS rendering with hundreds of simultaneously active tags.

### 10.4 Tag Write Flow

Setpoint writes go through the REST API, not WebSocket. The endpoint accepts one or more tag_id/value pairs. The device is the single source of truth.

- User edits a value in a Set_Numeric or Set_Boolean widget and confirms.
- Widget calls `POST /api/v1/tags/write` with a values array of `{ tag_id, value }` pairs and a required comment.
- Backend validates all tags pre-flight: authorization, existence, is_setpoint, and data type. If any tag fails, WRITE_VALIDATION_FAILED is returned and no MQTT commands are issued.
- Backend groups valid tags by module_id and publishes one SET_VALUES command per device via MQTT `caro/{module_id}/cmd` (QoS1).
- Backend writes `tag.write.request` to audit_log (before value from LKV, requested value, actor, command_id).
- Device processes the command and responds with CMD_ACK (or 1-second timeout fires). Backend writes `tag.write.outcome` to audit_log. If accepted=true, pending_setpoint_values is updated via epsilon comparison against active mode revision.
- Device reflects the new value in its next telemetry. The LKV cache is updated and the broadcast loop delivers the change to all subscribed WebSocket clients in the normal way.
- If the device rejects the command (OUT_OF_RANGE, INTERLOCKED, etc.), the LKV is never updated and the frontend continues showing the previous confirmed value — no rollback required.

> *NOTE: The Supervisor's widget will briefly show the previous value until the device echoes back via telemetry — typically 150-300 ms on a local network. A pending indicator may be shown on the widget while awaiting the CMD_ACK to communicate that a write is in flight.*

---

## 11. REST API

All REST endpoints shall be prefixed with `/api/v1/` to support future versioning.

| Endpoint Group | Methods | Description |
|---|---|---|
| Authentication | POST | POST /auth/login, /auth/logout, /auth/verify-mfa. Refresh not required — sessions extended automatically on activity. |
| Tag Registry | GET | Query active tags, tag metadata, tag hierarchy from the registry. Read-only. |
| Current Values | GET | Read current value of one or more tags by tag_id from the LKV cache. |
| Setpoints | POST | POST /tags/write — write one or more setpoint tag_id/value pairs as an array. Backend fans out one SET_VALUES MQTT command per device. Pre-flight validation; partial device failures reported per tag via WebSocket. |
| Trends | GET | Query time-series data by tag_id (time range, resolution, aggregation level). |
| Audit Logs | GET | Query audit records (filters: user, tag_id, event type, time range). |
| Operation Modes | GET / POST | GET /modes — list modes and latest revision. GET /modes/{mode_id}/revisions — revision history. POST /modes — create new mode (clone optional). POST /modes/{mode_id}/save — save current pending values to a chosen revision (Supervisor + MFA). POST /modes/{revision_id}/activate — activate a revision (Supervisor + MFA). |
| Device Status | GET | Query online/offline/fault status of connected devices (Administrator only). |

---

## 12. Time-Series Data Retention

| Tier | Resolution | Retention | Storage |
|---|---|---|---|
| High-resolution | 10 samples/sec | 3 months | TimescaleDB (raw) |
| Aggregated | 1 sample/sec | Months 3–6 | TimescaleDB (continuous aggregate) |
| Long-term archive | 1 sample/10 sec | Months 6–12 | TimescaleDB or cold storage |
| Manual archive | N/A | Beyond 1 year | Manual database backup; restore on request |

### 12.1 Backup and Failure Policy

- Daily backup for both TimescaleDB and PostgreSQL; minimum 30-day backup retention.
- Backend shall implement a local write-ahead buffer for telemetry during DB unavailability (minimum: 1 hour at maximum ingestion rate).
- If WAL buffer fills, HMI shall display a DATA LOSS RISK warning.
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
- Protobuf encoding is required for telemetry in production. No JSON fallback for telemetry channels.
- Delta-only WebSocket messages shall be the default — full snapshots only on connect, reconnect, or new subscription.
- The HMI shall display a live performance metrics panel showing: number of registered tags, WebSocket updates/sec, render FPS, active subscriptions, WebSocket latency (ms), and data rate (KB/s). Always visible as a runtime health indicator.

> *NOTE: The performance metrics panel is validated by the HMI_Test_1 proof-of-concept. Implementation should reuse the Metrics and StatusBar component patterns from that project.*

### 14.2 Availability

- Local backend services: target 99.5% availability during scheduled machine operation hours.
- Loss of cloud connectivity shall not affect local operation.
- WebSocket client auto-reconnects after 3-second backoff on connection drop.
- Database backup policy and telemetry write-ahead buffer requirements are defined in CARO_DB_Spec v1.3 Section 10.

### 14.3 Security

- All frontend-backend communication shall use TLS 1.2 or higher.
- MQTT command and ack channels shall use TLS. Telemetry channels are unencrypted on trusted LAN.
- Secrets shall not be stored in plaintext in source code or configuration files.
- Network zone separation is required between device network, backend LAN, and optional cloud DMZ.

### 14.4 Browser Compatibility

- Supported: Chrome, Firefox, Edge (latest 2 versions each).
- Responsive layout targeting tablets (768px+) and desktop (1280px+).

---

## 15. Open Issues and Decisions Required

| # | Issue | Owner | Priority | Target |
|---|---|---|---|---|
| OI-01 | Define Network Security Plan (firewall rules, zone separation between device network, backend LAN, and cloud DMZ). | IT Security | High | v1.5 |
| OI-02 | Define full Protobuf schema version management policy — how schema versions are distributed to devices and frontend clients. | Backend / FW Eng | High | v1.5 |
| OI-03 | Define heartbeat interval and watchdog timeout final values. | FW Eng / Backend | Medium | v1.5 |
| OI-05 | Define REST rate limits (final value). | Backend Eng | Medium | v1.5 |
| OI-06 | Define Administrator onboarding and credential management procedures. | IT Security / PM | Medium | v1.5 |
| OI-07 | Define Operations Manual and recovery procedures. | Ops / Backend | Medium | v1.4 |
| OI-08 | Define alarm threshold delivery protocol — full snapshot vs delta on device reconnect; versioning and acknowledgement. | Backend / FW Eng | High | v1.5 |
| OI-10 | Define machine state machine per machine type — stored as Tag Registry metadata or separate config. | PM / Process Eng | Medium | v1.5 |
| OI-11 | Cloud sync protocol — telemetry forwarding format, auth, and rate limits. | Backend / Cloud | Low | v1.4 |
| OI-12 | Define MQTT topic ACL policy and per-device credential provisioning process. | IT Security / FW Eng | High | v1.5 |
| OI-14 | LISTEN/NOTIFY mechanism decided (v2.2): backend listens on registry_changes NOTIFY channel. Auto-reload intentionally NOT implemented — unsafe during active device handshakes. Backend raises HMI warning on notification. Remaining open: define the HMI warning UI component and the controlled restart procedure. | Backend | Medium | v2.3 |
| OI-15 | NTP provisioning: CARO_Platform must provision a local NTP server for device clock synchronization. Device onboarding procedure and NTP server configuration TBD. | Backend / Ops | Medium | v2.4 |
| OI-16 | Define hash mismatch behavior — whether firmware hash or tag-config hash mismatches on reconnect fully block the device (no telemetry, no commands) or put it in a flagged/degraded state. Decision requires HSE and process engineering input. | PM / HSE / Process Eng | High | v1.5 |
