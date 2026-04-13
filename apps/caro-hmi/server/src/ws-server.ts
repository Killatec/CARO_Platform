import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import type { LkvCache } from './lkv.js';
import type { DutyTracker } from './duty-tracker.js';

interface WsClient {
  ws: WebSocket;
  subscriptions: Set<number>;
  lastSentGen: Map<number, number>;
}

type InboundMessage =
  | { type: 'SUBSCRIBE';   tagIds: number[] }
  | { type: 'UNSUBSCRIBE'; tagIds: number[] }
  | { type: 'PING';        ts: number };

export class WsServer {
  private clients = new Set<WsClient>();
  private wss: WebSocketServer | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;

  private readonly lkv: LkvCache;
  private readonly tickMs: number;
  private readonly dutyTracker: DutyTracker;

  constructor({ lkv, tickMs, dutyTracker }: { lkv: LkvCache; tickMs: number; dutyTracker: DutyTracker }) {
    this.lkv = lkv;
    this.tickMs = tickMs;
    this.dutyTracker = dutyTracker;
  }

  attach(server: http.Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws: WebSocket) => {
      console.log('[WsServer] Client connected');
      const client: WsClient = {
        ws,
        subscriptions: new Set(),
        lastSentGen: new Map(),
      };
      this.clients.add(client);

      ws.on('message', (raw: Buffer) => {
        this.handleMessage(client, raw);
      });

      const cleanup = () => {
        this.clients.delete(client);
      };
      ws.on('close', cleanup);
      ws.on('error', cleanup);
    });

    this.tickTimer = setInterval(() => this.tick(), this.tickMs);
  }

  stop(): void {
    if (this.tickTimer !== null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    for (const client of this.clients) {
      client.ws.terminate();
    }
    this.clients.clear();
    this.wss?.close();
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
        const values: Record<string, number | boolean | string | null> = {};
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

        const delta: Record<string, number | boolean | string | null> = {};

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

  private send(client: WsClient, payload: object): void {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(payload));
    }
  }
}
