# CARO_Widget_Spec — HMI Widget Specification
**Date:** 2026-10-21
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
| 1.6 | 2026-04-13 | PM / Claude | Single-row layout with shared column widths. BooleanMon dot-only. BooleanSet toggle switch. Fixed columns for alignment. |
| 1.7 | 2026-04-14 | PM / Claude | Pending visual state (spinner, muted value, locked input styling) removed. Replaced with `useWriteGuard` hook — invisible double-click guard only, no visual feedback during writes. `module_type` field added to TagDef shape. `writeTag` in HmiContextProvider now surfaces CMD_ACK device-level rejections (MODULE_FAULT, TIMEOUT, etc.) as thrown errors, surfacing through useTagWriter error state to the widget. |
| 1.8 | 2026-04-14 | PM / Claude | NumericSet refactored: two-mode toggle replaced with inline click-to-edit input. `requireConfirm` and `confirmMessage` props removed — safety gate is at mode save time. Client-side eng_min/eng_max validation removed — server is sole authority. Write error shown regardless of focus state. `isWriting` uses readOnly instead of disabled to retain focus. |
| 1.9 | 2026-04-14 | PM / Claude | Spec text fixes: removed erroneous useTagWriter reference from NumericMon NOTE; corrected BooleanSet pending-state reference from useTagWriter.isPending to useWriteGuard; clarified disabled vs readOnly in Section 4.2; fixed BooleanMon bad-quality description (label always shown); clarified write() is single-tag for widgets, batch at server level; documented Boolean 2-column layout in Section 4.4. |
| 2.0 | 2026-04-14 | PM / Claude | Added useTagGroup utility (Section 3.6). Added Analog_In composite widget (Section 5). First multi-tag widget in the catalog. |
| 2.1 | 2026-04-19 | PM / Claude | §3.5: TagPathIndex-backed resolution noted (O(1) per call). §3.6: useTagGroup complexity noted as O(children). Matches perf commits be308f5 and cceb114. |
| 2.3 | 2026-10-21 | PM / Claude | StringMon added (§5, §3.1): read-only text display for String-type tags. |
| 2.4 | 2026-10-24 | PM / Claude | SpecAChart added (§5, §3.1): frequency-mapped spectrum-analyser chart for a SpecA block (MHz axis, dBFS, live/offender traces, interlock zone, Clear button). |
| 2.2 | 2026-10-17 | PM / Claude | Reconciled with the code: dependencies (uplot runtime dep, @caro/ui peer); hmi-context exports; `write()` never rejects (errors via `error(tagId)`), no batch form; TagDef shape and format resolution from registry columns; BooleanMon ignores trueLabel/falseLabel; BooleanSet confirm uses @caro/ui Modal; Timer and SpectrumChart added to the catalog; MockHmiProvider props; Open Questions answered by the implementation. |

---

## 1. Purpose

This document defines the `@caro/widgets` package — a collection of React components for displaying and interacting with live tag values in CARO_Platform HMI applications. Widgets are transport-agnostic: they read values and send writes through hooks from `@caro/hmi-context`, with no direct dependency on Zustand, WebSocket, or REST APIs.

Intended audience: Frontend developers implementing widgets, developers composing dashboards, and QA engineers writing widget tests.

---

## 2. Package

### 2.1 Location

The `@caro/widgets` package lives at `packages/widgets/` in the CARO_Platform monorepo alongside `@caro/ui` and `@caro/db`.

| Package | Path | Purpose |
|---|---|---|
| `@caro/ui` | `packages/ui/` | Stateless primitives (Button, Input, Modal). Zero domain knowledge. No runtime dependencies. |
| `@caro/widgets` | `packages/widgets/` | Tag-bound HMI widgets. Transport via `@caro/hmi-context` hooks. |
| `@caro/db` | `packages/db/` | PostgreSQL pool. Server-side only. |

### 2.2 Dependencies

As built (`packages/widgets/package.json`): one runtime dependency, `uplot` (for `SpectrumChart`), and peer dependencies `react` ^18, `@caro/hmi-context` and `@caro/ui`. It does NOT depend on Zustand, any WebSocket library, or any HTTP client.

> *NOTE: `@caro/widgets` may import primitives from `@caro/ui` (Button, Input, Badge) and Tailwind utility classes for styling. It must never import from `@caro/db` or any server-side module.*

> *NOTE: `@caro/widgets` includes composite multi-tag widgets (AnalogIn, Timer) and two chart widgets (SpectrumChart, SpecAChart) alongside the foundational single-tag widgets.*

> *NOTE: Several widget behaviors are implemented via internal shared utilities in `packages/widgets/src/shared/`. These are not exported from `@caro/widgets` but are important for contributors: `useNumericInput` (focus/blur/write state for numeric inputs — shared by NumericSet and AnalogIn NumericSetCell), `ToggleSwitch` (toggle button component — shared by BooleanSet and AnalogIn BooleanSetCell), `colorMap` (boolean color constants keyed by name — shared across BooleanMon, BooleanSet, and AnalogIn), `useWriteGuard`, `useSingleTag`, `useTagGroup`, `withErrorBoundary` (every exported widget is wrapped in it), `WidgetLabel`, `widgetStyles`.*

---

## 3. Widget Contract

Widgets in `@caro/widgets` use two custom hooks provided by the `@caro/hmi-context` peer dependency. The hooks are called internally — no subscription or write props are needed on any widget.

### 3.1 @caro/hmi-context Peer Dependency

`@caro/widgets` lists `@caro/hmi-context` as a peer dependency. This package lives at `packages/hmi-context/` in the monorepo and exports the hooks and provider that connect widgets to the HMI application transport layer. The HMI application wraps its component tree in the provider; widgets call the hooks internally.

| Package | Exports |
|---|---|
| `@caro/hmi-context` | HmiContextProvider, MockHmiProvider (also at `@caro/hmi-context/testing`), useLiveValue, useTagWriter, useCommandSender, useTagMap, useTagSubtree, useResolveAssetPath, useWsStats, useProjectRoot, useHmiContext, scopedKey / useScopedKey, and types |
| `@caro/widgets` | NumericMon, NumericSet, StringMon, BooleanMon, BooleanSet, AnalogIn, Timer, SpectrumChart, SpecAChart, with their `*Props` types |

### 3.2 useLiveValue

`useLiveValue(tagId)` — called internally by every widget on mount. Returns the live value for the given tag_id. Purely a read path — no write awareness.

```ts
// Signature (in @caro/hmi-context)
export function useLiveValue(tagId: number | undefined): {
  value: number | boolean | string | null  // null = bad quality (device not connected or value not yet received)
}
// tagId === undefined (an optional asset path that doesn't resolve) → { value: null }, no subscription
```

Quality is represented by `value === null`. There is no separate quality enum or timestamp field. When a device disconnects or telemetry is lost, the backend watchdog writes null to the LKV cache, which propagates to clients. Widgets check `value === null` to render the bad-quality state.

The HmiContextProvider implementation subscribes to the WebSocket layer and maintains a last-known-value cache. On mount, the backend sends a SNAPSHOT for the tag_id so useLiveValue returns the current value immediately without waiting for the next delta.

### 3.3 useTagWriter

`useTagWriter()` — called by setpoint widgets. Returns a write function and per-tag pending and error state. `write()` accepts a tagId and value as separate arguments. Widgets always write a single tag per call. Batch writes (multiple tags in one request) are supported at the server level for mode-loading workflows but are not exposed through this hook. `isPending` and `error` are keyed by tagId so multi-tag widgets can show state per tag independently.

```ts
// Signature (in @caro/hmi-context)
export function useTagWriter(): {
  write: (tagId: number, value: number | boolean | string) => Promise<void>,
  isPending: (tagId: number) => boolean,
  error: (tagId: number) => string | null
}
// write() sends a single tag write. There is no batch form.
// write() never rejects: a network error, backend validation failure, or device rejection
//   (CMD_ACK with accepted: false, or TIMEOUT) is caught and stored as error(tagId).
// isPending clears in the finally block — guaranteed regardless of outcome
```

The write function calls `POST /api/v1/tags/write` with `{ values: [{ tag_id, value }], comment: 'HMI write' }`. isPending is managed entirely within useTagWriter — widgets do not track pending state independently (they use `useWriteGuard` instead, §4.2).

> *NOTE: The `HmiContextProvider.writeTag()` implementation inspects the CMD_ACK results embedded in the server response. If any tag in the response has `accepted: false`, `writeTag` throws an `Error` whose message is `'Device rejected: <rejection_code>'` (e.g. `'Device rejected: MODULE_FAULT'`, `'Device rejected: TIMEOUT'`, `'Device rejected: UNKNOWN'` when no code is given). An `ok: false` response throws with the server's error message. Either surfaces through `useTagWriter`'s catch block into `error(tagId)`, which the widget reads to display an inline rejection message. This means device-level rejections (including 1-second CMD_ACK timeouts) surface identically to network and backend errors — the widget sees a string error message regardless of origin.*

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
      setErrors(e => ({ ...e, [tagId]: err.message }));   // not rethrown
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
4. For setpoint widgets: user clicks the value to enter edit mode, types a new value, and presses Enter. Widget calls `write(tag.tag_id, newValue)`. Input remains focused for immediate follow-up edits. `useWriteGuard.isWriting` becomes true, making input read-only until the guard clears.
5. CMD_ACK accepted: `write()` resolves; finally block clears isPending. The widget shows the confirmed value when telemetry echoes it.
6. Network error or device rejection: `write()` still resolves, `error(tag.tag_id)` is set, finally block clears isPending. Widget shows the rejection reason.
7. Widget unmounts. useLiveValue cleanup unsubscribes. WebSocket UNSUBSCRIBE sent if no other widgets need this tag_id.

### 3.5 Asset Path Resolution and Tag Definition

All widgets accept an `assetPath` prop — a dot-separated path string that identifies the tag in the Tag Registry hierarchy. Widgets no longer receive a pre-resolved TagDef object. Instead, `@caro/hmi-context` provides `useResolveAssetPath(assetPath): TagDef[]` which finds all tags whose `tag_path` contains the `assetPath` as a contiguous segment match. Abbreviated paths are supported (e.g. `"RF_Fwd.setpoint"` instead of `"Plant1.Module.RF_Fwd.setpoint"`) as long as the match is unambiguous. Resolution is backed by a prebuilt `TagPathIndex` on `HmiDataContext`; each call is O(1) regardless of tag-map size.

Error evaluation (wrong number of matches, missing expected children) is the widget's responsibility, not hmi-context's. Widgets that expect exactly one tag use a `useSingleTag(assetPath, widgetName)` helper that throws descriptive errors on zero or multiple matches.

```ts
// TagDef shape — from the backend in-memory tag map (Section 6.5 of hmi_functional_spec)
{
  tag_id: number,
  tag_path: string,        // full dot-separated path
  tag_name: string | null, // resolved display name
  data_type: string,       // any tag_types value: f32, bool, i16, i32, string, f32[], i16[]
  is_setpoint: boolean,
  trendable: boolean,      // tag_registry.trends
  module_id: string,       // module ancestor name, 'unknown' if none
  module_type: string,     // 'MQTT' | 'HMI' — tag_registry.module_type, defaulting to 'MQTT'
  eng_min: number | null,  // registry column
  eng_max: number | null,
  unit: string | null,
  format: string | null,
  meta: MetaLevel[]        // full provenance chain, root-to-leaf
}
```

**Field resolution:** `eng_min`, `eng_max`, `unit` and `format` are resolved by the Tag Registry when a registry is applied and stored as `tag_registry` columns; widgets read them straight from `TagDef` and never walk `meta`.

**Number formatting:** `resolveFormat(tag)` compiles `tag.format` once at mount: `#` → 0 decimals, `#.##` → 2 decimals (one per `#` after the point), `#.##E+0` → exponential. A null format uses `#.##`. An unrecognised pattern renders `Format not valid`.

> *NOTE: Widgets use `tag.tag_id` internally for useLiveValue and useTagWriter calls. The `label` prop is a display override; if omitted, widgets use the last dot-separated segment of the `assetPath` prop (`resolveLabel`).*

---

### 3.6 useTagGroup — Multi-Tag Resolution

For composite widgets that display multiple related tags under a common path prefix, `@caro/widgets` provides a `useTagGroup` utility:

```ts
useTagGroup(basePath: string, children: string[], widgetName: string): Record<string, TagDef>
```

Resolves each child as `${basePath}.${child}` via useResolveAssetPath. Validates exactly one match per child — throws on zero or multiple matches. The `children` array must be a static constant (React hooks rule). Single-tag widgets continue to use `useSingleTag` directly. Each child lookup delegates to the same `TagPathIndex`, so `useTagGroup` is O(children) in the common case, independent of tag-map size.

---

## 4. Visual Standards

All widgets in `@caro/widgets` follow these standards consistently. They use `@caro/ui` primitives and `@caro/ui` design tokens for colors, spacing, and typography.

### 4.1 Quality Indicator

Every widget reflects the quality of its tag value. Quality is determined by checking `value === null` from useLiveValue. There is no separate quality enum — null value means bad quality.

| State | Visual Treatment |
|---|---|
| value !== null | Normal display. No indicator shown. |
| value === null | Value display shows a dash (`---`) or neutral indicator instead of the value. Red text styling applied to signal no live value. Setpoint widgets remain interactive — null quality does not block writes. Null is the normal initial state for any tag that has not yet received telemetry; it also occurs when the watchdog fires on a stalled module. Write validation and range enforcement are server concerns. |

> *NOTE: `value === null` is the initial state for all tags before the first telemetry snapshot is received from the device. Widgets must handle this gracefully — never show undefined or NaN. The "uncertain" quality state has been removed; values are either present (non-null) or absent (null).*

### 4.1b Quality — Backend Evaluated

Quality is evaluated by the backend per tag based on device telemetry. When a device disconnects or telemetry is lost, the backend watchdog writes null to the LKV cache. This null value propagates to clients via the normal WebSocket delta. Widgets check `value === null` to detect bad quality — they do not implement stale detection or quality inference.

### 4.2 Pending State (Setpoint Widgets)

Visual pending state (spinner, muted previous value, locked-looking input) is **not implemented**. The widget appearance does not change between click and telemetry confirmation — no dimming, no cursor change, no overlay.

Instead, widgets use the `useWriteGuard` hook (`packages/widgets/src/shared/useWriteGuard.ts`) which provides an invisible double-click guard. The toggle/input is **disabled** while a write is in flight to prevent double-clicks, but no visual change accompanies this. The guard clears when: (a) telemetry confirms the expected value arrives, (b) a write error is reported via `useTagWriter.error`, or (c) a configurable safety timeout fires (default `DEFAULT_WRITE_GUARD_TIMEOUT_MS = 1000 ms`).

| Pending State | Visual Treatment |
|---|---|
| Write submitted — `write(tagId, value)` called | No visual change. Toggle disabled (BooleanSet) or input set to readOnly (NumericSet) to prevent double-click. `useWriteGuard.isWriting` is true. |
| Telemetry confirms the new value | Guard cleared. Toggle/input re-enabled. No visual change. |
| `write()` rejects — network, backend, or device rejection | Guard cleared. Inline error message shown below the widget (e.g. `'Device rejected: MODULE_FAULT'`). Toggle/input re-enabled. |
| Safety timeout (1000 ms) fires without telemetry confirmation | Guard cleared. Toggle/input re-enabled. No error shown unless `writeError` is already set. |

### 4.3 Label and Unit

All widgets accept a `label` prop displayed above or beside the value. Unit (where applicable) is shown after the value. Labels and units are display-only — never sent to the backend.

### 4.4 Sizing

Widgets use shared fixed column widths (label, value, unit) from `widgetStyles.ts` for vertical alignment when stacked. They render as `inline-flex` rows and do not stretch to fill their container. Numeric widgets render three columns (label, value, unit). Boolean widgets render two columns (label, indicator/toggle) — they have no unit column.

---

## 5. Widget Catalog

The catalog has four foundational single-tag widgets, two composite widgets (Analog_In, Timer) and two chart widgets (SpectrumChart, SpecAChart). All follow the same useLiveValue / useTagWriter hook contract. The trend chart is a separate package, `@caro/trend-chart`.

### MON Numeric_Mon

Read-only display of a numeric tag value (f32). No user interaction. Suitable for monitoring process values, sensor readings, calculated outputs.

**Props**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| assetPath | string | Yes | — | Dot-separated path identifying the tag. Resolved via useResolveAssetPath. Abbreviated paths supported. |
| label | string | No | — | Display label override. If omitted, the last segment of `assetPath` is used. |

> *NOTE: This widget calls useLiveValue internally from @caro/hmi-context. No subscription or write props are required.*

**Behavior**

- Resolves tag via `useResolveAssetPath(assetPath)` (must match exactly one tag).
- Calls `useLiveValue(tag.tag_id)` on mount to subscribe to live value updates.
- Displays the latest value formatted with `tag.format` (default `#.##`), with `tag.unit` in the unit column (`-` when null).
- value === null: shows `---` and applies red tint. Non-null: normal display.
- Updates instantly on every useLiveValue value change — no debounce.

**Usage Example**

```jsx
<NumericMon assetPath="RF_Fwd.monitor" label="RF Forward Power" />
```

---

### SET Numeric_Set

Editable numeric setpoint widget for f32 tags. Displays the confirmed device value and allows operators to submit new values via a click-to-edit inline input.

**Props**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| assetPath | string | Yes | — | Dot-separated path identifying the tag. Resolved via useResolveAssetPath. |
| label | string | No | — | Display label override. Defaults to the last segment of `assetPath`. |

**Behavior**

- Resolves tag via `useResolveAssetPath(assetPath)` (must match exactly one tag).
- A single `<input type="text" inputMode="decimal">` is always rendered — there is no display-mode vs. edit-mode DOM swap.
- **Idle:** Input displays the formatted live value (from useLiveValue). Blue text (`text-blue-600`) indicates the value is editable. Input is read-only.
- **Click / Focus → Edit:** Input value clears to empty. Current live value shown as placeholder (ghost text, faint gray). Amber highlight (`bg-amber-100 border-blue-500`). Input accepts typing.
- **Enter → Submit + retain focus:** Parses input with parseFloat. If empty or NaN, does nothing. Otherwise calls `setAwaitedValue(parsed)` then `write(tag.tag_id, parsed)`. Clears input, updates placeholder to submitted value. Focus is retained — operator can immediately type the next value.
- **Escape → Cancel:** Blurs the input, triggering the blur handler.
- **Blur → Restore:** Input value restored to current formatted live value. Edit highlight removed. No write sent.
- **Live value update while focused:** Placeholder updated only — input value not overwritten. Operator's typing is never interrupted.
- **Live value update while idle:** Input value updated directly to new formatted value.
- **ArrowUp / ArrowDown:** Prevented via `e.preventDefault()` on keydown.
- **No client-side range validation.** The server validates all writes before publishing MQTT commands. Server-side rejections surface through `useTagWriter.error()` and display as inline error text below the widget.
- **Write error:** Displayed below the widget as red text whenever `useTagWriter.error(tag.tag_id)` is non-null, regardless of whether the input is focused or idle.
- value === null: input displays `---` in red. Still editable — null reflects no live value yet, not an offline guard. Write validation is server-side.
- Write in progress (`useWriteGuard.isWriting`): input is read-only (not disabled) to prevent double-submits while retaining focus. Enter handler returns early if isWriting is true.

**Usage Example**

```jsx
<NumericSet assetPath="RF_Fwd.setpoint" label="Power Setpoint" />
```

---

### MON String_Mon

Read-only display of a text tag value (`string`), such as a firmware version, an IP address or a status string. No user interaction.

**Props**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| assetPath | string | Yes | — | Dot-separated path identifying the tag. Resolved via useResolveAssetPath. Abbreviated paths supported. |
| label | string | No | — | Display label override. If omitted, the last segment of `assetPath` is used. |

**Behavior**

- Resolves tag via `useResolveAssetPath(assetPath)` (must match exactly one tag) and subscribes with `useLiveValue(tag.tag_id)`.
- Displays the value as received, with no formatting and no unit column. A non-string value (for example a number from a module that has not been regenerated) is shown via `String(value)` rather than failing.
- The value spans the value and unit columns (`VALUE_TEXT_CLASS`, 130 px), so a text row's right edge lines up with numeric rows. Longer text is truncated; the full text is in the element's `title`.
- value === null: shows `---` in red. Non-null: normal display.

**Usage Example**

```jsx
<StringMon assetPath="RF1.Module_Info.IP" label="IP" />
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
- Displays a colored dot indicator right-aligned in the value column. No ON/OFF text rendered — dot color conveys state. `trueLabel` / `falseLabel` are accepted for API compatibility but not used anywhere in the rendered output.
- value === null: indicator shown as dashed red circle. Label is always displayed regardless of quality — only the value indicator reflects bad quality.
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
- Displays a toggle switch (28×14px). Track color follows trueColor/falseColor props. Uses role='switch' and aria-checked.
- On click: if `requireConfirm=true`, opens a confirmation dialog (`@caro/ui` `Modal` titled "Confirm", with a Confirm button). On confirm (or immediately if `requireConfirm=false`), calls `write(tag.tag_id, !currentValue)` from useTagWriter.
- Write-in-flight state is managed by `useWriteGuard` — toggle is disabled while `isWriting` is true. Write errors surface through `useTagWriter.error(tag.tag_id)` and display as inline red text below the widget.
- value === null: toggle renders in the OFF position (null treated as false). Still interactive — clicking writes `true` (the inverse of null/false). Null quality does not block writes. Write validation is server-side.

**Usage Example**

```jsx
<BooleanSet assetPath="RF_Fwd.enable" label="RF Enable" trueLabel="ENABLED" falseLabel="DISABLED" requireConfirm={true} confirmMessage="Enable RF output? Ensure area is clear." />
```

---

### COMP Analog_In

Composite multi-tag widget displaying a complete analog input parameter as a single dense row. Contains 5 NumericSet cells, 1 NumericMon cell, 1 BooleanSet cell, and 1 BooleanMon cell.

**Props**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| assetPath | string | Yes | — | Base path. Children (Set, Mon, Tol, By, Intk, RSS, Per, In_A, In_B) resolved underneath. |
| label | string | No | — | Display label. Defaults to last segment of assetPath. |
| showHeader | boolean | No | false | If true, renders a header row above the data row with column labels. |

**Children (display order)**

Set (NumericSet), Mon (NumericMon), Tol (NumericSet), By (BooleanSet), Intk (BooleanMon), RSS (NumericSet), Per (NumericSet), In_A (NumericSet), In_B (NumericSet)

**Behavior**

- Resolves all 9 children via `useTagGroup`. Throws if any child is missing or ambiguous.
- Unit displayed once after the label, resolved from any numeric child tag.
- Each cell handles quality independently — a single null value shows `---` or dashed dot for that cell only.
- Write errors displayed below the row, prefixed with child name (e.g. `Set: Device rejected: MODULE_FAULT`).
- Uses fixed column widths for vertical alignment when multiple AnalogIn rows are stacked.

```tsx
<AnalogIn assetPath="RF1.PRF" label="PRF" showHeader={true} />
<AnalogIn assetPath="RF2.PRF" label="PRF" />
```

---

### COMP Timer

Composite Set/Mon/Done row for a timer parameter.

**Props:** `assetPath` (required; base path), `label` (optional; defaults to the last segment of `assetPath`), `showHeader` (optional, default false).

**Children:** `Set` (NumericSet cell), `Mon` (NumericMon cell), `Done` (BooleanMon cell), resolved via `useTagGroup`, which throws if any is missing or ambiguous. The unit comes from the `Set` tag (`-` when null). Write errors are shown below the row, prefixed with the child name.

```tsx
<Timer assetPath="Gun.Warm_Up" label="Warm_Up" showHeader={true} />   // from hmi-definitions/shared/GunBox.tsx
```

---

### CHART SpectrumChart

Line chart of one `number[]` tag (e.g. an FFT spectrum), drawn with uPlot. The X axis is the array index, labelled "Bin"; there is no frequency mapping. The Y-axis label is the tag's unit.

**Props**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| assetPath | string | Yes | — | Must resolve to exactly one tag. |
| label | string | No | last segment of `assetPath` | Display label. |
| width / height | number | No | 640 / 320 | Fixed pixel size (no resize observer). |
| yMin / yMax | number | No | −1000 / 1000 | Fixed Y range (the tag has no eng limits to derive one from). |

Drag selects a zoom box on both axes (custom select hook; uPlot's own drag-to-zoom is disabled); double-click resets to the full range. Live data comes through `useLiveValue` like any other widget.

### CHART SpecAChart

Frequency-mapped spectrum-analyser chart for one SpecA block (RF_Control's `SpecA` tag group), drawn with uPlot. Composite: `assetPath` is the block's base path and the widget resolves seven children with `useTagGroup` — `Spectrum` (int16 array, dB × 10), `Spec_Start` (MHz), `Spec_Bin` (Hz, display bin), `Spec_Trace_Ok`, `Spec_Intk_Level_Mon` (dBFS), `Spec_Intk_Band_Mon` (kHz), `Spec_Intk_Freq_Mon` (MHz).

**Props**

| Prop | Type | Required | Default | Description |
|---|---|---|---|---|
| assetPath | string | Yes | — | SpecA base path, e.g. `RF1.SpecA`. Each child must resolve to exactly one tag. |
| label | string | No | last segment of `assetPath` | Display label. |
| height | number | No | 400 | Pixel height. Width fills the container (`ResizeObserver`). |

**Behaviour**

- X axis in MHz: `Spec_Start + i · Spec_Bin / 1e6`, auto-ranged to the data on every frame (X scale `auto: true` — with `auto: false` uPlot keeps the previous range, which is null on mount). Y axis fixed at −110 … 0 dBFS; each value is divided by 10.
- Two traces: live (blue) and offender (red). `Spec_Trace_Ok` is a colour only: an array with `false` replaces the offender, any other replaces the live trace, and neither clears the other. RF_Control decides which frames are red (it sends the first failing frame once per start-up or Reset). A trace is assigned only for a new array (or a late `Spec_Trace_Ok` for it), so a zone-tag change cannot redraw a cleared frame. The offender keeps the frequency axis it was captured on (the two traces are merged onto one X with `uPlot.join`, `spanGaps` bridging the alignment gaps) and persists until Clear.
- An empty `Spectrum` array (how the module signals "no frame", with `Spec_Start`/`Spec_Bin` sent as 0) or a null one blanks the live trace only, keeps the offender, hides the zone and ignores `Spec_Trace_Ok`. A null spectrum also shows `---`.
- Interlock zone, drawn in a uPlot `draw` hook over the traces at low alpha, from `Spec_Intk_Level_Mon` up to 0 dBFS: red detection flanks across the frame's range and a green guard band of total width `Spec_Intk_Band_Mon` centred on `Spec_Intk_Freq_Mon`. A flank is omitted when the guard band runs past that end; the guard band is clipped to the frame.
- Clear button (header row, `@caro/ui` `Button`) wipes both traces in the browser only; nothing is sent to the module. There is no `Reset_Count` handling.
- Drag-to-zoom on both axes and double-click reset, as in SpectrumChart.

---

## 6. Dashboard Composition

A dashboard is a React component that instantiates widgets and defines the layout. There is no dashboard builder, JSON renderer, or drag-and-drop system. Dashboards are code.

### 6.1 Wiring the Contract Functions

The HMI application wraps its component tree in `HmiContextProvider`. Widgets call useLiveValue and useTagWriter internally — no transport wiring is needed in dashboards.

```tsx
// apps/caro-hmi/client/src/App.tsx — the app wraps everything once:
<HmiContextProvider apiUrl="/api/v1" wsUrl={`ws://${window.location.host}/ws`}>
  <Shell />
</HmiContextProvider>
```

`HmiContextProvider` (`packages/hmi-context/src/HmiContextProvider.tsx`) fetches `/tags` and `/config`, renders nothing until both settle, owns the WebSocket and reconciles subscriptions. Its mechanics are in `Docs/platform/CARO_Telemetry_Path_Reference.md` §8.

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

> *NOTE: `useTagWriter().write()` takes one tag; there is no batch form in the client today, although `POST /api/v1/tags/write` accepts an array. Coordinated multi-tag writes would need a new client API.*

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

// MockHmiProvider props: tagDefs (Record<tag_id, TagDef>), tagValues (Record<tag_id, LiveValue>),
// projectRoot (default 'test'), onWrite, onSendCommand.
const tagDefs = {
  1001: {
    tag_id: 1001, tag_path: "Plant1.Module.power", tag_name: "power",
    data_type: "f32", is_setpoint: false, trendable: false,
    module_id: "Module", module_type: "MQTT",
    eng_min: 0, eng_max: 5000, unit: "W", format: "#.##", meta: []
  }
};

test('displays value when quality is good (non-null)', () => {
  render(
    <MockHmiProvider tagDefs={tagDefs} tagValues={{ 1001: { value: 85.5 } }}>
      <NumericMon assetPath="power" label="Power" />
    </MockHmiProvider>
  );
  expect(screen.getByText('85.50')).toBeInTheDocument();
  expect(screen.getByText('W')).toBeInTheDocument();
});

test('shows dash when value is null (bad quality)', () => {
  render(
    <MockHmiProvider tagDefs={tagDefs} tagValues={{ 1001: { value: null } }}>
      <NumericMon assetPath="power" label="Power" />
    </MockHmiProvider>
  );
  expect(screen.getByText('---')).toBeInTheDocument();
});
```

## Open Questions

- What are the `trueColor` and `falseColor` design token values? (Today they are names mapped by `shared/colorMap.ts`.)

*Answered by the implementation:* WebSocket deduplication is a per-tag subscriber set plus a level-triggered reconciler that sends one SUBSCRIBE/UNSUBSCRIBE per microtask (Telemetry Path Reference §8.5); the `MockHmiProvider` shape is shown in §7.

