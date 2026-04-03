# MQTT Simulator — Session Anchor

At session start, read in order:
1. Docs/spec_delta.md
2. Docs/CARO_MQTT_Simulator_Bootstrap_v1_13.md
3. Docs/CARO_MQTT_Spec_v1_8.md

Broker: mqtt://localhost:1883 (TCP) | ws://localhost:8080 (WS) | anonymous | Mosquitto v5
Server: port 3002 | Client: port 5174

DB policy: ALL queries live in packages/db/. No raw SQL in app code. Import named functions only.
