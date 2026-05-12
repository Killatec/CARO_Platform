import 'dotenv/config';

export const config = {
  hmiPort: parseInt(process.env.HMI_PORT ?? '3003', 10),
  mqttUrl: process.env.MQTT_URL ?? 'mqtt://localhost:1883',
  wsTickMs: parseInt(process.env.WS_TICK_MS ?? '125', 10),
  dbTickMs: parseInt(process.env.TIMESCALE_DB_TICK_MS ?? '100', 10),
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
