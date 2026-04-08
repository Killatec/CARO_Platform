import http from 'http';
import { WebSocket } from 'ws';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { LkvCache } from '../lkv.js';
import { WsServer } from '../ws-server.js';

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
  wsServer = new WsServer({ lkv, tickMs: TICK_MS });
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
