import http from 'http';
import os from 'os';
import { ping, runMigrations, getActiveTags, pingTimescale, runTimescaleMigrations } from '@caro/db';
import { loadEnv } from '@caro/server/env';
import { config } from './config.js';
import { loadTagMap } from './tag-map.js';
import { LkvCache } from './lkv.js';
import { DbPipeline, NullDbWriter } from './db-pipeline.js';
import type { DbWriter } from './db-pipeline.js';
import { TimescaleDbWriter } from './timescale-writer.js';
import { TimescaleSizeMonitor } from './timescale-size-monitor.js';
import { TelemetryIntake } from './telemetry-intake.js';
import { HmiTagSource } from './hmi-tag-source.js';
import { MqttBridge } from './mqtt-bridge.js';
import { CmdController } from './cmd-controller.js';
import { ResetBus } from './reset-bus.js';
import { WsServer } from './ws-server.js';
import { createApp } from './app.js';
import { DutyTracker } from './duty-tracker.js';
import { TrendSnapshotScheduler } from './trend-snapshot-scheduler.js';
import { HistorianReconnector } from './historian-reconnect.js';

/** Non-internal IPv4 addresses across all network interfaces, e.g. for logging reachable URLs at startup. */
function getLocalIPs(): string[] {
  const addrs: string[] = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const net of iface ?? []) {
      if (net.family === 'IPv4' && !net.internal) addrs.push(net.address);
    }
  }
  return addrs.length > 0 ? addrs : ['localhost'];
}

async function start(): Promise<void> {
  // -1. Load env: app-local .env first, then the monorepo root .env filling in
  // whatever is still unset (see @caro/server/env). Called explicitly here
  // rather than as an import side effect — note this runs after this file's
  // own top-level imports (including ./config.js) have already been
  // evaluated. ./config.js protects its own module-scope env reads with its
  // own `import 'dotenv/config'` (app-local only); nothing else in this app
  // reads process.env at module scope (see the env-consolidation summary).
  const envResult = loadEnv();

  // 0. Verify DB connectivity and run migrations
  try {
    await ping();
    console.log(`[HMI] Connected to PostgreSQL`);
    console.log(
      `[env] app-local: ${envResult.appEnvLoaded ? 'loaded' : 'NOT FOUND'} (${envResult.appEnvPath}) | ` +
      `root: ${envResult.rootEnvPath === null ? 'workspace root not located' : `${envResult.rootEnvLoaded ? 'loaded' : 'NOT FOUND'} (${envResult.rootEnvPath})`}`,
    );
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
  if (rows.length === 0) {
    console.warn('[HMI] tag_registry returned no active tags — apply a registry revision first.');
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

  // Build module → trendable-tag-IDs index for WS trend-delta emission
  const trendableTagsByModule = new Map<string, Set<number>>();
  for (const [tagId, tagDef] of tagMap) {
    if (trendableTagIds.has(tagId)) {
      let set = trendableTagsByModule.get(tagDef.module_id);
      if (!set) {
        set = new Set();
        trendableTagsByModule.set(tagDef.module_id, set);
      }
      set.add(tagId);
    }
  }

  // 2. Core data structures
  const lkv = new LkvCache();
  const dutyTracker = new DutyTracker();

  // 2b. Timescale historian writer (soft-fail — HMI stays up without historian)
  let dbWriter: DbWriter = new NullDbWriter();
  let sizeMonitor: TimescaleSizeMonitor | undefined;
  try {
    await pingTimescale();
    console.log('[hmi] timescale reachable');
    try {
      await runTimescaleMigrations();
      dbWriter = new TimescaleDbWriter();
      sizeMonitor = new TimescaleSizeMonitor();
      sizeMonitor.start();
      console.log(`[TimescaleSizeMonitor] started: pollMs=${sizeMonitor.pollMs}`);
    } catch (err) {
      console.error('[hmi] timescale migration failed, falling back to null writer:', (err as Error).message);
    }
  } catch (err) {
    console.warn(`[hmi] timescale unreachable, starting with null historian writer; reason=${(err as Error).message}`);
  }
  const dbPipeline = new DbPipeline(dbWriter);

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
    dbPipeline,
    sizeMonitor,
    onBeforePublish: () => {
      hmiTags.Telemetry_CPU = Math.round(intake.getDutyCycle() * 100) / 100;
    },
  });
  hmiTags.startPublishing();
  hmiTags.Module_Info_Module_Count = moduleTagIds.size;
  hmiTags.Tag_Count    = tagMap.size;
  const hmiTagCount = rows.filter(r => r.module_type === 'HMI').length;
  console.log(`[HMI] HMI tag source: ${hmiTagCount} tags, publishing every ${config.hmiPublishIntervalMs}ms`);

  // 4b. Retry the historian connection in the background if it wasn't ready at startup.
  const historianReconnect = new HistorianReconnector(dbPipeline, hmiTags, config.timescaleReconnectMs);
  if (dbWriter.name === 'null') {
    historianReconnect.start();
  }

  // 5. MQTT bridge (transport only — scoped to MQTT modules, delegates ingestion to TelemetryIntake)
  const mqttModuleIds = [...new Set(
    [...tagMap.values()]
      .filter(t => t.module_type === 'MQTT')
      .map(t => t.module_id),
  )];

  const mqttBridge = new MqttBridge({
    intake,
    moduleIds: mqttModuleIds,
    config: {
      mqttUrl:             config.mqttUrl,
      heartbeatIntervalMs: config.heartbeatIntervalMs,
    },
    dutyTracker,
  });

  // 5b. Command controller (routes writes by module_type: MQTT→broker, HMI→HmiTagSource)
  const cmdController = new CmdController({ mqttBridge, hmiTagSource: hmiTags, tagMap });

  // 5c. Reset bus (fans out reset signal to registered subsystems)
  const resetBus = new ResetBus();
  resetBus.register('watchdog', () => intake.resetAllWatchdogs());
  resetBus.register('module-reset', () => cmdController.sendResetAll());

  // 6. Express app + HTTP server
  const app = createApp(tagMap, cmdController, resetBus, trendableTagIds, dbPipeline);
  const httpServer = http.createServer(app);

  // 7. WS server
  const wsServer = new WsServer({
    lkv,
    tickMs: config.wsTickMs,
    dutyTracker,
    trendableTagsByModule,
    trendableTagIds,
    trendFlushHz: config.trendFlushHz,
  });
  wsServer.attach(httpServer);
  intake.setTrendDeltaListener((moduleTs, moduleId) => wsServer.handleTrendDelta(moduleTs, moduleId));
  intake.setModuleRecoveredHandler((moduleId) => {
    cmdController.requestSnapshot(moduleId);
    cmdController.restorePendingSetpoints(moduleId).catch(err =>
      console.error(`[HMI] setpoint restore failed on reconnect for ${moduleId}:`, (err as Error).message),
    );
  });

  // 7b. Start the async DB pipeline flush tick
  dbPipeline.start();

  // 7c. Trend snapshot scheduler (ensures every trendable tag has ≥1 DB row per minute)
  const trendSnapshotScheduler = new TrendSnapshotScheduler(
    intake,
    moduleTagIds,
    dutyTracker,
    config.trendSnapshotIntervalMs,
  );
  if (config.trendSnapshotEnabled) {
    trendSnapshotScheduler.start();
  }

  // 8. Start MQTT (soft-fail — broker may be absent in dev)
  try {
    await mqttBridge.start();
    console.log(`[HMI] MQTT bridge connected: ${config.mqttUrl}`);

    // Restore last-known setpoints to all MQTT modules on startup so devices
    // recover their commanded values after an HMI server restart.
    for (const moduleId of mqttModuleIds) {
      cmdController.restorePendingSetpoints(moduleId).catch(err =>
        console.error(`[HMI] setpoint restore failed on startup for ${moduleId}:`, (err as Error).message),
      );
    }
  } catch (err) {
    console.warn('[HMI] MQTT broker unavailable:', (err as Error).message);
    console.warn('[HMI] Continuing — REST and WS will serve from LKV without live telemetry');
  }

  // 9. Start HTTP server
  await new Promise<void>(resolve => httpServer.listen(config.hmiPort, resolve));

  console.log(`[HMI] Server started on port ${config.hmiPort}`);
  for (const addr of getLocalIPs()) {
    console.log(`[HMI]   http://${addr}:${config.hmiPort}`);
  }
  console.log(`[HMI]   Tags: ${tagMap.size} | Modules: ${moduleTagIds.size}`);
  console.log(`[HMI]   WS tick: ${config.wsTickMs}ms | Watchdog: ${config.watchdogTimeoutMs}ms`);

  // 10. Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[HMI] ${signal} — shutting down`);
    hmiTags.stopPublishing();
    intake.stopWatchdog();
    trendSnapshotScheduler.stop();
    historianReconnect.stop();
    if (sizeMonitor) await sizeMonitor.stop();
    await dbPipeline.stop();
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
