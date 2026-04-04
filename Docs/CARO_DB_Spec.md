**CARO_DB_Spec**

*Database Specification*

Version 1.3

Date: 2026-04-02

**Companion Documents**

*Tag Registry Functional Spec v1.17 \| CARO_HMI Functional Spec v2.4 \|
CARO_HMI API Spec v1.4*

**Revision History**

  ------------- ------------ ------------ ------------------------------------------
  **Version**   **Date**     **Author**   **Summary**

  1.0           2026-03-26   PM / Claude  Initial release. Consolidates all
                                          CARO_Platform database schema definitions
                                          previously scattered across Tag Registry
                                          and HMI specs. Covers all PostgreSQL
                                          tables and TimescaleDB stub.

  1.1           2026-03-28   PM / Claude  pending_setpoint_values simplified ---
                                          cmd_status, command_id, rejection_code
                                          removed; table now holds working state
                                          only (tag_id, value, set_by, set_at).
                                          audit_log table added (Section 10) with
                                          full event type reference and two-row
                                          write pattern. Open issue OI-04 resolved.

  1.2           2026-03-28   PM / Claude  audit_log expanded: meaning and
                                          record_hash nullable columns added
                                          (Section 10); populated for signable
                                          events (mode.saved, mode.activated,
                                          module.validated) from initial deployment.
                                          Section 11 (Electronic Signatures ---
                                          Reserved) added: documents 21 CFR Part 11
                                          readiness rationale, hash payload
                                          definition, and migration path to full
                                          electronic_signatures table when required.

  1.3           2026-04-02   PM / Claude  Added trends column to tag_registry
                                          (§3.1): BOOLEAN NOT NULL DEFAULT false,
                                          derived from hierarchy field resolution.
                                          Migration 006 added.
  ------------- ------------ ------------ ------------------------------------------

**1. Purpose**

This document is the authoritative schema reference for all
CARO_Platform databases. All table definitions, constraints, indexes,
and migration conventions are defined here. Companion documents
reference this spec for schema details rather than duplicating table
definitions.

The CARO_Platform uses two database systems:

-   PostgreSQL 17 --- operational data: tag registry, HMI configuration,
    users, sessions, modes, setpoints, commissioning, audit log.

-   TimescaleDB --- time-series telemetry keyed by tag_id (schema TBD
    --- deferred until telemetry persistence is implemented).

**2. Conventions**

**2.1 tag_id Integrity**

tag_id is a uint32 (PostgreSQL INTEGER) throughout the system. Tables
that reference tag_id do NOT use a database-level foreign key to
tag_registry. This is intentional --- tag_registry is append-only with
multiple rows per tag_id (one per registry revision), so a FK would
reference a specific revision row rather than the logical tag identity.

Instead, tag_id integrity is enforced at the application layer: the
backend validates tag_id against the active in-memory tag map (built
from the latest non-retired tag_registry rows) before any write is
accepted.

**2.2 Append-Only Tables**

tag_registry, mode_revisions, setpoint_values, and audit_log are
append-only. Rows are never updated or deleted. Historical state is
reconstructed by querying rows at or before a given revision number.

**2.3 JSONB Value Column**

All tag value columns use JSONB. This handles all current data types
(f64, i32, bool, str) and future array types without schema changes.
Type validation against the tag\'s data_type is performed at the
application layer, not the database.

**2.4 Migration Conventions**

Migration files live in db/postgres/migrations/ and are named
sequentially: 001_create_tag_registry.sql,
002_create_registry_revisions.sql, etc. Migrations are idempotent
(CREATE TABLE IF NOT EXISTS, CREATE INDEX IF NOT EXISTS, ADD COLUMN IF
NOT EXISTS). Run in filename order using setup_dev_db.ps1.

Current migrations:

-   001_create_tag_registry.sql
-   002_create_registry_revisions.sql
-   003_drop_active_path_index.sql
-   004_alter_tag_id_to_integer.sql
-   005_create_hmi_tables.sql (not yet implemented — pending HMI phase)
-   006_add_trends_to_tag_registry.sql

> *NOTE: The schema_migrations table is created programmatically inside
> migrations.js on every runMigrations() call — it is not created via a
> migration file.*

**2.5 Database Names**

Development: caro_dev. Production naming TBD before first production
deployment.

**3. Tag Registry Tables**

Managed exclusively by the Tag Registry Admin Tool. The HMI backend
reads these tables but never writes to them. See Tag Registry Functional
Spec v1.17 for full context.

**3.1 tag_registry**

Append-only. One row per tag per registry revision. The HMI backend
reads only the latest non-retired row per tag_id using DISTINCT ON
(tag_id) ORDER BY tag_id, registry_rev DESC filtered WHERE retired =
false.

  ---------------- ---------------- -------------------------------------
  **Column**       **Type**         **Description**

  id               SERIAL (PK)      Surrogate primary key.

  tag_id           INTEGER NOT NULL Stable numeric tag identifier. Never
                                    reused.

  registry_rev     INTEGER NOT NULL Registry revision when this row was
                                    inserted.

  tag_path         VARCHAR NOT NULL Full dot-separated path starting with
                                    root template name.

  data_type        VARCHAR(40) NOT  Value type: f64, i32, bool, str.
                   NULL             

  is_setpoint      BOOLEAN NOT NULL true = writable setpoint; false =
                                    monitor.

  trends           BOOLEAN NOT NULL true if any asset in the tag's
                   DEFAULT false    hierarchy has a field named
                                    "trends" (case-insensitive) set
                                    to true after instance override
                                    resolution.

  retired          BOOLEAN NOT NULL true if tag no longer in active
                   DEFAULT false    hierarchy.

  meta             JSONB NOT NULL   Provenance chain root-to-tag. Each
                                    entry: { type, name, fields }.
                                    meta[0] is the root level entry;
                                    meta[meta.length - 1] is the tag
                                    level entry.
  ---------------- ---------------- -------------------------------------

> *NOTE: Unique constraint on (tag_id, registry_rev). GIN index on meta.
> B-tree indexes on tag_id, registry_rev, data_type, retired.*

**3.2 registry_revisions**

One row per registry apply action.

  ---------------- ---------------- -------------------------------------
  **Column**       **Type**         **Description**

  registry_rev     INTEGER (PK)     Revision number, auto-incremented.

  applied_by       VARCHAR NOT NULL User who applied the revision.

  applied_at       TIMESTAMPTZ NOT  Timestamp of the apply action.
                   NULL             

  comment          TEXT NOT NULL    Required comment describing the
                                    change.
  ---------------- ---------------- -------------------------------------

**4. Users and Sessions**

**4.1 users**

One row per HMI user account.

  ----------------- ---------------- -------------------------------------
  **Column**        **Type**         **Description**

  user_id           VARCHAR (PK)     Stable unique user identifier.

  username          VARCHAR NOT NULL Login name.
                    UNIQUE           

  email             VARCHAR NOT NULL User email address.
                    UNIQUE           

  password_hash     VARCHAR NOT NULL Argon2id hash. Parameters: memory 64
                                     MiB, iterations 2, parallelism 1.

  mfa_secret        VARCHAR          Base32 TOTP secret, encrypted at rest
                                     with AES-256-GCM. NULL if MFA not yet
                                     configured.

  role              VARCHAR NOT NULL Role name (e.g. operator, supervisor,
                                     administrator) or custom group.

  failed_attempts   INTEGER NOT NULL Consecutive failed login attempts.
                    DEFAULT 0        

  locked_until      TIMESTAMPTZ      NULL if not locked. Set on lockout.

  last_login        TIMESTAMPTZ      Timestamp of last successful login.

  created_at        TIMESTAMPTZ NOT  Account creation timestamp.
                    NULL             

  created_by        VARCHAR          FK → users.user_id. NULL for first
                                     administrator account.
  ----------------- ---------------- -------------------------------------

> *NOTE: mfa_secret encryption key is stored in the server environment
> variable, never in the database.*

**4.2 sessions**

Managed by connect-pg-simple (express-session PostgreSQL store). One row
per active session.

  ---------------- ---------------- -------------------------------------
  **Column**       **Type**         **Description**

  sid              VARCHAR (PK)     Opaque session ID --- value of the
                                    caro_sid cookie.

  sess             JSONB NOT NULL   Session data (user_id, role, last
                                    active timestamp).

  expire           TIMESTAMPTZ NOT  Session expiry time. Expired rows are
                   NULL             cleaned up automatically by
                                    connect-pg-simple.
  ---------------- ---------------- -------------------------------------

> *NOTE: This table is managed entirely by the connect-pg-simple
> library. Do not write to it directly.*

**5. Module Commissioning**

**5.1 commissioned_modules**

One row per module instance as defined in the Tag Registry. Created
automatically when a new module instance appears in the tag registry.
Validated manually by an Administrator.

  -------------------------- ---------------- -------------------------------------
  **Column**                 **Type**         **Description**

  device_id                  VARCHAR (PK)     Module asset_name from the Tag
                                              Registry. Matches the MQTT device_id
                                              exactly.

  validated                  BOOLEAN NOT NULL false = pending Administrator
                             DEFAULT false    validation. true = validated and
                                              operational.

  validated_by               VARCHAR          FK → users.user_id. NULL until
                                              validated.

  validated_at               TIMESTAMPTZ      NULL until validated.

  comment                    TEXT             Required free-text comment entered at
                                              validation time. NULL until
                                              validated.

  expected_fw_hash           VARCHAR          Firmware hash captured from device at
                                              first validation. NULL until
                                              validated.

  expected_tag_config_hash   VARCHAR          Tag-config hash captured from device
                                              at first validation. NULL until
                                              validated.

  created_at                 TIMESTAMPTZ NOT  When this row was created (module
                             NULL             appeared in registry).
  -------------------------- ---------------- -------------------------------------

> *NOTE: device_id must match the module asset_name in the Tag Registry
> meta column exactly. The backend resolves device_id by walking each
> tag\'s meta array to find the ancestor with type = module.*

**6. Operation Modes**

Three-table schema for named, revision-controlled snapshots of setpoint
values. See CARO_HMI Functional Spec v2.4 Section 6.6 for workflow
details.

**6.1 operation_modes**

  ---------------- ---------------- -------------------------------------
  **Column**       **Type**         **Description**

  mode_id          VARCHAR (PK)     Stable unique mode identifier (UUID
                                    or sequential).

  name             VARCHAR NOT NULL Human-readable mode name (e.g.
                   UNIQUE           Production-HighSpeed).

  description      TEXT             Optional description.

  created_by       VARCHAR NOT NULL FK → users.user_id.

  created_at       TIMESTAMPTZ NOT  Creation timestamp.
                   NULL             
  ---------------- ---------------- -------------------------------------

**6.2 mode_revisions**

One row per saved revision of a mode. Append-only --- rows are never
updated after activated_at is set.

  ----------------- ---------------- -------------------------------------
  **Column**        **Type**         **Description**

  revision_id       VARCHAR (PK)     Stable unique revision identifier
                                     (UUID).

  mode_id           VARCHAR NOT NULL FK → operation_modes.mode_id.

  revision_number   INTEGER NOT NULL Sequential revision number within the
                                     mode. Auto-incremented per mode.

  comment           TEXT NOT NULL    Required comment entered at save
                                     time.

  saved_by          VARCHAR NOT NULL FK → users.user_id.

  saved_at          TIMESTAMPTZ NOT  Save timestamp.
                    NULL             

  activated_at      TIMESTAMPTZ      NULL until activated. Set once ---
                                     immutable after.

  activated_by      VARCHAR          FK → users.user_id. NULL until
                                     activated.
  ----------------- ---------------- -------------------------------------

> *NOTE: Unique constraint on (mode_id, revision_number). Once
> activated_at is set the row is immutable --- no further updates
> permitted.*

**6.3 setpoint_values**

Delta-based setpoint value store. Append-only. Revision 1 of any mode
contains a full snapshot of all setpoint tags. Subsequent revisions
contain only changed tags. To reconstruct the full setpoint state for
revision N: query all revisions \<= N for the mode and take the latest
value per tag_id.

  ---------------- ---------------- -------------------------------------
  **Column**       **Type**         **Description**

  revision_id      VARCHAR NOT NULL FK → mode_revisions.revision_id.
                                    Composite PK with tag_id.

  tag_id           INTEGER NOT NULL uint32 tag identifier. No FK ---
                                    validated at application layer
                                    against active tag registry.

  value            JSONB NOT NULL   Setpoint value. Handles f64, i32,
                                    bool, str, and future array types.
  ---------------- ---------------- -------------------------------------

> *NOTE: Composite PK on (revision_id, tag_id).*
>
> *NOTE: tag_id has no database FK to tag_registry. The backend
> validates tag_id against the active in-memory tag map at write time.*
>
> *NOTE: Revision 1 of any mode must contain all active setpoint tags
> (is_setpoint = true). Subsequent revisions contain only tags whose
> values changed from the previous save session.*

**7. Pending Setpoints**

**7.1 pending_setpoint_values**

Working table for in-flight Supervisor setpoint changes. Represents the
set of tags whose confirmed device value differs from the active mode
revision. One row per tag --- only one value per tag at a time.

This table holds working state only. Command lifecycle tracking
(cmd_status, command_id, rejection codes) is handled exclusively by
audit_log (Section 10).

  ---------------- ---------------- -------------------------------------
  **Column**       **Type**         **Description**

  tag_id           INTEGER (PK)     uint32 tag identifier. One pending
                                    value per tag at a time. No FK ---
                                    validated at application layer.

  value            JSONB NOT NULL   Device-confirmed pending setpoint
                                    value (last accepted ACK value).

  set_by           VARCHAR NOT NULL FK → users.user_id. Supervisor who
                                    initiated the last accepted write for
                                    this tag.

  set_at           TIMESTAMPTZ NOT  Timestamp of last accepted ACK for
                   NULL             this tag.
  ---------------- ---------------- -------------------------------------

> *NOTE: Rows are created or updated only on CMD_ACK with accepted=true.
> The backend compares the ACK-confirmed value against the active mode
> revision value (epsilon for f64/i32, strict equality for bool). If
> within epsilon the row is removed; if outside epsilon the row is
> inserted or updated.*
>
> *NOTE: Mode activation clears this table entirely. The backend then
> issues SET_VALUES to all devices; ACKs repopulate the table as needed
> via the standard epsilon comparison.*
>
> *NOTE: Telemetry never writes to this table. Out-of-sync telemetry
> raises a tag.sync.lost audit event and sets the in-memory latch (see
> CARO_HMI Functional Spec v2.4 Section 8.3).*
>
> *NOTE: set_by and set_at are displayed in the frontend save dialog so
> the Supervisor can see who set each pending value and when before
> promoting to a mode revision.*

**8. System Settings**

**8.1 system_settings**

Single-row table holding system-wide runtime state.

  ---------------- ---------------- -------------------------------------
  **Column**       **Type**         **Description**

  key              VARCHAR (PK)     Setting key.

  value            JSONB NOT NULL   Setting value.

  updated_at       TIMESTAMPTZ NOT  Last update timestamp.
                   NULL             

  updated_by       VARCHAR          FK → users.user_id. NULL for
                                    system-initiated updates.
  ---------------- ---------------- -------------------------------------

> *NOTE: Key rows: current_active_revision_id (VARCHAR) --- the
> revision_id of the currently active mode revision. NULL if no mode has
> been activated. epsilon (NUMERIC) --- system-wide tolerance for
> f64/i32 setpoint compliance comparisons. cmd_ack_timeout_ms (INTEGER)
> --- SET_VALUES command ACK timeout in milliseconds (default 1000).*

**9. TimescaleDB --- Telemetry (Deferred)**

TimescaleDB telemetry schema is reserved for future implementation. The
table structure, hypertable configuration, continuous aggregates, and
retention policies will be defined here when telemetry persistence is
implemented.

> *NOTE: TimescaleDB runs as a PostgreSQL extension on a separate
> instance from the operational PostgreSQL database. Connection is
> configured via separate PG\* environment variables (TIMESCALE_HOST,
> TIMESCALE_PORT, etc.).*

**10. Audit Log**

**10.1 audit_log**

Immutable, append-only record of all user-initiated and system-initiated
events. Rows are never updated or deleted. This is the authoritative
source for command lifecycle tracking, compliance audit trails, and
out-of-sync event history.

  ---------------- ---------------- -------------------------------------
  **Column**       **Type**         **Description**

  audit_id         UUID (PK)        Immutable row identifier. Generated
                                    by backend on insert.

  ts               TIMESTAMPTZ NOT  Server timestamp of the event.
                   NULL             Indexed.

  event_type       VARCHAR NOT NULL Event type string. See Section 10.2.

  actor_user_id    VARCHAR          FK → users.user_id. NULL for
                                    system-initiated events (e.g.
                                    tag.sync.lost).

  tag_id           INTEGER          tag_id of the affected tag. NULL if
                                    event is not tag-specific.

  before_value     JSONB            LKV value at the time of the write
                                    request. NULL if not applicable.

  after_value      JSONB            ACK-confirmed value
                                    (tag.write.outcome, accepted only) or
                                    requested value (tag.write.request).
                                    NULL if not applicable.

  command_id       UUID             Correlates tag.write.request and
                                    tag.write.outcome rows for the same
                                    SET_VALUES command. NULL for
                                    non-write events.

  outcome          VARCHAR          accepted / rejected / timeout. NULL
                                    for request rows and non-write
                                    events.

  device_id        VARCHAR          Target device. NULL if event is not
                                    device-specific.

  comment          TEXT             Required for mode.saved and
                                    mode.activated events. NULL
                                    otherwise.

  ip               VARCHAR          Client IP address. NULL for
                                    system-initiated events.

  meaning          TEXT             Human-readable statement of the
                                    action's meaning. Required for
                                    signable events (mode.saved,
                                    mode.activated, module.validated).
                                    NULL for all other event types.
                                    Example: "I hereby approve activation
                                    of mode revision Production-HighSpeed
                                    v3 as the current operating
                                    configuration."

  record_hash      VARCHAR(64)      SHA-256 hex digest of the canonical
                                    signed payload (see Section 11.2).
                                    Required for signable events. NULL
                                    for all other event types.
  ---------------- ---------------- -------------------------------------

> *NOTE: Indexes: ts (B-tree), actor_user_id (B-tree), tag_id (B-tree),
> command_id (B-tree). The command_id index enables efficient lookup of
> both rows in the two-row write pattern. meaning and record_hash are
> nullable --- populated only for signable events. See Section 11 for
> the electronic signature readiness rationale.*
>
> *NOTE: audit_log has no FK to tag_registry for tag_id --- tags may be
> retired after events are written, and the historical record must
> remain intact.*

**10.2 Event Type Reference**

  ---------------------- ------------------------------------------------
  **event_type**         **Description**

  tag.write.request      Supervisor initiated a setpoint write. Written
                         before MQTT publish. before_value populated from
                         LKV. outcome is NULL. Pairs with
                         tag.write.outcome via command_id.

  tag.write.outcome      CMD_ACK received or 1-second timeout fired.
                         outcome: accepted / rejected / timeout.
                         after_value populated only if accepted=true.
                         Pairs with tag.write.request via command_id.

  tag.sync.lost          First good→bad telemetry transition for a
                         setpoint tag. actor_user_id is NULL (system
                         event). Latches --- subsequent drift on same tag
                         does not produce additional rows.

  tag.sync.reset         Manual reset of out-of-sync latch by any
                         logged-in user. actor_user_id populated.

  mode.saved             Supervisor saved pending values as a new mode
                         revision. comment required.

  mode.activated         Supervisor activated a mode revision. Clears
                         pending_setpoint_values. comment required.

  auth.login             Successful user login.

  auth.logout            User logout --- explicit or session timeout.

  auth.lockout           Account locked after 5 consecutive failed login
                         attempts.

  auth.mfa               MFA verification event (login-time or save-time
                         challenge).

  module.validated       Administrator validated a commissioned module
                         instance.

  user.created           New user account created by Administrator.

  user.modified          User account modified or role changed by
                         Administrator.
  ---------------------- ------------------------------------------------

**10.3 Two-Row Write Pattern**

Every setpoint write attempt produces exactly two audit_log rows sharing
a command_id UUID:

-   tag.write.request --- inserted before the SET_VALUES MQTT command is
    published. Captures the before_value (LKV snapshot), the requested
    after_value, actor, device_id, ip, and command_id. outcome is NULL.

-   tag.write.outcome --- inserted on CMD_ACK receipt or 1-second
    timeout. Captures the outcome (accepted / rejected / timeout) and
    the ACK-confirmed after_value (populated only if accepted=true).
    Same command_id as the request row.

To query the full history of a setpoint tag, join on command_id: SELECT
r.ts, r.actor_user_id, r.before_value, r.after_value AS requested,
o.outcome, o.after_value AS confirmed FROM audit_log r JOIN audit_log o
ON r.command_id = o.command_id AND o.event_type = \'tag.write.outcome\'
WHERE r.event_type = \'tag.write.request\' AND r.tag_id = \$1 ORDER BY
r.ts DESC.

**11. Electronic Signatures --- Reserved (21 CFR Part 11 Readiness)**

**11.1 Rationale and Current Status**

21 CFR Part 11 (FDA) may be applicable in pharmaceutical and food
manufacturing deployments. It requires that every critical approval
produce a formal electronic signature record that: identifies the signer
by printed name and date/time; states the meaning of the signature; and
is cryptographically bound to the exact record so it cannot be detached
or repudiated.

Part 11 is not a current deployment requirement. However, the schema and
audit architecture are designed so that full compliance can be added
without disruptive migration when the requirement becomes real. This
section documents that readiness design.

The existing MFA save-time challenge (CARO_HMI Functional Spec v2.4
Section 5.4) already provides the authentication control for "who
approved this." What is currently missing for full Part 11 compliance is
a formal signature record cryptographically bound to the signed data.
The two nullable columns added to audit_log (meaning, record_hash)
establish that binding from initial deployment, at low cost, without
creating a schema that falsely implies compliance.

**11.2 Hash Payload Definition**

The record_hash column in audit_log is a SHA-256 hex digest of a
deterministic canonical payload. The payload is defined per signable
event type as follows. All fields are UTF-8 JSON, keys sorted
alphabetically, no extra whitespace.

**mode.saved**

> { \"event_type\": \"mode.saved\", \"mode_id\": \"\...\",
> \"revision_id\": \"\...\", \"revision_number\": N, \"saved_by\":
> \"\...\", \"saved_at\": \"ISO8601\", \"setpoint_values\": \[ {
> \"tag_id\": N, \"value\": \... }, \... \] }

setpoint_values array is sorted ascending by tag_id. Values are the
exact JSONB values written to setpoint_values rows for this revision.

**mode.activated**

> { \"event_type\": \"mode.activated\", \"mode_id\": \"\...\",
> \"revision_id\": \"\...\", \"revision_number\": N, \"activated_by\":
> \"\...\", \"activated_at\": \"ISO8601\" }

**module.validated**

> { \"event_type\": \"module.validated\", \"device_id\": \"\...\",
> \"validated_by\": \"\...\", \"validated_at\": \"ISO8601\",
> \"expected_fw_hash\": \"\...\", \"expected_tag_config_hash\": \"\...\"
> }

The payload_version is implicitly 1 for all records created under this
schema version. If the canonical payload definition changes in a future
version, a payload_version column will be added to audit_log before any
records are written under the new definition. The backend shall compute
this hash immediately before inserting the audit_log row, using the
exact JSON structure defined above, and the two operations shall occur
in the same database transaction.

**11.3 Migration Path to Full Part 11 Compliance**

When a Part 11 deployment is required, the following additions complete
the compliance posture. No existing data migration is required because
meaning and record_hash are already populated from initial deployment.

**Step 1 --- Create electronic_signatures table**

> CREATE TABLE electronic_signatures ( sig_id UUID PRIMARY KEY DEFAULT
> gen_random_uuid(), audit_id UUID NOT NULL REFERENCES
> audit_log(audit_id), user_id VARCHAR NOT NULL REFERENCES
> users(user_id), signed_at TIMESTAMPTZ NOT NULL DEFAULT now(), meaning
> TEXT NOT NULL, components JSONB NOT NULL, record_hash VARCHAR(64) NOT
> NULL, hmac VARCHAR(128) NOT NULL );

components captures the authentication evidence at signing time: {
\"username\": \"\...\", \"mfa_verified\": true,
\"challenge_token_hash\": \"\...\" }. hmac is HMAC-SHA256 of the full
row using a server-side key stored outside the database (same key
management as mfa_secret). This provides tamper evidence that a
database-only record_hash cannot.

**Step 2 --- Enforce NOT NULL on audit_log.meaning and
audit_log.record_hash for signable events**

Add the following CHECK constraint to audit_log in the v2.0 migration:
CHECK (event_type NOT IN (\'mode.saved\', \'mode.activated\',
\'module.validated\') OR (meaning IS NOT NULL AND record_hash IS NOT
NULL)). Until then, this is enforced at the application layer.

**Step 3 --- Conduct formal gap analysis**

Part 11 also requires audit trail tamper-evidence (addressed by hmac
above), access control documentation, system validation records, and
potentially external audit log export to immutable storage. A qualified
consultant should perform the gap analysis before a regulated
deployment.

> *NOTE: The above is informational only and does not constitute legal
> or compliance advice. Regulatory applicability depends on specific
> deployment context and product classification.*

**12. Backup Policy**

-   Daily backup for both PostgreSQL and TimescaleDB instances.

-   Minimum 30-day backup retention.

-   Backend shall implement a local write-ahead buffer for telemetry
    during DB unavailability (minimum 1 hour at maximum ingestion rate).

-   Recovery procedures shall be documented in the Operations Manual
    before production deployment.

**13. Open Issues**

  -------- ---------------------- ----------- -------------- --------------------
  **\#**   **Issue**              **Owner**   **Priority**   **Target**

  OI-01    Define TimescaleDB     Backend     Low            v1.2
           telemetry table schema                            
           --- hypertable config,                            
           continuous aggregates                             
           for hourly/daily                                  
           rollups, retention                                
           policy per tier.                                  

  OI-02    Define production      Backend /   Medium         v1.2
           database naming        Ops                        
           convention and                                    
           multi-environment                                 
           strategy                                          
           (dev/staging/prod).                               

  OI-03    Define index strategy  Backend     Medium         v1.2
           for setpoint_values                               
           reconstruction query                              
           --- ensure DISTINCT ON                            
           (tag_id) over revision                            
           history performs well                             
           at scale.                                         

  OI-04    RESOLVED in v1.1 ---   ---         ---            Resolved v1.1
           audit_log table                                   
           defined in Section 10.                            
           Captures all user                                 
           actions, command                                  
           lifecycle (two-row                                
           write pattern), and                               
           out-of-sync events.                               
  -------- ---------------------- ----------- -------------- --------------------
