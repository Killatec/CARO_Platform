import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import type { LkvCache, LkvValue } from './lkv.js';
import type { DutyTracker } from './duty-tracker.js';

interface WsClient {
  ws: WebSocket;
  subscriptions: Set<number>;
  lastSentGen: Map<number, number>;
  trendSubscriptions: Set<number>;
  trendOutbox: Map<number, Array<{ moduleTs: number; value: LkvValue }>>;
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
  private readonly trendFlushMs: number;

  constructor({
    lkv,
    tickMs,
    dutyTracker,
    trendableTagsByModule = new Map(),
    trendFlushHz = 4,
  }: {
    lkv: LkvCache;
    tickMs: number;
    dutyTracker: DutyTracker;
    trendableTagsByModule?: Map<string, Set<number>>;
    trendFlushHz?: number;
  }) {
    this.lkv = lkv;
    this.tickMs = tickMs;
    this.dutyTracker = dutyTracker;
    this.trendableTagsByModule = trendableTagsByModule;
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
        events.push({ moduleTs, value: lkvCache.get(tagId) ?? null });
      }
    }
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
        const newTagIds = msg.tagIds.filter(id => !client.subscriptions.has(id));
        for (const id of msg.tagIds) client.subscriptions.add(id);

        // Snapshot only the newly subscribed tags
        const values: Record<string, LkvValue> = {};
        for (const id of newTagIds) {
          values[String(id)] = this.lkv.getValue(id);
          client.lastSentGen.set(id, this.lkv.getGeneration(id));
        }
        this.send(client, { type: 'SNAPSHOT', values });
        break;
      }

      case 'UNSUBSCRIBE': {
        for (const id of msg.tagIds) {
          client.subscriptions.delete(id);
          client.lastSentGen.delete(id);
        }
        break;
      }

      case 'SUBSCRIBE_TREND': {
        for (const id of msg.tagIds) client.trendSubscriptions.add(id);
        break;
      }

      case 'UNSUBSCRIBE_TREND': {
        for (const id of msg.tagIds) {
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
      }
    });
  }

  private send(client: WsClient, payload: object): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(payload));
    }
  }
}
