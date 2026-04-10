import http from 'http';
import { ping, runMigrations } from '@caro/db';
import { config } from './config.js';
import { loadTagMap } from './tag-map.js';
import { LkvCache } from './lkv.js';
import { DbPipeline } from './db-pipeline.js';
import { MqttBridge } from './mqtt-bridge.js';
import { WsServer } from './ws-server.js';
import { createApp } from './app.js';

async function start(): Promise<void> {
  // 0. Verify DB connectivity and run migrations
  try {
    await ping();
    console.log(`[HMI] Connected to PostgreSQL`);
  } catch (err) {
    console.error('[HMI] Failed to connect to PostgreSQL:', (err as Error).message);
    process.exit(1);
  }

  try {
    await runMigrations();
  } catch (err) {
    console.error('[HMI] Startup aborted — migration failure:', (err as Error).message);
    process.exit(1);
  }

  // 1. Load tag map from DB
  let tagMapResult: Awaited<ReturnType<typeof loadTagMap>>;
  try {
    tagMapResult = await loadTagMap();
    console.log(`[HMI] Tag map loaded: ${tagMapResult.tagMap.size} tags, ${tagMapResult.moduleTagIds.size} modules`);
  } catch (err) {
    console.error('[HMI] Failed to load tag map from DB:', (err as Error).message);
    process.exit(1);
  }
  const { tagMap, moduleTagIds, trendableTagIds } = tagMapResult;

  // 2. Core data structures
  const lkv = new LkvCache();
  const dbPipeline = new DbPipeline();

  // 3. MQTT bridge
  const mqttBridge = new MqttBridge({
    lkv,
    tagMap,
    moduleTagIds,
    trendableTagIds,
    dbPipeline,
    config: {
      mqttUrl:             config.mqttUrl,
      watchdogTimeoutMs:   config.watchdogTimeoutMs,
      heartbeatIntervalMs: config.heartbeatIntervalMs,
    },
  });

  // 4. Express app + HTTP server
  const app = createApp(tagMap);
  const httpServer = http.createServer(app);

  // 5. WS server
  const wsServer = new WsServer({ lkv, tickMs: config.wsTickMs });
  wsServer.attach(httpServer);

  // 5b. DB pipeline flush timer (placeholder — just drains the queue)
  const dbFlushTimer = setInterval(() => dbPipeline.flush(), config.dbTickMs);

  // 6. Start MQTT (soft-fail — broker may be absent in dev)
  try {
    await mqttBridge.start();
    console.log(`[HMI] MQTT bridge connected: ${config.mqttUrl}`);
  } catch (err) {
    console.warn('[HMI] MQTT broker unavailable:', (err as Error).message);
    console.warn('[HMI] Continuing — REST and WS will serve from LKV without live telemetry');
  }

  // 7. Start HTTP server
  await new Promise<void>(resolve => httpServer.listen(config.hmiPort, resolve));

  console.log(`[HMI] Server started on port ${config.hmiPort}`);
  console.log(`[HMI]   Tags: ${tagMap.size} | Modules: ${moduleTagIds.size}`);
  console.log(`[HMI]   WS tick: ${config.wsTickMs}ms | Watchdog: ${config.watchdogTimeoutMs}ms`);

  // 8. Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[HMI] ${signal} — shutting down`);
    clearInterval(dbFlushTimer);
    await mqttBridge.stop().catch(() => {});
    wsServer.stop();
    httpServer.close(() => process.exit(0));
  };

  process.on('SIGINT',  () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

start().catch((err: unknown) => {
  console.error('[HMI] Startup error:', err);
  process.exit(1);
});
