import http from 'http';
import { ping, runMigrations, getActiveTags } from '@caro/db';
import { config } from './config.js';
import { loadTagMap } from './tag-map.js';
import { LkvCache } from './lkv.js';
import { DbPipeline } from './db-pipeline.js';
import { TelemetryIntake } from './telemetry-intake.js';
import { HmiTagSource } from './hmi-tag-source.js';
import { MqttBridge } from './mqtt-bridge.js';
import { WsServer } from './ws-server.js';
import { createApp } from './app.js';
import { DutyTracker } from './duty-tracker.js';

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

  // 1. Fetch raw tag rows, then build tag map
  let rows: Awaited<ReturnType<typeof getActiveTags>>;
  try {
    rows = await getActiveTags();
  } catch (err) {
    console.error('[HMI] Failed to fetch active tags from DB:', (err as Error).message);
    process.exit(1);
  }

  let tagMapResult: Awaited<ReturnType<typeof loadTagMap>>;
  try {
    tagMapResult = await loadTagMap(rows);
    console.log(`[HMI] Tag map loaded: ${tagMapResult.tagMap.size} tags, ${tagMapResult.moduleTagIds.size} modules`);
  } catch (err) {
    console.error('[HMI] Failed to build tag map:', (err as Error).message);
    process.exit(1);
  }
  const { tagMap, moduleTagIds, trendableTagIds } = tagMapResult;

  // 2. Core data structures
  const lkv = new LkvCache();
  const dbPipeline = new DbPipeline();
  const dutyTracker = new DutyTracker();

  // 3. Telemetry intake (LKV writes, watchdog, DB pipeline enqueue)
  const intake = new TelemetryIntake({
    lkv,
    tagMap,
    moduleTagIds,
    trendableTagIds,
    dbPipeline,
    watchdogTimeoutMs: config.watchdogTimeoutMs,
    dutyTracker,
  });
  intake.startWatchdog();

  // 4. HMI tag source (produces telemetry for module_type='HMI' tags)
  const hmiTags = HmiTagSource.create(rows, {
    intake,
    hmiPublishIntervalMs: config.hmiPublishIntervalMs,
    dutyTracker,
    onBeforePublish: () => {
      hmiTags.Telemetry_CPU = Math.round(intake.getDutyCycle() * 100) / 100;
    },
  });
  hmiTags.startPublishing();
  hmiTags.Module_Count = moduleTagIds.size;
  hmiTags.Tag_Count    = tagMap.size;
  const hmiTagCount = rows.filter(r => r.module_type === 'HMI').length;
  console.log(`[HMI] HMI tag source: ${hmiTagCount} tags, publishing every ${config.hmiPublishIntervalMs}ms`);

  // 5. MQTT bridge (transport only — delegates ingestion to TelemetryIntake)
  const mqttBridge = new MqttBridge({
    intake,
    moduleIds: [...moduleTagIds.keys()],
    config: {
      mqttUrl:             config.mqttUrl,
      heartbeatIntervalMs: config.heartbeatIntervalMs,
    },
    dutyTracker,
  });

  // 6. Express app + HTTP server
  const app = createApp(tagMap, intake);
  const httpServer = http.createServer(app);

  // 7. WS server
  const wsServer = new WsServer({ lkv, tickMs: config.wsTickMs, dutyTracker });
  wsServer.attach(httpServer);

  // 7b. DB pipeline flush timer (placeholder — just drains the queue)
  const dbFlushTimer = setInterval(() => dutyTracker.track(() => dbPipeline.flush()), config.dbTickMs);

  // 8. Start MQTT (soft-fail — broker may be absent in dev)
  try {
    await mqttBridge.start();
    console.log(`[HMI] MQTT bridge connected: ${config.mqttUrl}`);
  } catch (err) {
    console.warn('[HMI] MQTT broker unavailable:', (err as Error).message);
    console.warn('[HMI] Continuing — REST and WS will serve from LKV without live telemetry');
  }

  // 9. Start HTTP server
  await new Promise<void>(resolve => httpServer.listen(config.hmiPort, resolve));

  console.log(`[HMI] Server started on port ${config.hmiPort}`);
  console.log(`[HMI]   Tags: ${tagMap.size} | Modules: ${moduleTagIds.size}`);
  console.log(`[HMI]   WS tick: ${config.wsTickMs}ms | Watchdog: ${config.watchdogTimeoutMs}ms`);

  // 10. Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[HMI] ${signal} — shutting down`);
    clearInterval(dbFlushTimer);
    hmiTags.stopPublishing();
    intake.stopWatchdog();
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
