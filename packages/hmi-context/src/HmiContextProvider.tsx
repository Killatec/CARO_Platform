import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { HmiDataContext, HmiStatsContext } from './HmiContext.js';
import { buildTagPathIndex } from './tagPathIndex.js';
import type { TagPathIndex } from './tagPathIndex.js';
import type { HmiDataContextValue, LiveValue, TagDef, WsStats } from './types.js';

interface HmiContextProviderProps {
  children: ReactNode;
  apiUrl: string;   // e.g. "/api/v1" or "http://localhost:3003/api/v1"
  wsUrl: string;    // e.g. "ws://localhost:3003/ws"
}

export function HmiContextProvider({ children, apiUrl, wsUrl }: HmiContextProviderProps) {
  // Tag map loaded from REST once on mount
  const tagMapRef = useRef<Map<number, TagDef>>(new Map());
  const tagPathIndexRef = useRef<TagPathIndex>(buildTagPathIndex([]));
  const [tagMapLoaded, setTagMapLoaded] = useState(false);

  // Live values by tag_id
  const valuesRef = useRef<Map<number, LiveValue>>(new Map());

  // Subscriber callbacks by tag_id
  const subscribersRef = useRef<Map<number, Set<(lv: LiveValue) => void>>>(new Map());

  // Reconciler: desiredRef is what the client wants; serverRef is what the server knows.
  // flush() is the only function that computes and sends the diff.
  const desiredRef = useRef<Set<number>>(new Set());
  const serverRef  = useRef<Set<number>>(new Set());
  const flushScheduledRef = useRef(false);

  // Trend-delta channel — parallel reconciler sharing the same WS and flush microtask.
  type TrendCallback = (moduleTs: number, value: number | boolean | string | null) => void;
  const trendSubscribersRef = useRef<Map<number, Set<TrendCallback>>>(new Map());
  const trendDesiredRef = useRef<Set<number>>(new Set());
  const trendServerRef  = useRef<Set<number>>(new Set());

  // WebSocket
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectDelayRef = useRef(1000);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ─── WS Statistics ───────────────────────────────────────────────────────────
  const wsStatsRef = useRef({ messageCount: 0, byteCount: 0 });
  const latencyRef = useRef<number | null>(null);
  const pingIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [wsStats, setWsStats] = useState<WsStats>({
    connected: false,
    latencyMs: null,
    messagesPerSec: 0,
    bytesPerSec: 0,
    subscribedCount: 0,
  });

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
          tagPathIndexRef.current = buildTagPathIndex(map.values());
        }
        setTagMapLoaded(true);
      })
      .catch(err => {
        console.error('[HmiContextProvider] Failed to fetch tags:', err);
        setTagMapLoaded(true);
      });

    return () => { cancelled = true; };
  }, [apiUrl]);

  // ─── Reconciler flush ────────────────────────────────────────────────────────
  //
  // Single function that owns all wire traffic. Computes desired-vs-server diff
  // and sends one SUBSCRIBE and/or one UNSUBSCRIBE per microtask tick.
  // SUBSCRIBE is sent before UNSUBSCRIBE for test determinism (sets are disjoint).

  const flush = useCallback(() => {
    flushScheduledRef.current = false;
    const ws = wsRef.current;
    if (ws === null || ws.readyState !== WebSocket.OPEN) return;

    const toSub: number[] = [];
    for (const tagId of desiredRef.current) {
      if (!serverRef.current.has(tagId)) toSub.push(tagId);
    }
    const toUnsub: number[] = [];
    for (const tagId of serverRef.current) {
      if (!desiredRef.current.has(tagId)) toUnsub.push(tagId);
    }

    const trendToSub: number[] = [];
    for (const tagId of trendDesiredRef.current) {
      if (!trendServerRef.current.has(tagId)) trendToSub.push(tagId);
    }
    const trendToUnsub: number[] = [];
    for (const tagId of trendServerRef.current) {
      if (!trendDesiredRef.current.has(tagId)) trendToUnsub.push(tagId);
    }

    // Wire order: SUBSCRIBE → SUBSCRIBE_TREND → UNSUBSCRIBE → UNSUBSCRIBE_TREND
    if (toSub.length > 0) {
      ws.send(JSON.stringify({ type: 'SUBSCRIBE', tagIds: toSub }));
      for (const t of toSub) serverRef.current.add(t);
    }
    if (trendToSub.length > 0) {
      ws.send(JSON.stringify({ type: 'SUBSCRIBE_TREND', tagIds: trendToSub }));
      for (const t of trendToSub) trendServerRef.current.add(t);
    }
    if (toUnsub.length > 0) {
      ws.send(JSON.stringify({ type: 'UNSUBSCRIBE', tagIds: toUnsub }));
      for (const t of toUnsub) serverRef.current.delete(t);
    }
    if (trendToUnsub.length > 0) {
      ws.send(JSON.stringify({ type: 'UNSUBSCRIBE_TREND', tagIds: trendToUnsub }));
      for (const t of trendToUnsub) trendServerRef.current.delete(t);
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (flushScheduledRef.current) return;
    flushScheduledRef.current = true;
    queueMicrotask(flush);
  }, [flush]);

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

        // Start PING interval for round-trip latency tracking
        if (pingIntervalRef.current !== null) clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'PING', ts: Date.now() }));
          }
        }, 5000);

        // Fresh connection — server knows nothing. Reconciler will re-subscribe everything.
        serverRef.current.clear();
        scheduleFlush();
      };

      ws.onmessage = (event: MessageEvent) => {
        // Byte counting — runs for every message regardless of type
        wsStatsRef.current.byteCount +=
          typeof event.data === 'string'
            ? event.data.length
            : ((event.data as ArrayBuffer).byteLength ?? 0);

        let msg: {
          type: string;
          values?: Record<string, unknown>;
          ts?: number;
          samples?: Array<{ moduleTs: number; tagId: number; value: number | boolean | string | null }>;
        };
        try {
          msg = JSON.parse(event.data as string) as typeof msg;
        } catch {
          return;
        }

        if (msg.type === 'SNAPSHOT' || msg.type === 'DELTA') {
          wsStatsRef.current.messageCount++;
          const entries = msg.values ?? {};
          for (const [key, rawValue] of Object.entries(entries)) {
            const tagId = Number(key);
            const lv: LiveValue = { value: rawValue as number | boolean | string | null };
            valuesRef.current.set(tagId, lv);
            subscribersRef.current.get(tagId)?.forEach(cb => cb(lv));
          }
        } else if (msg.type === 'TREND_DELTA') {
          wsStatsRef.current.messageCount++;
          for (const { moduleTs, tagId, value } of msg.samples ?? []) {
            trendSubscribersRef.current.get(tagId)?.forEach(cb => cb(moduleTs, value));
          }
        } else if (msg.type === 'PONG' && msg.ts !== undefined) {
          latencyRef.current = Date.now() - msg.ts;
        }
      };

      const onDisconnect = () => {
        // Server connection lost — it forgets all subscriptions.
        // Leave desiredRef/trendDesiredRef intact; next onopen reconciles from them.
        serverRef.current.clear();
        trendServerRef.current.clear();
        if (pingIntervalRef.current !== null) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
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

    // Stats snapshot interval — reads accumulated counts once per second
    statsIntervalRef.current = setInterval(() => {
      const ws = wsRef.current;
      const connected = ws !== null && ws.readyState === WebSocket.OPEN;
      const messagesPerSec = wsStatsRef.current.messageCount;
      const bytesPerSec = wsStatsRef.current.byteCount;
      wsStatsRef.current.messageCount = 0;
      wsStatsRef.current.byteCount = 0;
      setWsStats({
        connected,
        latencyMs: latencyRef.current,
        messagesPerSec,
        bytesPerSec,
        subscribedCount: serverRef.current.size,
      });
    }, 1000);

    return () => {
      destroyed = true;
      if (pingIntervalRef.current !== null) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      if (statsIntervalRef.current !== null) {
        clearInterval(statsIntervalRef.current);
        statsIntervalRef.current = null;
      }
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [tagMapLoaded, wsUrl, scheduleFlush]);

  // ─── C. Context value construction with stable method references ─────────────

  const getLiveValue = useCallback((tagId: number): LiveValue => {
    return valuesRef.current.get(tagId) ?? { value: null };
  }, []);

  const subscribeLiveValue = useCallback(
    (tagId: number, callback: (lv: LiveValue) => void): (() => void) => {
      // Register the callback.
      let subs = subscribersRef.current.get(tagId);
      if (!subs) {
        subs = new Set();
        subscribersRef.current.set(tagId, subs);
      }
      subs.add(callback);

      // Mark this tagId as desired and let the reconciler handle the wire.
      desiredRef.current.add(tagId);
      scheduleFlush();

      // Deliver current LKV synchronously so the hook has initial state.
      callback(valuesRef.current.get(tagId) ?? { value: null });

      return () => {
        const s = subscribersRef.current.get(tagId);
        if (!s) return;
        s.delete(callback);
        if (s.size === 0) {
          subscribersRef.current.delete(tagId);
          desiredRef.current.delete(tagId);
          scheduleFlush();
        }
      };
    },
    [scheduleFlush]
  );

  const subscribeTrend = useCallback(
    (
      tagId: number,
      callback: (moduleTs: number, value: number | boolean | string | null) => void,
    ): (() => void) => {
      let subs = trendSubscribersRef.current.get(tagId);
      if (!subs) {
        subs = new Set();
        trendSubscribersRef.current.set(tagId, subs);
      }
      subs.add(callback);
      trendDesiredRef.current.add(tagId);
      scheduleFlush();

      return () => {
        const s = trendSubscribersRef.current.get(tagId);
        if (!s) return;
        s.delete(callback);
        if (s.size === 0) {
          trendSubscribersRef.current.delete(tagId);
          trendDesiredRef.current.delete(tagId);
          scheduleFlush();
        }
      };
    },
    [scheduleFlush]
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
        data?: {
          devices: Array<{
            module_id: string;
            command_id: string;
            results: Array<{ tag_id: number; accepted: boolean; rejection_code?: string }>;
          }>;
        };
      };
      if (!json.ok) {
        const err = new Error(json.error?.message ?? 'Write failed') as Error & { code?: string };
        err.code = json.error?.code;
        throw err;
      }
      // Surface device-level rejections (MODULE_FAULT, TIMEOUT, etc.) as errors.
      // Uses optional chaining so mocks/tests that return { ok: true } with no data are safe.
      for (const device of json.data?.devices ?? []) {
        for (const result of device.results) {
          if (!result.accepted) {
            throw new Error(`Device rejected: ${result.rejection_code ?? 'UNKNOWN'}`);
          }
        }
      }
    },
    [apiUrl]
  );

  // tagMapLoaded in deps triggers a re-memo once tags are loaded, surfacing the populated tagMap.
  // getLiveValue/subscribeLiveValue/writeTag are stable refs (useCallback with stable deps).
  // wsStats is intentionally NOT here — it lives in its own context to avoid churn.
  const dataValue = useMemo<HmiDataContextValue>(
    () => ({ tagMap: tagMapRef.current, tagPathIndex: tagPathIndexRef.current, getLiveValue, subscribeLiveValue, subscribeTrend, writeTag }),
    [tagMapLoaded, getLiveValue, subscribeLiveValue, subscribeTrend, writeTag] // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (!tagMapLoaded) return null;

  return (
    <HmiDataContext.Provider value={dataValue}>
      <HmiStatsContext.Provider value={wsStats}>
        {children}
      </HmiStatsContext.Provider>
    </HmiDataContext.Provider>
  );
}
