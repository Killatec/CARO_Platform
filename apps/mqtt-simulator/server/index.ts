import { ping, runMigrations } from '@caro/db';
import { createApp } from './app.js';
import { start as startSimulator, log } from './services/simulatorService.js';
import { loadEnv } from '@caro/server/env';

// App-local .env first, then the monorepo root .env filling in whatever is
// still unset (see @caro/server/env).
const envResult = loadEnv();

const PORT = process.env.PORT || 3002;

async function start(): Promise<void> {
  try {
    await ping();
    console.log(`[SIM] Connected to PostgreSQL`);
    console.log(
      `[env] app-local: ${envResult.appEnvLoaded ? 'loaded' : 'NOT FOUND'} (${envResult.appEnvPath}) | ` +
      `root: ${envResult.rootEnvPath === null ? 'workspace root not located' : `${envResult.rootEnvLoaded ? 'loaded' : 'NOT FOUND'} (${envResult.rootEnvPath})`}`,
    );
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
