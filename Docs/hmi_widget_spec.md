# CARO_Widget_Spec — HMI Widget Specification
**Date:** 2026-03-26
**Companion Documents**

hmi_functional_spec | hmi_API_spec | CARO_DB_Spec

---

## Revision History

| Version | Date | Author | Summary |
|---|---|---|---|
| 1.0 | 2026-03-26 | PM / Claude | Initial release. Widget contract (onSubscribe / onWrite), quality and pending state standards, Numeric_Mon, Numeric_Set, Boolean_Mon, Boolean_Set. Dashboard composition pattern and evolution path documented. |
| 1.1 | 2026-03-26 | PM / Claude | onSubscribe handler gains timestamp parameter (Unix ms); tag registry object prop replaces individual min/max/unit/decimalPlaces props; onWrite Promise now rejects on device CMD_ACK rejection; alarm status deferred to dedicated alarm widgets; OI-02 closed. |
| 1.2 | 2026-03-26 | PM / Claude | Architecture redesigned around useLiveValue / useTagWriter hooks via @caro/hmi-context peer dependency. Widgets no longer accept onSubscribe / onWrite props. isPending lives in useWriteTag, cleared on Promise resolution. useTag is purely a read path. Dashboard composition simplified to single tag prop per widget. |
| 1.3 | 2026-03-26 | PM / Claude | Fix 1: usage examples updated to hook-based API. Fix 2: Section 6.3 evolution note updated. Fix 3: companion doc version corrected. Fix 4: OI-05 reworded for hook contract. Section 6.4 added: useTagSubtree reference with nested node shape and dashboard panel example. |
| 1.4 | 2026-03-26 | PM / Claude | useTag renamed to useLiveValue (granular single-tag subscription for efficient partial re-renders). useWriteTag renamed to useTagWriter. write() accepts single {tagId,value} or array for batch writes. isPending/error keyed by tagId. Quality is backend-evaluated and pushed as delta — no frontend stale logic. OI-05 closed. Companion docs updated. |
| 1.5 | 2026-04-08 | PM / Claude | Quality enum removed — null value = bad quality. LiveValue.timestamp removed. Widget `tag` prop replaced with `assetPath` string + useResolveAssetPath. Meta field resolution rule: root-to-leaf, first match wins. Decimal formatting from tag.meta format field. Dashboard examples updated. |

---

## 1. Purpose

This document defines the `@caro/widgets` package — a collection of React components for displaying and interacting with live tag values in CARO_Platform HMI applications. Widgets are transport-agnostic: they receive data and send writes through injected functions, with no direct dependency on Zustand, WebSocket, or REST APIs.

Intended audience: Frontend developers implementing widgets, developers composing dashboards, and QA engineers writing widget tests.

---

## 2. Package

### 2.1 Location

The `@caro/widgets` package lives at `packages/widgets/` in the CARO_Platform monorepo alongside `@caro/ui` and `@caro/db`.

| Package | Path | Purpose |
|---|---|---|
| `@caro/ui` | `packages/ui/` | Stateless primitives (Button, Input, Modal). Zero domain knowledge. No runtime dependencies. |
| `@caro/widgets` | `packages/widgets/` | Tag-bound HMI widgets. Depends on React only. Transport injected via props. |
| `@caro/db` | `packages/db/` | PostgreSQL pool. Server-side only. |

### 2.2 Dependencies

`@caro/widgets` has no runtime dependencies beyond React. It does NOT depend on Zustand, any WebSocket library, or any HTTP client. These are peer dependencies of the HMI application, not the widget package.

> *NOTE: `@caro/widgets` may import primitives from `@caro/ui` (Button, Input, Badge) and Tailwind utility classes for styling. It must never import from `@caro/db` or any server-side module.*

---

## 3. Widget Contract

Widgets in `@caro/widgets` use two custom hooks provided by the `@caro/hmi-context` peer dependency. The hooks are called internally — no subscription or write props are needed on any widget.

### 3.1 @caro/hmi-context Peer Dependency

`@caro/widgets` lists `@caro/hmi-context` as a peer dependency. This package lives at `packages/hmi-context/` in the monorepo and exports the hooks and provider that connect widgets to the HMI application transport layer. The HMI application wraps its component tree in the provider; widgets call the hooks internally.

| Package | Exports |
|---|---|
| `@caro/hmi-context` | HmiContextProvider, useLiveValue, useTagWriter, useTagMap |
| `@caro/widgets` | NumericMon, NumericSet, BooleanMon, BooleanSet (and future widgets) |

### 3.2 useLiveValue

`useLiveValue(tagId)` — called internally by every widget on mount. Returns the live value for the given tag_id. Purely a read path — no write awareness.

```ts
// Signature (in @caro/hmi-context)
export function useLiveValue(tagId: number): {
  value: number | boolean | string | null  // null = bad quality (device not connected or value not yet received)
}
```

Quality is represented by `value === null`. There is no separate quality enum or timestamp field. When a device disconnects or telemetry is lost, the backend watchdog writes null to the LKV cache, which propagates to clients. Widgets check `value === null` to render the bad-quality state.

The HmiContextProvider implementation subscribes to the WebSocket layer and maintains a last-known-value cache. On mount, the backend sends a SNAPSHOT for the tag_id so useLiveValue returns the current value immediately without waiting for the next delta.

### 3.3 useTagWriter

`useTagWriter()` — called by setpoint widgets. Returns a write function and per-tag pending and error state. `write()` accepts either a single `{tagId, value}` pair or an array for batch writes. `isPending` and `error` are keyed by tagId so multi-tag widgets can show state per tag independently.

```ts
// Signature (in @caro/hmi-context)
export function useTagWriter(): {
  write: (tagId: number, value: any) => Promise<void>,
  isPending: (tagId: number) => boolean,
  error: (tagId: number) => string | null
}
// write() resolves on CMD_ACK accepted: true
// write() rejects on network error, backend validation failure,
//   or device rejection (CMD_ACK with accepted: false)
// isPending clears in the finally block — guaranteed regardless of outcome
```

The write function calls `POST /api/v1/tags/write`. isPending is managed entirely within useTagWriter — widgets do not track pending state independently.

```ts
// useTagWriter implementation sketch
export function useTagWriter() {
  const [pending, setPending] = useState<Record<number, boolean>>({});
  const [errors, setErrors] = useState<Record<number, string | null>>({});
  const writeFn = useTagWriteInternal(); // REST call from HmiContextProvider

  const write = async (tagId: number, value: any) => {
    setPending(p => ({ ...p, [tagId]: true }));
    setErrors(e => ({ ...e, [tagId]: null }));
    try {
      await writeFn(tagId, value);
    } catch (err) {
      setErrors(e => ({ ...e, [tagId]: err.message }));
      throw err;
    } finally {
      setPending(p => ({ ...p, [tagId]: false }));
    }
  };

  return {
    write,
    isPending: (tagId: number) => !!pending[tagId],
    error: (tagId: number) => errors[tagId] ?? null
  };
}
```

### 3.4 Widget Lifecycle

1. Widget mounts. Calls `useLiveValue(tag.tag_id)` — subscribes to live value. Calls `useTagWriter()` if setpoint widget.
2. HmiContextProvider triggers WebSocket SUBSCRIBE. Backend sends SNAPSHOT. useLiveValue returns current value immediately.
3. Widget displays value. Subsequent deltas update useLiveValue automatically.
4. For setpoint widgets: user edits value and confirms. Widget calls `write(tag.tag_id, newValue)`. `isPending(tag.tag_id)` becomes true. Input locked.
5. `write()` Promise resolves (CMD_ACK accepted: true). finally block clears isPending. Widget shows confirmed value.
6. `write()` Promise rejects (network error or device rejection). finally block clears isPending. `error(tag.tag_id)` is set. Widget shows rejection reason.
7. Widget unmounts. useLiveValue cleanup unsubscribes. WebSocket UNSUBSCRIBE sent if no other widgets need this tag_id.

### 3.5 Asset Path Resolution and Tag Definition

All widgets accept an `assetPath` prop — a dot-separated path string that identifies the tag in the Tag Registry hierarchy. Widgets no longer receive a pre-resolved TagDef object. Instead, `@caro/hmi-context` provides `useResolveAssetPath(assetPath): TagDef[]` which finds all tags whose `tag_path` contains the `assetPath` as a contiguous segment match. Abbreviated paths are supported (e.g. `"RF_Fwd.setpoint"` instead of `"Plant1.Module.RF_Fwd.setpoint"`) as long as the match is unambiguous.

Error evaluation (wrong number of matches, missing expected children) is the widget's responsibility, not hmi-context's. Widgets that expect exactly one tag use a `useSingleTag(assetPath, widgetName)` helper that throws descriptive errors on zero or multiple matches.

```ts
// TagDef shape — from the backend in-memory tag map (Section 6.5 of hmi_functional_spec)
{
  tag_id: number,       // uint32
  tag_path: string,     // full dot-separated path
  data_type: string,    // "f64" | "i32" | "bool" | "str"
  is_setpoint: boolean,
  module_id: string,
  eng_min: number | null,  // resolved from meta (see resolution rule below)
  eng_max: number | null,
  unit: string | null,     // resolved from meta (see resolution rule below)
  meta: array              // full provenance chain
}
```

**Meta field resolution rule:** Fields `eng_min`, `eng_max`, `unit`, and `format` are resolved by walking the `meta` array from root (meta[0]) to leaf (meta[last]). The first level containing the field wins. If no level contains the field, a default is used (null for eng_min/eng_max/unit, `2` for format decimal places).

**Decimal formatting:** The number of decimal places for numeric display is resolved from the `format` field in `tag.meta` using the root-to-leaf resolution rule above, with a default of 2 decimal places.

> *NOTE: Widgets use `tag.tag_id` internally for useLiveValue and useTagWriter calls. The `label` prop is a display override; if omitted, widgets derive a short label from the last segment of `tag.tag_path`.*

---

## 4. Visual Standards

All widgets in `@caro/widgets` follow these standards consistently. They use `@caro/ui` primitives and `@caro/ui` design tokens for colors, spacing, and typography.

### 4.1 Quality Indicator

Every widget reflects the quality of its tag value. Quality is determined by checking `value === null` from useLiveValue. There is no separate quality enum — null value means bad quality.

| State | Visual Treatment |
|---|---|
| value !== null | Normal display. No indicator shown. |
| value === null | Value display shows a dash (`---`) instead of the value. Widget background or border tinted with a subtle red (`bg-red-500/10` or `border-red-400`). Tooltip: 'No signal — device not connected or value not yet received.' |

> *NOTE: `value === null` is the initial state for all tags before the first telemetry snapshot is received from the device. Widgets must handle this gracefully — never show undefined or NaN. The "uncertain" quality state has been removed; values are either present (non-null) or absent (null).*

### 4.1b Quality — Backend Evaluated

Quality is evaluated by the backend per tag based on device telemetry. When a device disconnects or telemetry is lost, the backend watchdog writes null to the LKV cache. This null value propagates to clients via the normal WebSocket delta. Widgets check `value === null` to detect bad quality — they do not implement stale detection or quality inference.

### 4.2 Pending State (Setpoint Widgets)

After a Supervisor submits a write, the widget enters pending state. This communicates that a write is in flight but the device has not yet confirmed.

| Pending State | Visual Treatment |
|---|---|
| Write submitted — `write(tagId, value)` called | Input locked. A subtle spinner or pulsing indicator shown alongside the submitted value. Previous confirmed value shown in muted style below. |
| `write()` Promise resolves (CMD_ACK accepted: true) | Pending state cleared. Confirmed value updated to the new value. Normal display resumes. |
| `write()` Promise rejects — network or backend error | Pending state cleared. Error message shown inline (e.g. 'Write failed — check connection'). Confirmed value restored. |
| `write()` Promise rejects — device rejection (OUT_OF_RANGE, INTERLOCKED, etc.) | Pending state cleared immediately. Rejection reason shown inline. Confirmed value restored. |

### 4.3 Label and Unit

All widgets accept a `label` prop displayed above or beside the value. Unit (where applicable) is shown after the value in a muted style. Labels and units are display-only — never sent to the backend.

### 4.4 Sizing

Widgets are compact by default — designed to be composed in dashboard grids. They do not enforce a fixed width or height. The parent dashboard layout controls sizing. Widgets should be responsive within their container.

---

## 5. Widget Catalog

Version 1.0 includes four foundational single-tag widgets. More complex multi-tag widgets (trend charts, gauges, state panels) will be added in future versions and will follow the same useLiveValue / useTagWriter hook contract.

### MON Numeric_Mon

Read-only display of a numeric tag value (f64 or i32). No user interaction. Suitable for monitoring process values, sensor readings, calculated outputs.

**Props**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| assetPath | string | Yes | — | Dot-separated path identifying the tag. Resolved via useResolveAssetPath. Abbreviated paths supported. |
| label | string | No | — | Display label override. If omitted, the last segment of tag.tag_path is used. |

> *NOTE: This widget calls useLiveValue and useTagWriter internally from @caro/hmi-context. No subscription or write props are required.*

**Behavior**

- Resolves tag via `useResolveAssetPath(assetPath)` (must match exactly one tag).
- Calls `useLiveValue(tag.tag_id)` on mount to subscribe to live value updates.
- Displays the latest value formatted to the decimal places resolved from tag.meta `format` field (root-to-leaf, default 2) with the unit suffix.
- value === null: shows `---` and applies red tint. Non-null: normal display.
- Updates instantly on every useLiveValue value change — no debounce.

**Usage Example**

```jsx
<NumericMon assetPath="RF_Fwd.monitor" label="RF Forward Power" />
```

---

### SET Numeric_Set

Editable numeric setpoint widget for f64 or i32 tags. Displays the confirmed device value and allows Supervisors to submit new values. Manages the full pending lifecycle.

**Props**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| assetPath | string | Yes | — | Dot-separated path identifying the tag. Resolved via useResolveAssetPath. |
| label | string | No | — | Display label override. Defaults to last segment of tag.tag_path. |
| requireConfirm | boolean | No | false | If true, shows a confirmation dialog before submitting the write. |
| confirmMessage | string | No | — | Custom confirmation message. |

**Behavior**

- Resolves tag via `useResolveAssetPath(assetPath)` (must match exactly one tag).
- Displays confirmed value in normal state. An edit icon or click on the value opens an inline input pre-filled with the current value.
- Input validates against `tag.eng_min` / `tag.eng_max` client-side. Shows inline validation error if out of range without calling `write()`.
- On confirm: calls `write(tag.tag_id, parsedValue)` from useTagWriter. `isPending(tag.tag_id)` becomes true.
- Pending state clears in the finally block of `write()` — on CMD_ACK acceptance, device rejection, or network error. `error(tag.tag_id)` is set on rejection.
- `useTagWriter.isPending` and `useTagWriter.error` are used to drive pending spinner and inline error display.
- value === null: edit button is disabled with tooltip 'Cannot write — device not connected.'

**Usage Example**

```jsx
<NumericSet assetPath="RF_Fwd.setpoint" label="Power Setpoint" />
```

---

### MON Boolean_Mon

Read-only boolean state indicator. Displays ON/OFF, ACTIVE/CLEAR, or any custom label pair. Suitable for interlocks, enable states, and binary status flags.

**Props**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| assetPath | string | Yes | — | Dot-separated path identifying the tag. Resolved via useResolveAssetPath. |
| label | string | No | — | Display label override. |
| trueLabel | string | No | "ON" | Text displayed when value is true. |
| falseLabel | string | No | "OFF" | Text displayed when value is false. |
| trueColor | string | No | green | Indicator color when true (green, red, amber, blue, gray). |
| falseColor | string | No | gray | Indicator color when false. |

**Behavior**

- Resolves tag via `useResolveAssetPath(assetPath)` (must match exactly one tag).
- Displays a colored dot indicator alongside the label and trueLabel/falseLabel text.
- value === null: indicator shown as dashed circle, label shown as `---` with red tint.
- No user interaction.

**Usage Example**

```jsx
<BooleanMon assetPath="RF_Fwd.interlock" label="RF Interlock" trueLabel="ACTIVE" falseLabel="CLEAR" trueColor="red" falseColor="green" />
```

---

### SET Boolean_Set

Toggleable boolean setpoint. Displays the confirmed state and allows Supervisors to toggle it. Supports an optional confirmation dialog for safety-critical operations.

**Props**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| assetPath | string | Yes | — | Dot-separated path identifying the tag. Resolved via useResolveAssetPath. |
| label | string | No | — | Display label override. |
| trueLabel | string | No | "ON" | Text displayed when value is true. |
| falseLabel | string | No | "OFF" | Text displayed when value is false. |
| trueColor | string | No | green | Indicator color when true. |
| falseColor | string | No | gray | Indicator color when false. |
| requireConfirm | boolean | No | false | If true, a confirmation dialog is shown before the write is submitted. Recommended for safety-critical booleans. |
| confirmMessage | string | No | — | Custom confirmation message. Defaults to 'Set [label] to [trueLabel/falseLabel]?' |

**Behavior**

- Resolves tag via `useResolveAssetPath(assetPath)` (must match exactly one tag).
- Displays a toggle button or indicator showing the confirmed state.
- On click: if `requireConfirm=true`, opens a confirmation dialog. On confirm (or immediately if `requireConfirm=false`), calls `write(tag.tag_id, !currentValue)` from useTagWriter.
- Pending state follows the same rules as Numeric_Set — managed via `useTagWriter.isPending` and `useTagWriter.error`.
- value === null: toggle is disabled with tooltip 'Cannot write — device not connected.'

**Usage Example**

```jsx
<BooleanSet assetPath="RF_Fwd.enable" label="RF Enable" trueLabel="ENABLED" falseLabel="DISABLED" requireConfirm={true} confirmMessage="Enable RF output? Ensure area is clear." />
```

---

## 6. Dashboard Composition

A dashboard is a React component that instantiates widgets and defines the layout. There is no dashboard builder, JSON renderer, or drag-and-drop system. Dashboards are code.

### 6.1 Wiring the Contract Functions

The HMI application wraps its component tree in `HmiContextProvider`. Widgets call useLiveValue and useTagWriter internally — no transport wiring is needed in dashboards.

```jsx
// packages/hmi-context/index.tsx — HmiContextProvider wires transport to hooks
export function HmiContextProvider({ children }) {
  const ws = useWebSocketInternal();  // WebSocket singleton
  const tagDb = useTagRegistry();     // in-memory TagDef map from Tag Registry
  return (
    <HmiContext.Provider value={{ ws, tagDb }}>
      {children}
    </HmiContext.Provider>
  );
}

// Wrap the entire HMI app once at the root:
// <HmiContextProvider>
//   <App />
// </HmiContextProvider>
```

### 6.2 Dashboard Example

```jsx
// dashboards/RFGeneratorDashboard.jsx
import { NumericMon, NumericSet, BooleanMon, BooleanSet } from '@caro/widgets';

export function RFGeneratorDashboard() {
  return (
    <div className="grid grid-cols-3 gap-4 p-4">
      <NumericMon assetPath="RF_Fwd.monitor" label="RF Forward Power" />
      <NumericMon assetPath="RF_Ref.monitor" label="RF Reflected Power" />
      <NumericSet assetPath="RF_Fwd.setpoint" label="Power Setpoint" />
      <BooleanMon assetPath="RF_Fwd.interlock" label="Interlock" trueLabel="ACTIVE" falseLabel="CLEAR" trueColor="red" falseColor="green" />
      <BooleanSet assetPath="RF_Fwd.enable" label="RF Enable" requireConfirm={true} />
    </div>
  );
}
```

### 6.3 Evolution Path — Configurable Dashboards

The dashboards-as-code approach is intentional and sufficient for a fixed machine configuration where tag_ids are known at build time. When runtime-configurable dashboards are needed the natural evolution is a JSON layout config and a DashboardRenderer component:

```json
// Future: JSON layout config
{
  "dashboard": "RF Generator",
  "widgets": [
    { "type": "NumericMon", "tagId": 1001, "label": "RF Forward Power" },
    { "type": "NumericSet", "tagId": 1003, "label": "Power Setpoint" }
  ]
}
```

The widget API (useLiveValue + useTagWriter hooks) does not change at all in this evolution — the DashboardRenderer simply instantiates widgets from the config and resolves TagDef objects from the tag map.

> *NOTE: Multi-tag writes from a page component: call `useTagWriter().write([{tagId, value}, ...])` with all values in a single batch. Individual widgets always write one tag (or their own set of tags if multi-tag). Coordinated writes across unrelated widgets are a page component responsibility.*

> *NOTE: Dashboard config storage and the DashboardRenderer component are out of scope. The current design intentionally supports this evolution without any breaking changes to the widget API.*

### 6.4 useTagSubtree — Path-Based Dashboard Composition

For dashboard components that display all tags under a known path prefix, `@caro/hmi-context` exports `useTagSubtree(pathPrefix)`. This returns a nested tree of all nodes at and below the prefix — both structural (intermediate) nodes and leaf (tag) nodes — built from the in-memory tag map at mount time. The tree is a one-time snapshot; a browser refresh picks up registry changes.

Full definition is in hmi_functional_spec Section 6.7. Node shape summary:

```ts
// NestedTagNode — every node in the tree has this shape
{
  name: string,    // asset_name at this level
  type: string,    // template_type from meta (e.g. 'parameter', 'module', 'tag')
  tag: TagDef | null,  // populated for leaf nodes (template_type === 'tag')
  children: {          // populated for structural nodes; null for leaf nodes
    [asset_name: string]: NestedTagNode
  } | null
}

// Hook signature
function useTagSubtree(pathPrefix: string): NestedTagNode | null
```

Dashboard panel example — a reusable component that works for any RF_Fwd group regardless of its position in the hierarchy:

```jsx
// panels/RFFwdPanel.jsx
import { useTagSubtree } from '@caro/hmi-context';
import { NumericMon, NumericSet, BooleanSet } from '@caro/widgets';

export function RFFwdPanel({ pathPrefix }) {
  const tree = useTagSubtree(pathPrefix);
  if (!tree) return <p>Path not found: {pathPrefix}</p>;

  const { monitor, setpoint, interlock_enable } = tree.children ?? {};
  if (!monitor?.tag || !setpoint?.tag) {
    throw new Error(`RFFwdPanel: expected monitor and setpoint tags at ${pathPrefix}`);
  }

  return (
    <div className="flex flex-col gap-2">
      <NumericMon assetPath={`${pathPrefix}.monitor`} label="Forward Power" />
      <NumericSet assetPath={`${pathPrefix}.setpoint`} label="Power Setpoint" />
      <BooleanSet assetPath={`${pathPrefix}.interlock_enable`} label="Interlock Enable" requireConfirm={true} />
    </div>
  );
}

// Usage — same component, different machine instances:
// <RFFwdPanel pathPrefix="Plant_A.RF_Module_1.RF_Fwd" />
// <RFFwdPanel pathPrefix="Plant_A.RF_Module_2.RF_Fwd" />
```

> *NOTE: Widget validation is the panel component's responsibility. If the expected tags are missing from the subtree — because the path is wrong or the Tag Registry changed — the panel should throw or render a clear error. The widget itself only validates its own tag prop at runtime.*

---

## 7. Testing Widgets

Because widgets use `useLiveValue` and `useTagWriter` from `@caro/hmi-context`, they are straightforward to unit test by wrapping in a `MockHmiProvider` that controls hook output directly. No WebSocket server, no running backend.

```jsx
// Example: testing Numeric_Mon with Vitest + React Testing Library
import { render, screen } from '@testing-library/react';
import { NumericMon } from '@caro/widgets';
import { MockHmiProvider } from '@caro/hmi-context/testing';

const mockTags = [
  {
    tag_id: 1001,
    tag_path: "Plant1.Module.power",
    data_type: "f64",
    is_setpoint: false,
    module_id: "Module",
    eng_min: 0,
    eng_max: 5000,
    unit: "W",
    meta: []
  }
];

test('displays value when quality is good (non-null)', () => {
  render(
    <MockHmiProvider tags={mockTags} tagValues={{ 1001: { value: 85.5 } }}>
      <NumericMon assetPath="power" label="Power" />
    </MockHmiProvider>
  );
  expect(screen.getByText('85.50')).toBeInTheDocument();
  expect(screen.getByText('W')).toBeInTheDocument();
});

test('shows dash when value is null (bad quality)', () => {
  render(
    <MockHmiProvider tags={mockTags} tagValues={{ 1001: { value: null } }}>
      <NumericMon assetPath="power" label="Power" />
    </MockHmiProvider>
  );
  expect(screen.getByText('---')).toBeInTheDocument();
});
```

## Open Questions

- What is the `HmiContextProvider` WebSocket deduplication strategy when multiple widgets subscribe to the same tag? Reference counting or another approach?
- What are the `trueColor` and `falseColor` design token values?
- What is the `MockHmiProvider` test helper shape needed for widget testing?

