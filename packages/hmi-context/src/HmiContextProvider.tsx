import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { HmiContext } from './HmiContext.js';
import type { HmiContextValue, LiveValue, TagDef } from './types.js';

interface HmiContextProviderProps {
  children: ReactNode;
  apiUrl: string;   // e.g. "/api/v1" or "http://localhost:3003/api/v1"
  wsUrl: string;    // e.g. "ws://localhost:3003/ws"
}

export function HmiContextProvider({ children, apiUrl, wsUrl }: HmiContextProviderProps) {
  // Tag map loaded from REST once on mount
  const tagMapRef = useRef<Map<number, TagDef>>(new Map());
  const [tagMapLoaded, setTagMapLoaded] = useState(false);

  // Live values by tag_id
  const valuesRef = useRef<Map<number, LiveValue>>(new Map());

  // Subscriber callbacks by tag_id
  const subscribersRef = useRef<Map<number, Set<(lv: LiveValue) => void>>>(new Map());

  // Tag IDs for which SUBSCRIBE has been sent to the server
  const subscribedOnServerRef = useRef<Set<number>>(new Set());

  // WebSocket
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(1000);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Pending-subscribe batching via queueMicrotask
  const pendingSubscribeRef = useRef<Set<number>>(new Set());
  const flushScheduledRef = useRef(false);

  // ─── A. Fetch tag map on mount ───────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    fetch(`${apiUrl}/tags`)
      .then(r => r.json())
      .then((res: unknown) => {
        if (cancelled) return;
        const response = res as { ok: boolean; data?: { tags: TagDef[] } };
        if (response.ok && response.data?.tags) {
          const map = new Map<number, TagDef>();
          for (const tag of response.data.tags) {
            map.set(tag.tag_id, tag);
          }
          tagMapRef.current = map;
        }
        setTagMapLoaded(true);
      })
      .catch(err => {
        console.error('[HmiContextProvider] Failed to fetch tags:', err);
        setTagMapLoaded(true);
      });

    return () => { cancelled = true; };
  }, [apiUrl]);

  // ─── B. WebSocket connection (starts once tag map is loaded) ─────────────────

  useEffect(() => {
    if (!tagMapLoaded) return;

    let destroyed = false;

    const connect = () => {
      if (destroyed) return;

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectDelayRef.current = 1000;

        // Clear optimistic state — onopen is the authoritative subscription point
        subscribedOnServerRef.current.clear();
        pendingSubscribeRef.current.clear();

        // Re-subscribe everything currently in the subscriber map in one message
        const allTagIds: number[] = [];
        for (const [tagId, subs] of subscribersRef.current) {
          if (subs.size > 0) allTagIds.push(tagId);
        }
        if (allTagIds.length > 0) {
          ws.send(JSON.stringify({ type: 'SUBSCRIBE', tagIds: allTagIds }));
          for (const id of allTagIds) subscribedOnServerRef.current.add(id);
        }
      };

      ws.onmessage = (event: MessageEvent) => {
        let msg: { type: string; values?: Record<string, unknown> };
        try {
          msg = JSON.parse(event.data as string) as {
            type: string;
            values?: Record<string, unknown>;
          };
        } catch {
          return;
        }

        if (msg.type === 'SNAPSHOT' || msg.type === 'DELTA') {
          const entries = msg.values ?? {};
          for (const [key, rawValue] of Object.entries(entries)) {
            const tagId = Number(key);
            const lv: LiveValue = { value: rawValue as number | boolean | string | null };
            valuesRef.current.set(tagId, lv);
            subscribersRef.current.get(tagId)?.forEach(cb => cb(lv));
          }
        }
        // PONG: ignore (future latency tracking)
      };

      const onDisconnect = () => {
        subscribedOnServerRef.current.clear();
        if (!destroyed) {
          reconnectTimerRef.current = setTimeout(() => {
            reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 30000);
            connect();
          }, reconnectDelayRef.current);
        }
      };

      ws.onclose = onDisconnect;
      ws.onerror = () => { ws.close(); };
    };

    connect();

    return () => {
      destroyed = true;
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [tagMapLoaded, wsUrl]);

  // ─── C. Context value construction with stable method references ─────────────

  const getLiveValue = useCallback((tagId: number): LiveValue => {
    return valuesRef.current.get(tagId) ?? { value: null };
  }, []);

  const subscribeLiveValue = useCallback(
    (tagId: number, callback: (lv: LiveValue) => void): (() => void) => {
      if (!subscribersRef.current.has(tagId)) {
        subscribersRef.current.set(tagId, new Set());
      }
      subscribersRef.current.get(tagId)!.add(callback);

      // If not yet subscribed on the server, add to a pending-subscribe batch.
      // Mark immediately so parallel hook mounts for the same tagId don't duplicate.
      if (!subscribedOnServerRef.current.has(tagId)) {
        subscribedOnServerRef.current.add(tagId);
        pendingSubscribeRef.current.add(tagId);

        if (!flushScheduledRef.current) {
          flushScheduledRef.current = true;
          queueMicrotask(() => {
            flushScheduledRef.current = false;
            const batch = Array.from(pendingSubscribeRef.current);
            pendingSubscribeRef.current.clear();
            const ws = wsRef.current;
            if (batch.length > 0 && ws !== null && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'SUBSCRIBE', tagIds: batch }));
            }
          });
        }
      }

      // Immediately deliver current value so the hook has initial state
      callback(valuesRef.current.get(tagId) ?? { value: null });

      return () => {
        const subs = subscribersRef.current.get(tagId);
        subs?.delete(callback);
        if (subs !== undefined && subs.size === 0) {
          subscribersRef.current.delete(tagId);
          subscribedOnServerRef.current.delete(tagId);
          const ws = wsRef.current;
          if (ws !== null && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'UNSUBSCRIBE', tagIds: [tagId] }));
          }
        }
      };
    },
    []
  );

  const writeTag = useCallback(
    async (tagId: number, value: number | boolean | string): Promise<void> => {
      const res = await fetch(`${apiUrl}/tags/write`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: [{ tag_id: tagId, value }], comment: 'HMI write' }),
      });
      const json = (await res.json()) as {
        ok: boolean;
        error?: { code: string; message: string };
      };
      if (!json.ok) {
        const err = new Error(json.error?.message ?? 'Write failed') as Error & { code?: string };
        err.code = json.error?.code;
        throw err;
      }
    },
    [apiUrl]
  );

  // tagMapLoaded in deps triggers a re-memo once tags are loaded, surfacing the populated tagMap.
  // getLiveValue/subscribeLiveValue/writeTag are stable refs (useCallback with []).
  const contextValue = useMemo<HmiContextValue>(
    () => ({ tagMap: tagMapRef.current, getLiveValue, subscribeLiveValue, writeTag }),
    [tagMapLoaded, getLiveValue, subscribeLiveValue, writeTag] // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (!tagMapLoaded) return null;

  return <HmiContext.Provider value={contextValue}>{children}</HmiContext.Provider>;
}
