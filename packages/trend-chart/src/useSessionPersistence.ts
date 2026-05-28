import { useRef, useCallback, useEffect } from 'react';
import { loadSession, saveSession } from './sessionPersistence.js';
import type { TrendViewerSessionV1 } from './sessionPersistence.js';
import type { ModeState } from './useTrendMode.js';

export interface UseSessionPersistenceOptions {
  /** When undefined, persistence is off entirely — no localStorage reads or writes, initial
   *  values come from propTagIds + defaults, callbacks are undefined. */
  persistKey: string | undefined;
  /** Used when there is no saved session, or when saved tagIds filter to empty. */
  propTagIds: number[];
  /** Current trendable tag map. Read at first render for hydration-time filtering. */
  tagMap: Map<number, { trendable: boolean; tag_id: number }>;
}

export interface UseSessionPersistenceResult {
  /** Filtered tagIds for the parent's useState initializer. Stable identity across re-renders. */
  initialTagIds: number[];
  /** Initial mode state for useTrendMode, or undefined for default. Stable identity. */
  initialModeState: ModeState | undefined;
  /** Initial selectedTagId from saved session, or undefined. Stable identity. */
  initialSelectedTagId: number | null | undefined;
  /** Initial yScaleOverrides Map from saved session, or undefined. Stable identity. */
  initialYScaleOverrides: Map<number, { min: number; max: number }> | undefined;
  /** Pass to TrendChart.onSelectedTagChange. Undefined when persistKey is undefined. */
  onSelectedTagChange: ((tagId: number) => void) | undefined;
  /** Pass to TrendChart.onYScaleOverridesChange. Undefined when persistKey is undefined. */
  onYScaleOverridesChange: ((overrides: Map<number, { min: number; max: number }>) => void) | undefined;
  /** Container calls in a useEffect on tagIds/modeState change.
   *  Debounced ~250 ms internally; no-op when persistKey is undefined. */
  scheduleSave: (snapshot: { tagIds: number[]; modeState: ModeState }) => void;
}

/** Build a ModeState from a saved session, applying the live-fixed→live-trailing
 *  reconciliation when Date.now() >= savedToMs. */
function buildInitialModeState(session: TrendViewerSessionV1): ModeState {
  const sizeMs = BigInt(session.sizeMs);
  if (session.mode === 'live-trailing') {
    return { mode: 'live-trailing', sizeMs, nowMs: BigInt(Date.now()), lastIntent: null };
  }
  const toMs = BigInt(session.toMs!);
  if (session.mode === 'live-fixed') {
    // Reconcile: if now >= savedToMs the live-fixed window has elapsed → live-trailing.
    if (Date.now() >= Number(toMs)) {
      return { mode: 'live-trailing', sizeMs, nowMs: BigInt(Date.now()), lastIntent: null };
    }
    return { mode: 'live-fixed', from: toMs - sizeMs, to: toMs, sizeMs, lastIntent: null };
  }
  // fixed
  return { mode: 'fixed', from: toMs - sizeMs, to: toMs, sizeMs, lastIntent: null };
}

export function useSessionPersistence({
  persistKey,
  propTagIds,
  tagMap,
}: UseSessionPersistenceOptions): UseSessionPersistenceResult {
  // Sentinel: null = not yet initialized. All four initial-* values are computed once
  // on first render and held stable in the ref for subsequent renders.
  const initRef = useRef<{
    initialTagIds: number[];
    initialModeState: ModeState | undefined;
    initialSelectedTagId: number | null | undefined;
    initialYScaleOverrides: Map<number, { min: number; max: number }> | undefined;
  } | null>(null);

  if (initRef.current === null) {
    const session = persistKey ? loadSession(persistKey) : null;

    if (session) {
      const trendableIds = new Set(
        [...tagMap.values()].filter(t => t.trendable).map(t => t.tag_id),
      );
      const filtered = session.tagIds.filter(id => trendableIds.has(id));
      // Empty after filtering → [] (NOT propTagIds — there IS a session, it just has no
      // trendable tags remaining). Fall through to propTagIds only when no session at all.
      initRef.current = {
        initialTagIds: filtered,
        initialModeState: buildInitialModeState(session),
        initialSelectedTagId: session.selectedTagId,
        initialYScaleOverrides: new Map(
          Object.entries(session.yScaleOverrides).map(([k, v]) => [Number(k), v]),
        ),
      };
    } else {
      initRef.current = {
        initialTagIds: propTagIds,
        initialModeState: undefined,
        initialSelectedTagId: undefined,
        initialYScaleOverrides: undefined,
      };
    }
  }

  const {
    initialTagIds,
    initialModeState,
    initialSelectedTagId,
    initialYScaleOverrides,
  } = initRef.current;

  // persistKeyRef — always reflects the latest persistKey without causing re-renders.
  const persistKeyRef = useRef(persistKey);
  persistKeyRef.current = persistKey;

  // latestSaveDataRef — holds the snapshot the next debounced write will persist.
  // Updated synchronously by scheduleSave (tagIds/modeState) and the two callbacks
  // (selectedTagId/yScaleOverrides).
  const latestSaveDataRef = useRef<{
    tagIds: number[];
    modeState: ModeState | null;
    selectedTagId: number | null;
    yScaleOverrides: Map<number, { min: number; max: number }>;
  }>({
    tagIds: initialTagIds,
    modeState: initialModeState ?? null,
    selectedTagId: initialSelectedTagId ?? null,
    yScaleOverrides: initialYScaleOverrides ?? new Map(),
  });

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Shared debounced write. Reads all fields from latestSaveDataRef at fire time so it
  // always captures the latest snapshot even across rapid state changes.
  const requestSave = useCallback(() => {
    const key = persistKeyRef.current;
    if (!key) return;
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      const { tagIds, modeState, selectedTagId, yScaleOverrides } = latestSaveDataRef.current;
      if (!modeState) return; // nothing committed yet (unmounts before first effect)
      const toMs = modeState.mode !== 'live-trailing' ? String(modeState.to) : null;
      saveSession(key, {
        version: 1,
        tagIds,
        selectedTagId,
        sizeMs: String(modeState.sizeMs),
        mode: modeState.mode,
        toMs,
        yScaleOverrides: Object.fromEntries([...yScaleOverrides.entries()]),
      });
    }, 250);
  }, []); // only reads refs — stable across renders

  // Flush any pending write synchronously on unmount to avoid losing state changes
  // that occur within the 250 ms debounce window.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        const key = persistKeyRef.current;
        if (!key) return;
        const { tagIds, modeState, selectedTagId, yScaleOverrides } = latestSaveDataRef.current;
        if (!modeState) return;
        const toMs = modeState.mode !== 'live-trailing' ? String(modeState.to) : null;
        saveSession(key, {
          version: 1,
          tagIds,
          selectedTagId,
          sizeMs: String(modeState.sizeMs),
          mode: modeState.mode,
          toMs,
          yScaleOverrides: Object.fromEntries([...yScaleOverrides.entries()]),
        });
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // scheduleSave — container calls this in a useEffect on [tagIds, modeState] change.
  const scheduleSave = useCallback(
    ({ tagIds, modeState }: { tagIds: number[]; modeState: ModeState }) => {
      latestSaveDataRef.current.tagIds = tagIds;
      latestSaveDataRef.current.modeState = modeState;
      requestSave();
    },
    [requestSave],
  );

  const _onSelectedTagChange = useCallback(
    (tagId: number) => {
      latestSaveDataRef.current.selectedTagId = tagId;
      requestSave();
    },
    [requestSave],
  );

  const _onYScaleOverridesChange = useCallback(
    (overrides: Map<number, { min: number; max: number }>) => {
      latestSaveDataRef.current.yScaleOverrides = overrides;
      requestSave();
    },
    [requestSave],
  );

  return {
    initialTagIds,
    initialModeState,
    initialSelectedTagId,
    initialYScaleOverrides,
    onSelectedTagChange: persistKey ? _onSelectedTagChange : undefined,
    onYScaleOverridesChange: persistKey ? _onYScaleOverridesChange : undefined,
    scheduleSave,
  };
}
