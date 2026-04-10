import dotenv from 'dotenv';
import { ping, runMigrations } from '@caro/db';
import { createApp } from './app.js';
import { start as startSimulator, log } from './services/simulatorService.js';

dotenv.config();

const PORT = process.env.PORT || 3002;

async function start(): Promise<void> {
  try {
    await ping();
    console.log(`[SIM] Connected to PostgreSQL`);
  } catch (err) {
    console.error('[SIM] Failed to connect to PostgreSQL:', (err as Error).message);
    process.exit(1);
  }

  try {
    await runMigrations();
  } catch (err) {
    console.error('[SIM] Startup aborted — migration failure:', (err as Error).message);
    process.exit(1);
  }

  const app = createApp();

  app.listen(PORT, () => {
    console.log(`[SIM] MQTT Simulator API listening on http://localhost:${PORT}`);
    console.log(`[SIM] MQTT broker: ${process.env.MQTT_BROKER_URL ?? 'mqtt://localhost:1883'}`);
    startSimulator(100).catch(err => log('ERROR', `[SIM] Auto-start failed: ${(err as Error).message}`));
  });
}

start().catch((err: unknown) => {
  console.error('[SIM] Startup error:', err);
  process.exit(1);
});
