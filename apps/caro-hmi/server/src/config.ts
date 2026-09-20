import { loadEnv } from '@caro/server/env';

// Module-scope singleton, so its own env load must run before the object
// literal below does. Only imported by index.ts (nothing else in this app,
// no test, reaches this file), and index.ts's own loadEnv() call inside
// start() runs after this module has already evaluated — so this call is
// load-bearing, not redundant, and makes root .env visible here too (this
// file previously only ever saw app-local values via its own bare
// `import 'dotenv/config'`). dotenv.config() is idempotent, so index.ts's
// later loadEnv() call is a harmless no-op for anything already set here.
loadEnv();

export const config = {
  hmiPort: parseInt(process.env.HMI_PORT ?? '3003', 10),
  mqttUrl: process.env.MQTT_URL ?? 'mqtt://localhost:1883',
  wsTickMs: parseInt(process.env.WS_TICK_MS ?? '125', 10),
  dbTickMs: parseInt(process.env.TIMESCALE_DB_TICK_MS ?? '100', 10),
  timescaleReconnectMs: parseInt(process.env.TIMESCALE_RECONNECT_MS ?? '30000', 10),
  watchdogTimeoutMs:     parseInt(process.env.WATCHDOG_TIMEOUT_MS      ?? '1000', 10),
  heartbeatIntervalMs:   parseInt(process.env.HEARTBEAT_INTERVAL_MS    ?? '1000', 10),
  hmiPublishIntervalMs:      parseInt(process.env.HMI_PUBLISH_INTERVAL_MS      ?? '250',   10),
  trendSnapshotEnabled:      (process.env.TREND_SNAPSHOT_ENABLED ?? 'true') !== 'false',
  trendSnapshotIntervalMs:   parseInt(process.env.TREND_SNAPSHOT_INTERVAL_MS   ?? '60000', 10),
  trendFlushHz: (() => {
    const v = parseInt(process.env.TREND_FLUSH_HZ ?? '4', 10);
    if (!Number.isInteger(v) || v < 1 || v > 20) throw new Error(`TREND_FLUSH_HZ must be an integer 1..20, got '${process.env.TREND_FLUSH_HZ}'`);
    return v;
  })(),
} as const;
