import dotenv from 'dotenv';
import { createApp } from './app.js';
import { start, log } from './services/simulatorService.js';

dotenv.config();

const PORT = process.env.PORT || 3002;

const app = createApp();

app.listen(PORT, () => {
  console.log(`[SIM] MQTT Simulator API listening on http://localhost:${PORT}`);
  console.log(`[SIM] MQTT broker: ${process.env.MQTT_BROKER_URL ?? 'mqtt://localhost:1883'}`);
  start(100).catch(err => log('ERROR', `[SIM] Auto-start failed: ${err.message}`));
});
