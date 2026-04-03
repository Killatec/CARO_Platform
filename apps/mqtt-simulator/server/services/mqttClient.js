import mqtt from 'mqtt';

// Spec: CARO_MQTT_Spec v1.8 §2.1
// cleanSession=true, no retained messages, anonymous (dev)
const BROKER_URL = process.env.MQTT_BROKER_URL ?? 'mqtt://localhost:1883';
const CLIENT_ID  = process.env.MQTT_CLIENT_ID  ?? 'caro-simulator';

let client = null;

export function connect() {
  if (client) return client;

  client = mqtt.connect(BROKER_URL, {
    clientId:     CLIENT_ID,
    clean:        true,   // cleanSession=true per spec §2.1
    reconnectPeriod: 2000,
  });

  client.on('connect', () => {
    console.log(`[MQTT] Connected to ${BROKER_URL} (clientId: ${CLIENT_ID})`);
  });

  client.on('disconnect', () => {
    console.log('[MQTT] Disconnected from broker.');
  });

  client.on('reconnect', () => {
    console.log('[MQTT] Reconnecting…');
  });

  client.on('error', (err) => {
    console.error('[MQTT] Error:', err.message);
  });

  client.on('close', () => {
    console.log('[MQTT] Connection closed.');
  });

  return client;
}

export function disconnect() {
  if (!client) return;
  client.end(false, {}, () => {
    console.log('[MQTT] Disconnected (graceful).');
    client = null;
  });
}

export function getClient() {
  return client;
}
