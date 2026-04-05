import protobufjs from 'protobufjs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const protoPath = path.resolve(__dirname, '../../../../packages/proto/tag.proto');

let TelemetryMessage;

export async function loadProto() {
  const root = await protobufjs.load(protoPath);
  TelemetryMessage = root.lookupType('TelemetryMessage');
}

export function encodeProto(moduleId, tags, status) {
  if (!TelemetryMessage) throw new Error('Proto not loaded');
  const payload = {
    timestamp: Date.now(),
    status,
    tags: tags.map(t => {
      const value = {};
      if (t.data_type === 'f64')  value.float_value  = t.simValue;
      if (t.data_type === 'i32')  value.int_value    = t.simValue;
      if (t.data_type === 'bool') value.bool_value   = t.simValue;
      if (t.data_type === 'str')  value.string_value = t.simValue;
      return { tag_id: t.tag_id, value };
    }),
  };
  const err = TelemetryMessage.verify(payload);
  if (err) throw new Error(`Proto verify failed: ${err}`);
  return Buffer.from(TelemetryMessage.encode(TelemetryMessage.create(payload)).finish());
}
