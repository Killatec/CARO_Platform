import { renderHook, render, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState, type Dispatch, type SetStateAction } from 'react';
import type { ReactNode } from 'react';
import { HmiContextProvider } from '../HmiContextProvider.js';
import { HmiDataContext, HmiStatsContext } from '../HmiContext.js';
import { useLiveValue } from '../hooks/useLiveValue.js';
import { useHmiContext } from '../hooks/useHmiContext.js';
import { useTagMap } from '../hooks/useTagMap.js';
import { useTagWriter } from '../hooks/useTagWriter.js';
import { useWsStats } from '../hooks/useWsStats.js';
import { buildTagPathIndex } from '../tagPathIndex.js';
import type { HmiDataContextValue, WsStats } from '../types.js';
import { mockTag, mockReadbackTag } from './fixtures.js';

// ─── WebSocket mock ──────────────────────────────────────────────────────────

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static instances: MockWebSocket[] = [];
  static reset() { MockWebSocket.instances = []; }

  url: string;
  readyState = MockWebSocket.CONNECTING;
  sentMessages: string[] = [];

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) { this.sentMessages.push(data); }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ type: 'close', code: 1000, reason: '', wasClean: true } as CloseEvent);
  }

  // Test helpers
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({ type: 'open' } as Event);
  }

  simulateMessage(data: object) {
    this.onmessage?.({ type: 'message', data: JSON.stringify(data) } as MessageEvent);
  }
}

// ─── Test constants & helpers ────────────────────────────────────────────────

const API_URL = 'http://localhost:3003/api/v1';
const WS_URL  = 'ws://localhost:3003/ws';

function makeWrapper(tags = [mockTag]) {
  // Reset fetch mock so each wrapper creation starts with tag fetch response
  (globalThis.fetch as ReturnType<typeof vi.fn>)
    .mockResolvedValue({
      json: () => Promise.resolve({ ok: true, data: { tags } }),
    });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <HmiContextProvider apiUrl={API_URL} wsUrl={WS_URL}>
        {children}
      </HmiContextProvider>
    );
  };
}

/** Wait for the WS to be created (fetch resolved + tagMapLoaded → WS effect ran). */
async function getWsInstance(): Promise<MockWebSocket> {
  await waitFor(() => expect(MockWebSocket.instances.length).toBeGreaterThan(0));
  return MockWebSocket.instances[0];
}

/** Open the WS and flush pending microtasks/effects. */
async function openWs(ws: MockWebSocket) {
  await act(() => { ws.simulateOpen(); });
}

// ─── Setup / teardown ────────────────────────────────────────────────────────

beforeEach(() => {
  MockWebSocket.reset();
  globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket;
  globalThis.fetch = vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ ok: true, data: { tags: [mockTag] } }),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('HmiContextProvider', () => {
  // 1. Tag map loaded from REST
  it('fetches tags on mount and populates tagMap', async () => {
    const wrapper = makeWrapper([mockTag, mockReadbackTag]);
    const { result } = renderHook(() => useTagMap(), { wrapper });

    // Provider returns null until fetch resolves, so hooks are not yet mounted.
    // Wait for tags to load and provider to render children.
    await waitFor(() => expect(result.current?.size).toBe(2));

    expect(result.current.get(1001)).toEqual(mockTag);
    expect(result.current.get(1002)).toEqual(mockReadbackTag);
  });

  // 2. WebSocket opened with correct URL
  it('opens WebSocket with correct URL after tag map loads', async () => {
    const wrapper = makeWrapper();
    renderHook(() => useLiveValue(1001), { wrapper });

    const ws = await getWsInstance();
    expect(ws.url).toBe(WS_URL);
  });

  // 3. useLiveValue initial state
  it('returns { value: null } before any WS message arrives', async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useLiveValue(1001), { wrapper });

    const ws = await getWsInstance();
    await openWs(ws);

    expect(result.current).toEqual({ value: null });
  });

  // 4. SNAPSHOT updates useLiveValue
  it('SNAPSHOT message updates useLiveValue', async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useLiveValue(1001), { wrapper });

    const ws = await getWsInstance();
    await openWs(ws);

    await act(() => {
      ws.simulateMessage({ type: 'SNAPSHOT', values: { '1001': 42.5 } });
    });

    expect(result.current).toEqual({ value: 42.5 });
  });

  // 5. DELTA updates useLiveValue
  it('DELTA message updates useLiveValue', async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useLiveValue(1001), { wrapper });

    const ws = await getWsInstance();
    await openWs(ws);

    await act(() => {
      ws.simulateMessage({ type: 'DELTA', values: { '1001': 99 } });
    });

    expect(result.current).toEqual({ value: 99 });
  });

  // 6. SUBSCRIBE sent when hook subscribes
  it('sends SUBSCRIBE when subscribeLiveValue is called', async () => {
    const wrapper = makeWrapper();
    renderHook(() => useLiveValue(1001), { wrapper });

    const ws = await getWsInstance();
    await openWs(ws);

    const subscribes = ws.sentMessages
      .map(m => JSON.parse(m) as { type: string; tagIds: number[] })
      .filter(m => m.type === 'SUBSCRIBE');

    expect(subscribes.some(m => m.tagIds.includes(1001))).toBe(true);
  });

  // 7. Multiple hooks subscribing simultaneously → one SUBSCRIBE
  it('batches simultaneous subscriptions into one SUBSCRIBE message', async () => {
    const wrapper = makeWrapper([mockTag, mockReadbackTag]);
    renderHook(
      () => ({ v1: useLiveValue(1001), v2: useLiveValue(1002) }),
      { wrapper },
    );

    const ws = await getWsInstance();
    await openWs(ws);

    const subscribes = ws.sentMessages
      .map(m => JSON.parse(m) as { type: string; tagIds: number[] })
      .filter(m => m.type === 'SUBSCRIBE');

    expect(subscribes).toHaveLength(1);
    expect(subscribes[0].tagIds).toContain(1001);
    expect(subscribes[0].tagIds).toContain(1002);
  });

  // 8. Unsubscribe (last subscriber removed) sends UNSUBSCRIBE
  it('sends UNSUBSCRIBE when the last subscriber unmounts', async () => {
    // Keep the provider mounted — only unmount the hook consumer component so
    // the WS stays open and UNSUBSCRIBE can actually be sent.
    let toggle!: (show: boolean) => void;

    function ToggleHook() {
      const [show, setShow] = useState(true);
      toggle = setShow;
      return show ? <HookUser /> : null;
    }

    function HookUser() {
      useLiveValue(1001);
      return null;
    }

    render(
      <HmiContextProvider apiUrl={API_URL} wsUrl={WS_URL}>
        <ToggleHook />
      </HmiContextProvider>,
    );

    const ws = await getWsInstance();
    await openWs(ws);

    ws.sentMessages.length = 0;

    // Unmount the hook consumer while keeping the provider alive
    await act(() => { toggle(false); });

    const unsubscribes = ws.sentMessages
      .map(m => JSON.parse(m) as { type: string; tagIds: number[] })
      .filter(m => m.type === 'UNSUBSCRIBE');

    expect(unsubscribes.some(m => m.tagIds.includes(1001))).toBe(true);
  });

  // 9. Two hooks for same tagId → only one WS subscription
  it('multiple hooks for the same tagId share one WS subscription', async () => {
    const wrapper = makeWrapper();
    renderHook(
      () => ({ v1: useLiveValue(1001), v2: useLiveValue(1001) }),
      { wrapper },
    );

    const ws = await getWsInstance();
    await openWs(ws);

    const subscribes = ws.sentMessages
      .map(m => JSON.parse(m) as { type: string; tagIds: number[] })
      .filter(m => m.type === 'SUBSCRIBE');

    expect(subscribes).toHaveLength(1);
    const allTagIds = subscribes.flatMap(m => m.tagIds);
    // 1001 appears exactly once — no duplicate subscriptions
    expect(allTagIds.filter(id => id === 1001)).toHaveLength(1);
  });

  // 10. writeTag posts to correct endpoint with correct body
  it('writeTag posts to the correct endpoint with the correct body', async () => {
    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;

    const wrapper = makeWrapper();
    const { result } = renderHook(() => useTagWriter(), { wrapper });

    const ws = await getWsInstance();
    await openWs(ws);

    // Override the next fetch call with the write response
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({ ok: true }),
    });

    await act(async () => {
      await result.current.write(1001, 750);
    });

    const writeCalls = (mockFetch.mock.calls as unknown[][]).filter(
      (args) => typeof args[0] === 'string' && (args[0] as string).includes('/tags/write'),
    );
    expect(writeCalls).toHaveLength(1);

    const [, options] = writeCalls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(options.body as string)).toEqual({
      values: [{ tag_id: 1001, value: 750 }],
      comment: 'HMI write',
    });
  });
});

// ─── Context-split regression tests ─────────────────────────────────────────
//
// These tests use HmiDataContext and HmiStatsContext directly to isolate the
// stats context updates from the stable data context.  They are the regression
// guard for the subscription-churn bug: before the split, every stats tick
// caused HmiContextValue identity to flip, which re-ran useLiveValue's
// useEffect, producing an UNSUBSCRIBE + re-SUBSCRIBE on every tick.

const defaultStats: WsStats = {
  connected: true, latencyMs: null, messagesPerSec: 0, bytesPerSec: 0, subscribedCount: 0,
};

function makeStableDataValue(
  subscribeSpy: (tagId: number, cb: (lv: { value: unknown }) => void) => () => void
): HmiDataContextValue {
  return {
    tagMap: new Map(),
    tagPathIndex: buildTagPathIndex([]),
    getLiveValue: () => ({ value: null }),
    subscribeLiveValue: subscribeSpy as HmiDataContextValue['subscribeLiveValue'],
    writeTag: async () => {},
  };
}

describe('context split — subscription churn regression', () => {
  it('stats context update does NOT re-run useLiveValue subscribe effect', async () => {
    // subscribeSpy counts how many times useLiveValue registers a new subscriber.
    // Before the fix: stats tick → new ctx identity → effect re-runs → spy called twice.
    // After the fix : stats tick only updates HmiStatsContext → data ctx unchanged → spy called once.
    const subscribeSpy = vi.fn().mockReturnValue(() => {});
    const dataValue = makeStableDataValue(subscribeSpy);

    let setStats!: Dispatch<SetStateAction<WsStats>>;

    function TestWrapper({ children }: { children: ReactNode }) {
      const [stats, setS] = useState<WsStats>(defaultStats);
      setStats = setS;
      return (
        <HmiDataContext.Provider value={dataValue}>
          <HmiStatsContext.Provider value={stats}>
            {children}
          </HmiStatsContext.Provider>
        </HmiDataContext.Provider>
      );
    }

    renderHook(() => useLiveValue(1001), { wrapper: TestWrapper });

    // Initial mount: subscribe should fire exactly once.
    expect(subscribeSpy).toHaveBeenCalledTimes(1);

    // Simulate a stats tick — only HmiStatsContext changes.
    await act(() => {
      setStats({ ...defaultStats, messagesPerSec: 5, subscribedCount: 3 });
    });

    // subscribe must NOT have been called again (no churn).
    expect(subscribeSpy).toHaveBeenCalledTimes(1);
  });

  it('stats context update re-renders useWsStats consumer but NOT useLiveValue consumer', async () => {
    const subscribeSpy = vi.fn().mockReturnValue(() => {});
    const dataValue = makeStableDataValue(subscribeSpy);

    let setStats!: Dispatch<SetStateAction<WsStats>>;
    const liveRenders = { count: 0 };
    const statsRenders = { count: 0 };

    function TestWrapper({ children }: { children: ReactNode }) {
      const [stats, setS] = useState<WsStats>(defaultStats);
      setStats = setS;
      return (
        <HmiDataContext.Provider value={dataValue}>
          <HmiStatsContext.Provider value={stats}>
            {children}
          </HmiStatsContext.Provider>
        </HmiDataContext.Provider>
      );
    }

    function LiveConsumer() {
      useLiveValue(1001);
      liveRenders.count++;
      return null;
    }

    function StatsConsumer() {
      useWsStats();
      statsRenders.count++;
      return null;
    }

    render(
      <TestWrapper>
        <LiveConsumer />
        <StatsConsumer />
      </TestWrapper>,
    );

    const liveCountAfterMount  = liveRenders.count;
    const statsCountAfterMount = statsRenders.count;

    // Trigger a stats update — identical to the real 1 s stats interval firing.
    await act(() => {
      setStats({ ...defaultStats, messagesPerSec: 10 });
    });

    // Stats consumer must have re-rendered.
    expect(statsRenders.count).toBeGreaterThan(statsCountAfterMount);
    // Live-value consumer must NOT have re-rendered.
    expect(liveRenders.count).toBe(liveCountAfterMount);
  });
});

// ─── WS reconciler invariant tests ──────────────────────────────────────────
//
// These tests assert on the outbound wire message sequence, which is the
// public contract of the reconciler. Each test uses the MockWebSocket's
// sentMessages array as the source of truth.

describe('WS reconciler', () => {
  // R-1. Basic batch: 5 synchronous subscriptions → one SUBSCRIBE with all 5 IDs.
  it('batches 5 synchronous subscriptions into one SUBSCRIBE', async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useHmiContext(), { wrapper });
    const ws = await getWsInstance();
    await openWs(ws);
    ws.sentMessages.length = 0;

    const unsubs: (() => void)[] = [];
    await act(() => {
      for (const tagId of [1, 2, 3, 4, 5]) {
        unsubs.push(result.current.subscribeLiveValue(tagId, () => {}));
      }
    });

    const subs = ws.sentMessages
      .map(m => JSON.parse(m) as { type: string; tagIds: number[] })
      .filter(m => m.type === 'SUBSCRIBE');
    expect(subs).toHaveLength(1);
    expect([...subs[0].tagIds].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);

    // cleanup
    await act(() => { unsubs.forEach(u => u()); });
  });

  // R-2. Unsubscribe batch: after flush, 5 simultaneous unsubs → one UNSUBSCRIBE.
  it('batches 5 synchronous unsubscribes into one UNSUBSCRIBE', async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useHmiContext(), { wrapper });
    const ws = await getWsInstance();
    await openWs(ws);

    const unsubs: (() => void)[] = [];
    await act(() => {
      for (const tagId of [1, 2, 3, 4, 5]) {
        unsubs.push(result.current.subscribeLiveValue(tagId, () => {}));
      }
    });

    ws.sentMessages.length = 0;

    await act(() => { unsubs.forEach(u => u()); });

    const unsubMsgs = ws.sentMessages
      .map(m => JSON.parse(m) as { type: string; tagIds: number[] })
      .filter(m => m.type === 'UNSUBSCRIBE');
    expect(unsubMsgs).toHaveLength(1);
    expect([...unsubMsgs[0].tagIds].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
  });

  // R-3. Same-tick cancel (subscribe then unsubscribe): zero wire messages.
  it('subscribe then immediate unsubscribe in same tick produces no wire messages', async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useHmiContext(), { wrapper });
    const ws = await getWsInstance();
    await openWs(ws);
    ws.sentMessages.length = 0;

    await act(() => {
      const unsub = result.current.subscribeLiveValue(9999, () => {});
      unsub();
    });

    expect(ws.sentMessages).toHaveLength(0);
  });

  // R-4. Same-tick cancel (unsubscribe then re-subscribe): zero wire messages.
  //      serverRef still contains the tagId after the flush.
  it('unsubscribe then re-subscribe in same tick produces no wire messages', async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useHmiContext(), { wrapper });
    const ws = await getWsInstance();
    await openWs(ws);

    // Subscribe and let it flush so 9999 enters serverRef.
    let unsub!: () => void;
    await act(() => {
      unsub = result.current.subscribeLiveValue(9999, () => {});
    });

    ws.sentMessages.length = 0;

    // Within one tick: remove then re-add — reconciler sees no diff.
    let unsub2!: () => void;
    await act(() => {
      unsub();
      unsub2 = result.current.subscribeLiveValue(9999, () => {});
    });

    expect(ws.sentMessages).toHaveLength(0);

    // cleanup
    await act(() => { unsub2(); });
  });

  // R-5. Mixed flush: SUBSCRIBE [C] sent before UNSUBSCRIBE [A], in that order.
  it('mixed flush emits one SUBSCRIBE then one UNSUBSCRIBE in correct order', async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useHmiContext(), { wrapper });
    const ws = await getWsInstance();
    await openWs(ws);

    // Subscribe A (101) and B (102), let them flush.
    let unsubA!: () => void;
    let unsubB!: () => void;
    await act(() => {
      unsubA = result.current.subscribeLiveValue(101, () => {});
      unsubB = result.current.subscribeLiveValue(102, () => {});
    });

    ws.sentMessages.length = 0;

    // Synchronously unsub A and sub C (103), then flush.
    let unsubC!: () => void;
    await act(() => {
      unsubA();
      unsubC = result.current.subscribeLiveValue(103, () => {});
    });

    const msgs = ws.sentMessages
      .map(m => JSON.parse(m) as { type: string; tagIds: number[] })
      .filter(m => m.type === 'SUBSCRIBE' || m.type === 'UNSUBSCRIBE');

    expect(msgs).toHaveLength(2);
    expect(msgs[0].type).toBe('SUBSCRIBE');
    expect(msgs[0].tagIds).toEqual([103]);
    expect(msgs[1].type).toBe('UNSUBSCRIBE');
    expect(msgs[1].tagIds).toEqual([101]);

    // cleanup
    await act(() => { unsubB(); unsubC(); });
  });

  // R-6. Refcount: unmounting one of two hooks → zero wire; unmounting both → one UNSUBSCRIBE.
  it('refcount: one of two hooks unmounts silently, both unmounting sends one UNSUBSCRIBE', async () => {
    let toggleA!: (show: boolean) => void;
    let toggleB!: (show: boolean) => void;

    function Setup() {
      const [showA, setA] = useState(true);
      const [showB, setB] = useState(true);
      toggleA = setA;
      toggleB = setB;
      return (
        <>
          {showA && <HookUser />}
          {showB && <HookUser />}
        </>
      );
    }

    function HookUser() {
      useLiveValue(1001);
      return null;
    }

    render(
      <HmiContextProvider apiUrl={API_URL} wsUrl={WS_URL}>
        <Setup />
      </HmiContextProvider>,
    );

    const ws = await getWsInstance();
    await openWs(ws);
    ws.sentMessages.length = 0;

    // Unmount A — refcount drops to 1, no wire message expected.
    await act(() => { toggleA(false); });
    expect(
      ws.sentMessages.filter(m => (JSON.parse(m) as { type: string }).type === 'UNSUBSCRIBE'),
    ).toHaveLength(0);

    // Unmount B — refcount drops to 0, one batched UNSUBSCRIBE expected.
    await act(() => { toggleB(false); });
    const unsubs = ws.sentMessages
      .map(m => JSON.parse(m) as { type: string; tagIds: number[] })
      .filter(m => m.type === 'UNSUBSCRIBE');
    expect(unsubs).toHaveLength(1);
    expect(unsubs[0].tagIds).toContain(1001);
  });

  // R-7. Reconnect: close then open sends one SUBSCRIBE with all desiredRef tagIds, no UNSUBSCRIBE.
  it('reconnect sends one batched SUBSCRIBE with all desired tagIds and no UNSUBSCRIBE', async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useHmiContext(), { wrapper });
    const ws = await getWsInstance();
    await openWs(ws);

    const unsubs: (() => void)[] = [];
    await act(() => {
      unsubs.push(result.current.subscribeLiveValue(1, () => {}));
      unsubs.push(result.current.subscribeLiveValue(2, () => {}));
      unsubs.push(result.current.subscribeLiveValue(3, () => {}));
    });

    // Simulate disconnect — serverRef is cleared, reconnect timer scheduled.
    await act(() => { ws.close(); });

    // Wait for the reconnect timer (1000 ms default) to fire and create the new WS.
    await waitFor(() => expect(MockWebSocket.instances.length).toBe(2), { timeout: 2500 });
    const ws2 = MockWebSocket.instances[1];
    await openWs(ws2);

    const subs = ws2.sentMessages
      .map(m => JSON.parse(m) as { type: string; tagIds: number[] })
      .filter(m => m.type === 'SUBSCRIBE');
    expect(subs).toHaveLength(1);
    expect([...subs[0].tagIds].sort((a, b) => a - b)).toEqual([1, 2, 3]);

    expect(
      ws2.sentMessages.filter(m => (JSON.parse(m) as { type: string }).type === 'UNSUBSCRIBE'),
    ).toHaveLength(0);

    await act(() => { unsubs.forEach(u => u()); });
  }, 4000);

  // R-8. Closed socket: subscriptions while socket is not OPEN are buffered in desiredRef;
  //      once the socket opens, the reconciler emits one SUBSCRIBE with all buffered tagIds.
  it('subscriptions while socket is CONNECTING are sent once the socket opens', async () => {
    const wrapper = makeWrapper();
    const { result } = renderHook(() => useHmiContext(), { wrapper });

    // WS exists but has not opened yet.
    const ws = await getWsInstance();

    const unsubs: (() => void)[] = [];
    await act(() => {
      unsubs.push(result.current.subscribeLiveValue(1, () => {}));
      unsubs.push(result.current.subscribeLiveValue(2, () => {}));
    });

    // Flush ran but socket was CONNECTING — nothing on the wire yet.
    expect(
      ws.sentMessages.filter(m => (JSON.parse(m) as { type: string }).type === 'SUBSCRIBE'),
    ).toHaveLength(0);

    // Open the socket — onopen clears serverRef and calls scheduleFlush.
    await openWs(ws);

    const subs = ws.sentMessages
      .map(m => JSON.parse(m) as { type: string; tagIds: number[] })
      .filter(m => m.type === 'SUBSCRIBE');
    expect(subs).toHaveLength(1);
    expect([...subs[0].tagIds].sort((a, b) => a - b)).toEqual([1, 2]);

    await act(() => { unsubs.forEach(u => u()); });
  });
});
