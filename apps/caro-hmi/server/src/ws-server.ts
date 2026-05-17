import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import type { LkvCache, LkvValue } from './lkv.js';
import type { DutyTracker } from './duty-tracker.js';

/**
 * Per-tag cap on the trend outbox.
 *
 * Each trendable tag has its own event array in `client.trendOutbox`. When a
 * tag's array reaches this limit (because the WS send buffer is back-pressured
 * and trendFlush can't drain), the oldest event is dropped to make room. A
 * per-client drop counter accumulates across the flush window and emits one
 * batched warn per flush.
 *
 * 500 events ≈ 50 seconds of nominal 10 Hz COV per tag — generous headroom
 * before drops on any realistic network hiccup. Worst-case memory per stuck
 * client = subscribed_tags × 500 × ~48 bytes/event; bounded and small even at
 * the 8-tag UX cap.
 */
const MAX_TREND_OUTBOX_PER_TAG = 500;

interface WsClient {
  ws: WebSocket;
  subscriptions: Set<number>;
  lastSentGen: Map<number, number>;
  trendSubscriptions: Set<number>;
  trendOutbox: Map<number, Array<{ moduleTs: number; value: LkvValue }>>;
  trendDroppedCount: number;
}

type InboundMessage =
  | { type: 'SUBSCRIBE';         tagIds: number[] }
  | { type: 'UNSUBSCRIBE';       tagIds: number[] }
  | { type: 'SUBSCRIBE_TREND';   tagIds: number[] }
  | { type: 'UNSUBSCRIBE_TREND'; tagIds: number[] }
  | { type: 'PING';              ts: number };

export class WsServer {
  private clients = new Set<WsClient>();
  private wss: WebSocketServer | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private trendFlushTimer: ReturnType<typeof setInterval> | null = null;

  private readonly lkv: LkvCache;
  private readonly tickMs: number;
  private readonly dutyTracker: DutyTracker;
  private readonly trendableTagsByModule: Map<string, Set<number>>;
  private readonly trendableTagIds: Set<number>;
  private readonly trendFlushMs: number;

  constructor({
    lkv,
    tickMs,
    dutyTracker,
    trendableTagsByModule = new Map(),
    trendableTagIds = new Set(),
    trendFlushHz = 4,
  }: {
    lkv: LkvCache;
    tickMs: number;
    dutyTracker: DutyTracker;
    trendableTagsByModule?: Map<string, Set<number>>;
    trendableTagIds?: Set<number>;
    trendFlushHz?: number;
  }) {
    this.lkv = lkv;
    this.tickMs = tickMs;
    this.dutyTracker = dutyTracker;
    this.trendableTagsByModule = trendableTagsByModule;
    this.trendableTagIds = trendableTagIds;
    this.trendFlushMs = Math.round(1000 / trendFlushHz);
  }

  attach(server: http.Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket) => {
      console.log('[WsServer] Client connected');
      const client: WsClient = {
        ws,
        subscriptions: new Set(),
        lastSentGen: new Map(),
        trendSubscriptions: new Set(),
        trendOutbox: new Map(),
        trendDroppedCount: 0,
      };
      this.clients.add(client);

      ws.on('message', (raw: Buffer) => {
        this.handleMessage(client, raw);
      });

      const cleanup = () => {
        client.trendSubscriptions.clear();
        client.trendOutbox.clear();
        this.clients.delete(client);
      };
      ws.on('close', cleanup);
      ws.on('error', cleanup);
    });

    this.tickTimer = setInterval(() => this.tick(), this.tickMs);
    this.trendFlushTimer = setInterval(() => this.trendFlush(), this.trendFlushMs);
  }

  stop(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    if (this.trendFlushTimer !== null) {
      clearInterval(this.trendFlushTimer);
      this.trendFlushTimer = null;
    }
    for (const client of this.clients) {
      client.ws.terminate();
    }
    this.clients.clear();
    this.wss?.close();
  }

  /** Called by TelemetryIntake listener after every ingest. Hot path — O(tags × clients). */
  handleTrendDelta(moduleTs: number, moduleId: string): void {
    const trendableTags = this.trendableTagsByModule.get(moduleId);
    if (!trendableTags || trendableTags.size === 0) return;

    // Read LKV once — shared across all clients for this ingest
    const lkvCache = new Map<number, LkvValue>();
    for (const tagId of trendableTags) {
      lkvCache.set(tagId, this.lkv.getValue(tagId));
    }

    for (const client of this.clients) {
      for (const tagId of trendableTags) {
        if (!client.trendSubscriptions.has(tagId)) continue;
        let events = client.trendOutbox.get(tagId);
        if (!events) {
          events = [];
          client.trendOutbox.set(tagId, events);
        }
        if (events.length >= MAX_TREND_OUTBOX_PER_TAG) {
          events.shift();                    // drop oldest — newest data is more relevant for live tail
          client.trendDroppedCount++;
        }
        events.push({ moduleTs, value: lkvCache.get(tagId) ?? null });
      }
    }
  }

  private parseTagIdsArray(value: unknown): number[] | null {
    if (!Array.isArray(value)) return null;
    for (const v of value) {
      if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) return null;
    }
    return value as number[];
  }

  private handleMessage(client: WsClient, raw: Buffer): void {
    let msg: InboundMessage;
    try {
      msg = JSON.parse(raw.toString()) as InboundMessage;
    } catch {
      return;
    }

    switch (msg.type) {
      case 'SUBSCRIBE': {
        const tagIds = this.parseTagIdsArray((msg as { tagIds?: unknown }).tagIds);
        if (!tagIds) { console.warn('[WsServer] SUBSCRIBE: ignored malformed tagIds payload'); return; }
        const newTagIds = tagIds.filter(id => !client.subscriptions.has(id));
        for (const id of tagIds) client.subscriptions.add(id);
        const values: Record<string, LkvValue> = {};
        for (const id of newTagIds) {
          values[String(id)] = this.lkv.getValue(id);
          client.lastSentGen.set(id, this.lkv.getGeneration(id));
        }
        this.send(client, { type: 'SNAPSHOT', values });
        break;
      }

      case 'UNSUBSCRIBE': {
        const tagIds = this.parseTagIdsArray((msg as { tagIds?: unknown }).tagIds);
        if (!tagIds) { console.warn('[WsServer] UNSUBSCRIBE: ignored malformed tagIds payload'); return; }
        for (const id of tagIds) {
          client.subscriptions.delete(id);
          client.lastSentGen.delete(id);
        }
        break;
      }

      case 'SUBSCRIBE_TREND': {
        const tagIds = this.parseTagIdsArray((msg as { tagIds?: unknown }).tagIds);
        if (!tagIds) { console.warn('[WsServer] SUBSCRIBE_TREND: ignored malformed tagIds payload'); return; }
        const rejected: number[] = [];
        for (const id of tagIds) {
          if (this.trendableTagIds.has(id)) {
            client.trendSubscriptions.add(id);
          } else {
            rejected.push(id);
          }
        }
        if (rejected.length > 0) {
          console.warn(
            `[WsServer] SUBSCRIBE_TREND: ignored ${rejected.length} non-trendable (or non-existing) tagId(s): ${rejected.join(', ')}`,
          );
        }
        break;
      }

      case 'UNSUBSCRIBE_TREND': {
        const tagIds = this.parseTagIdsArray((msg as { tagIds?: unknown }).tagIds);
        if (!tagIds) { console.warn('[WsServer] UNSUBSCRIBE_TREND: ignored malformed tagIds payload'); return; }
        for (const id of tagIds) {
          client.trendSubscriptions.delete(id);
          client.trendOutbox.delete(id);
        }
        break;
      }

      case 'PING': {
        this.send(client, { type: 'PONG', ts: msg.ts });
        break;
      }
    }
  }

  private tick(): void {
    this.dutyTracker.track(() => {
      for (const client of this.clients) {
        if (client.ws.readyState !== WebSocket.OPEN) continue;

        const delta: Record<string, LkvValue> = {};

        for (const tagId of client.subscriptions) {
          const currentGen = this.lkv.getGeneration(tagId);
          const lastGen = client.lastSentGen.get(tagId) ?? 0;
          if (currentGen > lastGen) {
            delta[String(tagId)] = this.lkv.getValue(tagId);
            client.lastSentGen.set(tagId, currentGen);
          }
        }

        if (Object.keys(delta).length > 0) {
          this.send(client, { type: 'DELTA', values: delta });
        }
      }
    });
  }

  private trendFlush(): void {
    this.dutyTracker.track(() => {
      const serverNow = Date.now();
      for (const client of this.clients) {
        if (client.ws.readyState !== WebSocket.OPEN) continue;
        if (client.trendSubscriptions.size === 0) continue;

        const samples: Array<{ moduleTs: number; tagId: number; value: LkvValue }> = [];

        for (const tagId of client.trendSubscriptions) {
          const events = client.trendOutbox.get(tagId);
          if (events && events.length > 0) {
            for (const evt of events) {
              samples.push({ moduleTs: evt.moduleTs, tagId, value: evt.value });
            }
          } else {
            samples.push({ moduleTs: serverNow, tagId, value: this.lkv.getValue(tagId) });
          }
        }

        client.trendOutbox.clear();
        this.send(client, { type: 'TREND_DELTA', samples });

        if (client.trendDroppedCount > 0) {
          console.warn(
            `[WsServer] dropped ${client.trendDroppedCount} trend sample(s) (outbox overflow; ` +
            `per-tag cap=${MAX_TREND_OUTBOX_PER_TAG}). Client likely back-pressured or stalled.`,
          );
          client.trendDroppedCount = 0;
        }
      }
    });
  }

  private send(client: WsClient, payload: object): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(payload));
    }
  }
}
