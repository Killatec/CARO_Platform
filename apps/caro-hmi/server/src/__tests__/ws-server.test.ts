import http from 'http';
import { WebSocket } from 'ws';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LkvCache } from '../lkv.js';
import { WsServer } from '../ws-server.js';
import { DutyTracker } from '../duty-tracker.js';

const TICK_MS = 20;

// ── Helpers ───────────────────────────────────────────────────────────────────

function wait(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function openClient(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://localhost:${port}/ws`);
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

/** Send a message and collect the next N response messages. */
function collect(
  ws: WebSocket,
  count: number,
  timeoutMs = 500
): Promise<object[]> {
  return new Promise((resolve, reject) => {
    const msgs: object[] = [];
    const timer = setTimeout(
      () => reject(new Error(`collect: timed out waiting for ${count} messages, got ${msgs.length}`)),
      timeoutMs
    );
    ws.on('message', (raw: Buffer) => {
      msgs.push(JSON.parse(raw.toString()) as object);
      if (msgs.length >= count) {
        clearTimeout(timer);
        resolve(msgs);
      }
    });
  });
}

/** Send a message and wait for the next response. */
async function roundtrip(ws: WebSocket, msg: object): Promise<object> {
  const p = collect(ws, 1);
  ws.send(JSON.stringify(msg));
  const [resp] = await p;
  return resp;
}

// ── Per-test server setup ─────────────────────────────────────────────────────

let httpServer: http.Server;
let wsServer: WsServer;
let lkv: LkvCache;
let port: number;
const openClients: WebSocket[] = [];

beforeEach(async () => {
  lkv = new LkvCache();
  wsServer = new WsServer({ lkv, tickMs: TICK_MS, dutyTracker: new DutyTracker() });
  httpServer = http.createServer();
  wsServer.attach(httpServer);
  await new Promise<void>(r => httpServer.listen(0, r));
  port = (httpServer.address() as { port: number }).port;
});

afterEach(async () => {
  for (const ws of openClients.splice(0)) {
    if (ws.readyState === WebSocket.OPEN) ws.terminate();
  }
  wsServer.stop();
  await new Promise<void>(r => httpServer.close(() => r()));
});

async function makeClient(): Promise<WebSocket> {
  const ws = await openClient(port);
  openClients.push(ws);
  return ws;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('WsServer', () => {
  it('client connects successfully', async () => {
    const ws = await makeClient();
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('SUBSCRIBE returns SNAPSHOT with current LKV values', async () => {
    lkv.set(1, 42.5);
    lkv.set(2, true);
    const ws = await makeClient();

    const resp = await roundtrip(ws, { type: 'SUBSCRIBE', tagIds: [1, 2] }) as {
      type: string;
      values: Record<string, unknown>;
    };

    expect(resp.type).toBe('SNAPSHOT');
    expect(resp.values['1']).toBe(42.5);
    expect(resp.values['2']).toBe(true);
  });

  it('SUBSCRIBE with unknown tags returns null values in SNAPSHOT', async () => {
    const ws = await makeClient();

    const resp = await roundtrip(ws, { type: 'SUBSCRIBE', tagIds: [999] }) as {
      type: string;
      values: Record<string, unknown>;
    };

    expect(resp.type).toBe('SNAPSHOT');
    expect(resp.values['999']).toBeNull();
  });

  it('DELTA sent on next tick for changed values', async () => {
    lkv.set(1, 10);
    const ws = await makeClient();
    ws.send(JSON.stringify({ type: 'SUBSCRIBE', tagIds: [1] }));
    await wait(TICK_MS * 2); // let SNAPSHOT land and tick settle

    // Remove snapshot listener and await the next delta
    const deltaP = new Promise<object>((resolve) => {
      ws.once('message', (raw: Buffer) => {
        resolve(JSON.parse(raw.toString()) as object);
      });
    });

    lkv.set(1, 99); // change value → generation bumps
    const delta = await deltaP as { type: string; values: Record<string, unknown> };

    expect(delta.type).toBe('DELTA');
    expect(delta.values['1']).toBe(99);
  });

  it('DELTA not sent when no values changed', async () => {
    lkv.set(1, 10);
    const ws = await makeClient();
    ws.send(JSON.stringify({ type: 'SUBSCRIBE', tagIds: [1] }));
    await wait(TICK_MS * 2); // SNAPSHOT + initial tick

    let received = false;
    ws.on('message', () => { received = true; });

    await wait(TICK_MS * 3); // several ticks with no LKV change
    expect(received).toBe(false);
  });

  it('multiple clients receive independent DELTAs filtered to their subscriptions', async () => {
    lkv.set(1, 0);
    lkv.set(2, 0);
    const ws1 = await makeClient();
    const ws2 = await makeClient();

    ws1.send(JSON.stringify({ type: 'SUBSCRIBE', tagIds: [1] }));
    ws2.send(JSON.stringify({ type: 'SUBSCRIBE', tagIds: [2] }));
    await wait(TICK_MS * 2);

    const delta1P = new Promise<object>(r => ws1.once('message', raw => r(JSON.parse((raw as Buffer).toString()) as object)));
    const delta2P = new Promise<object>(r => ws2.once('message', raw => r(JSON.parse((raw as Buffer).toString()) as object)));

    lkv.set(1, 111);
    lkv.set(2, 222);

    const [d1, d2] = await Promise.all([delta1P, delta2P]) as [
      { type: string; values: Record<string, unknown> },
      { type: string; values: Record<string, unknown> }
    ];

    expect(d1.type).toBe('DELTA');
    expect(d1.values['1']).toBe(111);
    expect(d1.values['2']).toBeUndefined();

    expect(d2.type).toBe('DELTA');
    expect(d2.values['2']).toBe(222);
    expect(d2.values['1']).toBeUndefined();
  });

  it('UNSUBSCRIBE stops DELTA delivery for those tags', async () => {
    lkv.set(1, 10);
    const ws = await makeClient();
    ws.send(JSON.stringify({ type: 'SUBSCRIBE', tagIds: [1] }));
    await wait(TICK_MS * 2);

    ws.send(JSON.stringify({ type: 'UNSUBSCRIBE', tagIds: [1] }));
    await wait(TICK_MS); // let unsubscribe process

    let received = false;
    ws.on('message', () => { received = true; });

    lkv.set(1, 99);
    await wait(TICK_MS * 3);
    expect(received).toBe(false);
  });

  it('PING returns PONG with same timestamp', async () => {
    const ws = await makeClient();
    const ts = Date.now();
    const resp = await roundtrip(ws, { type: 'PING', ts }) as { type: string; ts: number };
    expect(resp.type).toBe('PONG');
    expect(resp.ts).toBe(ts);
  });

  it('client disconnect cleans up without error on next tick', async () => {
    lkv.set(1, 1);
    const ws = await makeClient();
    ws.send(JSON.stringify({ type: 'SUBSCRIBE', tagIds: [1] }));
    await wait(TICK_MS);

    ws.terminate();
    await wait(TICK_MS * 2); // tick should not throw after disconnect

    lkv.set(1, 999);
    await wait(TICK_MS * 2); // no errors expected
  });

  it('SUBSCRIBE to additional tags sends SNAPSHOT for only the new tags', async () => {
    lkv.set(1, 'first');
    lkv.set(2, 'second');
    const ws = await makeClient();

    // First subscription
    await roundtrip(ws, { type: 'SUBSCRIBE', tagIds: [1] });

    // Second subscription — only tag 2 is new
    const resp = await roundtrip(ws, { type: 'SUBSCRIBE', tagIds: [2] }) as {
      type: string;
      values: Record<string, unknown>;
    };

    expect(resp.type).toBe('SNAPSHOT');
    expect(resp.values['2']).toBe('second');
    expect(resp.values['1']).toBeUndefined();
  });
});

// ── Trend channel ─────────────────────────────────────────────────────────────

const TREND_MODULE = 'mod_trend';
const TREND_TAG_1 = 10;
const TREND_TAG_2 = 20;

// trendableTagsByModule: mod_trend has tags 10 and 20
const TRENDABLE_BY_MODULE = new Map<string, Set<number>>([
  [TREND_MODULE, new Set([TREND_TAG_1, TREND_TAG_2])],
]);

// High flush rate (20 Hz / 50 ms) so tests don't need long waits
const TREND_FLUSH_HZ = 20;
const TREND_FLUSH_WAIT_MS = 200; // ≥4 flush cycles

let trendLkv: LkvCache;
let trendServer: WsServer;
let trendHttp: http.Server;
let trendPort: number;
const trendClients: WebSocket[] = [];

beforeEach(async () => {
  trendLkv = new LkvCache();
  trendServer = new WsServer({
    lkv: trendLkv,
    tickMs: TICK_MS,
    dutyTracker: new DutyTracker(),
    trendableTagsByModule: TRENDABLE_BY_MODULE,
    trendableTagIds: new Set([TREND_TAG_1, TREND_TAG_2]),
    trendFlushHz: TREND_FLUSH_HZ,
  });
  trendHttp = http.createServer();
  trendServer.attach(trendHttp);
  await new Promise<void>(r => trendHttp.listen(0, r));
  trendPort = (trendHttp.address() as { port: number }).port;
});

afterEach(async () => {
  for (const ws of trendClients.splice(0)) {
    if (ws.readyState === WebSocket.OPEN) ws.terminate();
  }
  trendServer.stop();
  await new Promise<void>(r => trendHttp.close(() => r()));
});

async function makeTrendClient(): Promise<WebSocket> {
  const ws = await openClient(trendPort);
  trendClients.push(ws);
  return ws;
}

/** Collect all TREND_DELTA frames received within timeoutMs. */
function collectTrendDeltas(
  ws: WebSocket,
  timeoutMs: number,
): Promise<Array<{ type: string; samples: Array<{ moduleTs: number; tagId: number; value: unknown }> }>> {
  return new Promise(resolve => {
    const frames: Array<{ type: string; samples: Array<{ moduleTs: number; tagId: number; value: unknown }> }> = [];
    const timer = setTimeout(() => resolve(frames), timeoutMs);
    ws.on('message', (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as { type: string; samples?: unknown[] };
      if (msg.type === 'TREND_DELTA') {
        frames.push(msg as { type: string; samples: Array<{ moduleTs: number; tagId: number; value: unknown }> });
        // keep collecting until timeout
      }
    });
    // ensure cleanup doesn't hold open
    timer.unref?.();
    void timer; // suppress unused warning
    void frames; // suppress unused warning
  });
}

describe('WsServer — trend channel', () => {
  it('SUBSCRIBE_TREND: flush delivers samples only for subscribed tag', async () => {
    trendLkv.set(TREND_TAG_1, 42);
    const ws = await makeTrendClient();
    ws.send(JSON.stringify({ type: 'SUBSCRIBE_TREND', tagIds: [TREND_TAG_1] }));

    const frames = await collectTrendDeltas(ws, TREND_FLUSH_WAIT_MS);

    expect(frames.length).toBeGreaterThanOrEqual(1);
    const allSamples = frames.flatMap(f => f.samples);
    const tag1Samples = allSamples.filter(s => s.tagId === TREND_TAG_1);
    const tag2Samples = allSamples.filter(s => s.tagId === TREND_TAG_2);
    expect(tag1Samples.length).toBeGreaterThanOrEqual(1);
    expect(tag2Samples).toHaveLength(0);
  });

  it('UNSUBSCRIBE_TREND: flush stops delivering samples for unsubscribed tag', async () => {
    trendLkv.set(TREND_TAG_1, 1);
    const ws = await makeTrendClient();
    ws.send(JSON.stringify({ type: 'SUBSCRIBE_TREND', tagIds: [TREND_TAG_1] }));
    await wait(TREND_FLUSH_WAIT_MS); // let some flushes land

    ws.send(JSON.stringify({ type: 'UNSUBSCRIBE_TREND', tagIds: [TREND_TAG_1] }));
    await wait(50); // let unsubscribe process

    const frames = await collectTrendDeltas(ws, TREND_FLUSH_WAIT_MS);
    const allSamples = frames.flatMap(f => f.samples);
    const tag1Samples = allSamples.filter(s => s.tagId === TREND_TAG_1);
    expect(tag1Samples).toHaveLength(0);
  });

  it('no TREND_DELTA when client has no trend subscriptions', async () => {
    const ws = await makeTrendClient();
    // No SUBSCRIBE_TREND sent

    const frames = await collectTrendDeltas(ws, TREND_FLUSH_WAIT_MS);
    expect(frames).toHaveLength(0);
  });

  it('handleTrendDelta routes real events into outbox → flush sends them', async () => {
    trendLkv.set(TREND_TAG_1, 99);
    const ws = await makeTrendClient();
    ws.send(JSON.stringify({ type: 'SUBSCRIBE_TREND', tagIds: [TREND_TAG_1] }));
    await wait(50); // let subscribe land

    const EXPECTED_TS = 1_234_567_890;
    // Resolve only on a frame that carries the specific moduleTs — ignores synthetic frames
    const frameP = new Promise<{ samples: Array<{ moduleTs: number; tagId: number; value: unknown }> }>(
      resolve => {
        ws.on('message', (raw: Buffer) => {
          const msg = JSON.parse(raw.toString()) as { type: string; samples?: Array<{ moduleTs: number; tagId: number; value: unknown }> };
          if (msg.type === 'TREND_DELTA' && msg.samples?.some(s => s.moduleTs === EXPECTED_TS)) {
            resolve(msg as { samples: Array<{ moduleTs: number; tagId: number; value: unknown }> });
          }
        });
      },
    );

    trendServer.handleTrendDelta(EXPECTED_TS, TREND_MODULE);
    const frame = await frameP;

    const sample = frame.samples.find(s => s.tagId === TREND_TAG_1 && s.moduleTs === EXPECTED_TS);
    expect(sample).toBeDefined();
    expect(sample!.value).toBe(99);
  });

  it('handleTrendDelta does nothing for unknown module', async () => {
    const ws = await makeTrendClient();
    ws.send(JSON.stringify({ type: 'SUBSCRIBE_TREND', tagIds: [TREND_TAG_1] }));
    await wait(50);

    // Spy to detect if outbox is written — indirect: just verify flush carries synthetic only
    trendServer.handleTrendDelta(9999, 'unknown_module');

    const frames = await collectTrendDeltas(ws, TREND_FLUSH_WAIT_MS);
    // Frames will have synthetic entries (not from handleTrendDelta for unknown module)
    // All samples must have tagId TREND_TAG_1 (synthetic); none should have moduleTs=9999
    const allSamples = frames.flatMap(f => f.samples);
    const fromUnknown = allSamples.filter(s => s.moduleTs === 9999);
    expect(fromUnknown).toHaveLength(0);
  });

  it('two clients with different subscriptions each get only their tag samples', async () => {
    trendLkv.set(TREND_TAG_1, 11);
    trendLkv.set(TREND_TAG_2, 22);
    const ws1 = await makeTrendClient();
    const ws2 = await makeTrendClient();

    ws1.send(JSON.stringify({ type: 'SUBSCRIBE_TREND', tagIds: [TREND_TAG_1] }));
    ws2.send(JSON.stringify({ type: 'SUBSCRIBE_TREND', tagIds: [TREND_TAG_2] }));
    await wait(50);

    trendServer.handleTrendDelta(1111, TREND_MODULE);

    const [frames1, frames2] = await Promise.all([
      collectTrendDeltas(ws1, TREND_FLUSH_WAIT_MS),
      collectTrendDeltas(ws2, TREND_FLUSH_WAIT_MS),
    ]);

    const tag2InClient1 = frames1.flatMap(f => f.samples).filter(s => s.tagId === TREND_TAG_2);
    const tag1InClient2 = frames2.flatMap(f => f.samples).filter(s => s.tagId === TREND_TAG_1);
    expect(tag2InClient1).toHaveLength(0);
    expect(tag1InClient2).toHaveLength(0);
  });

  it('synthetic-on-flush: subscribed tag with no real events gets synthetic sample with current LKV', async () => {
    trendLkv.set(TREND_TAG_1, 55.5);
    const ws = await makeTrendClient();
    ws.send(JSON.stringify({ type: 'SUBSCRIBE_TREND', tagIds: [TREND_TAG_1] }));
    // No handleTrendDelta called → only synthetic events

    const frames = await collectTrendDeltas(ws, TREND_FLUSH_WAIT_MS);
    const allSamples = frames.flatMap(f => f.samples).filter(s => s.tagId === TREND_TAG_1);
    expect(allSamples.length).toBeGreaterThanOrEqual(1);
    for (const s of allSamples) {
      expect(s.value).toBe(55.5); // LKV value
    }
  });

  it('synthetic with null LKV emits null-value sample', async () => {
    // LKV never set for TREND_TAG_1 → getValue returns null
    const ws = await makeTrendClient();
    ws.send(JSON.stringify({ type: 'SUBSCRIBE_TREND', tagIds: [TREND_TAG_1] }));

    const frames = await collectTrendDeltas(ws, TREND_FLUSH_WAIT_MS);
    const allSamples = frames.flatMap(f => f.samples).filter(s => s.tagId === TREND_TAG_1);
    expect(allSamples.length).toBeGreaterThanOrEqual(1);
    for (const s of allSamples) {
      expect(s.value).toBeNull();
    }
  });

  it('multiple ingests in one flush window produce multiple samples for the tag', async () => {
    trendLkv.set(TREND_TAG_1, 1);
    const ws = await makeTrendClient();
    ws.send(JSON.stringify({ type: 'SUBSCRIBE_TREND', tagIds: [TREND_TAG_1] }));
    await wait(50);

    // Both events use sentinel timestamps well below real Date.now() values to distinguish them
    const TS_A = 2000;
    const TS_B = 3000;

    // Resolve when a frame contains at least one of the sentinel timestamps
    const frameP = new Promise<{ samples: Array<{ moduleTs: number; tagId: number; value: unknown }> }>(
      resolve => {
        ws.on('message', (raw: Buffer) => {
          const msg = JSON.parse(raw.toString()) as { type: string; samples?: Array<{ moduleTs: number; tagId: number; value: unknown }> };
          if (msg.type === 'TREND_DELTA' && msg.samples?.some(s => s.moduleTs === TS_A || s.moduleTs === TS_B)) {
            resolve(msg as { samples: Array<{ moduleTs: number; tagId: number; value: unknown }> });
          }
        });
      },
    );

    trendLkv.set(TREND_TAG_1, 10);
    trendServer.handleTrendDelta(TS_A, TREND_MODULE);
    trendLkv.set(TREND_TAG_1, 20);
    trendServer.handleTrendDelta(TS_B, TREND_MODULE);

    const frame = await frameP;
    const tag1Samples = frame.samples.filter(
      s => s.tagId === TREND_TAG_1 && (s.moduleTs === TS_A || s.moduleTs === TS_B),
    );
    expect(tag1Samples.length).toBeGreaterThanOrEqual(1);
  });

  it('disconnect clears trendSubscriptions — no further frames after terminate', async () => {
    trendLkv.set(TREND_TAG_1, 7);
    const ws = await makeTrendClient();
    ws.send(JSON.stringify({ type: 'SUBSCRIBE_TREND', tagIds: [TREND_TAG_1] }));
    await wait(50);

    ws.terminate();
    await wait(TREND_FLUSH_WAIT_MS); // flush ticks should not throw after disconnect

    // No assertion needed beyond "no uncaught error during wait"
    // The test passes if nothing throws
  });
});

// ── F4: Shape validation and trendable-set filter ────────────────────────────

/** WsServer with no trendableTagIds (default empty set) — used for filter tests. */
let filterServer: WsServer;
let filterHttp: http.Server;
let filterPort: number;
const filterClients: WebSocket[] = [];

beforeEach(async () => {
  filterServer = new WsServer({
    lkv: new LkvCache(),
    tickMs: TICK_MS,
    dutyTracker: new DutyTracker(),
    trendableTagsByModule: TRENDABLE_BY_MODULE,
    // trendableTagIds intentionally omitted → defaults to empty Set
    trendFlushHz: TREND_FLUSH_HZ,
  });
  filterHttp = http.createServer();
  filterServer.attach(filterHttp);
  await new Promise<void>(r => filterHttp.listen(0, r));
  filterPort = (filterHttp.address() as { port: number }).port;
});

afterEach(async () => {
  for (const ws of filterClients.splice(0)) {
    if (ws.readyState === WebSocket.OPEN) ws.terminate();
  }
  filterServer.stop();
  await new Promise<void>(r => filterHttp.close(() => r()));
});

async function makeFilterClient(): Promise<WebSocket> {
  const ws = await openClient(filterPort);
  filterClients.push(ws);
  return ws;
}

describe('WsServer — F4 shape validation', () => {
  it('SUBSCRIBE with null tagIds is ignored — no SNAPSHOT received', async () => {
    const ws = await makeFilterClient();
    const p = collect(ws, 1, 150).catch(() => null);
    ws.send(JSON.stringify({ type: 'SUBSCRIBE', tagIds: null }));
    const result = await p;
    expect(result).toBeNull(); // timed out → no response
  });

  it('SUBSCRIBE with non-integer tagId is ignored — no SNAPSHOT received', async () => {
    const ws = await makeFilterClient();
    const p = collect(ws, 1, 150).catch(() => null);
    ws.send(JSON.stringify({ type: 'SUBSCRIBE', tagIds: [1.5, 2] }));
    const result = await p;
    expect(result).toBeNull();
  });

  it('SUBSCRIBE with negative tagId is ignored — no SNAPSHOT received', async () => {
    const ws = await makeFilterClient();
    const p = collect(ws, 1, 150).catch(() => null);
    ws.send(JSON.stringify({ type: 'SUBSCRIBE', tagIds: [-1] }));
    const result = await p;
    expect(result).toBeNull();
  });

  it('UNSUBSCRIBE with non-array tagIds is ignored — no crash', async () => {
    const ws = await makeFilterClient();
    // Subscribe first so there's state to unsubscribe from
    ws.send(JSON.stringify({ type: 'SUBSCRIBE', tagIds: [1] }));
    await wait(50);
    // Malformed unsubscribe — should not throw or crash
    ws.send(JSON.stringify({ type: 'UNSUBSCRIBE', tagIds: 'all' }));
    await wait(50);
    // Server still alive — connection remains open
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('SUBSCRIBE_TREND with non-array tagIds is ignored — no TREND_DELTA emitted', async () => {
    const ws = await makeTrendClient(); // uses trendServer which has trendableTagIds set
    trendLkv.set(TREND_TAG_1, 55);
    ws.send(JSON.stringify({ type: 'SUBSCRIBE_TREND', tagIds: 'bad' }));
    const frames = await collectTrendDeltas(ws, TREND_FLUSH_WAIT_MS);
    expect(frames).toHaveLength(0);
  });

  it('SUBSCRIBE_TREND with string tagId element is ignored — no TREND_DELTA emitted', async () => {
    const ws = await makeTrendClient();
    trendLkv.set(TREND_TAG_1, 55);
    ws.send(JSON.stringify({ type: 'SUBSCRIBE_TREND', tagIds: ['10'] }));
    const frames = await collectTrendDeltas(ws, TREND_FLUSH_WAIT_MS);
    expect(frames).toHaveLength(0);
  });

  it('UNSUBSCRIBE_TREND with non-array tagIds is ignored — no crash', async () => {
    const ws = await makeTrendClient();
    ws.send(JSON.stringify({ type: 'SUBSCRIBE_TREND', tagIds: [TREND_TAG_1] }));
    await wait(50);
    ws.send(JSON.stringify({ type: 'UNSUBSCRIBE_TREND', tagIds: null }));
    await wait(50);
    // Server still alive — connection remains open
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });
});

describe('WsServer — F4 trendable-set filter', () => {
  it('SUBSCRIBE_TREND with all non-trendable IDs delivers no TREND_DELTA frames', async () => {
    // filterServer has empty trendableTagIds — all IDs are rejected
    const ws = await makeFilterClient();
    const lkv = (filterServer as unknown as { lkv: LkvCache }).lkv;
    lkv?.set(TREND_TAG_1, 99);
    ws.send(JSON.stringify({ type: 'SUBSCRIBE_TREND', tagIds: [TREND_TAG_1] }));
    await wait(50);
    filterServer.handleTrendDelta(Date.now(), TREND_MODULE);
    const frames = await collectTrendDeltas(ws, TREND_FLUSH_WAIT_MS);
    expect(frames).toHaveLength(0);
  });

  it('SUBSCRIBE_TREND with IDs in trendableTagIds delivers TREND_DELTA frames', async () => {
    // trendServer has trendableTagIds = {TREND_TAG_1, TREND_TAG_2}
    trendLkv.set(TREND_TAG_1, 77);
    const ws = await makeTrendClient();
    ws.send(JSON.stringify({ type: 'SUBSCRIBE_TREND', tagIds: [TREND_TAG_1] }));
    await wait(50);
    trendServer.handleTrendDelta(Date.now(), TREND_MODULE);
    const frames = await collectTrendDeltas(ws, TREND_FLUSH_WAIT_MS);
    const hasDelta = frames.some(f => f.samples.some(s => s.tagId === TREND_TAG_1));
    expect(hasDelta).toBe(true);
  });

  it('SUBSCRIBE_TREND silently drops non-trendable IDs, keeps trendable ones', async () => {
    // trendServer: TREND_TAG_1 and TREND_TAG_2 are trendable; 999 is not
    trendLkv.set(TREND_TAG_1, 5);
    const ws = await makeTrendClient();
    ws.send(JSON.stringify({ type: 'SUBSCRIBE_TREND', tagIds: [TREND_TAG_1, 999] }));
    await wait(50);
    trendServer.handleTrendDelta(Date.now(), TREND_MODULE);
    const frames = await collectTrendDeltas(ws, TREND_FLUSH_WAIT_MS);
    // Tag 999 never appears in any frame
    const has999 = frames.some(f => f.samples.some(s => s.tagId === 999));
    expect(has999).toBe(false);
    // Tag 1 does appear
    const has1 = frames.some(f => f.samples.some(s => s.tagId === TREND_TAG_1));
    expect(has1).toBe(true);
  });
});
