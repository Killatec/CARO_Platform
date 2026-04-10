import protobufjs from 'protobufjs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const protoPath = resolve(__dirname, '../../../../packages/proto/tag.proto');

export interface ProtoTag {
  tag_id: number;
  data_type: string;
  simValue: number | boolean | string;
}

let TelemetryMessage: protobufjs.Type | null = null;

export async function loadProto(): Promise<void> {
  const root = await protobufjs.load(protoPath);
  TelemetryMessage = root.lookupType('TelemetryMessage');
}

export function encodeProto(moduleId: string, tags: ProtoTag[], status: string): Buffer {
  if (!TelemetryMessage) throw new Error('Proto not loaded');
  const payload = {
    timestamp: Date.now(),
    status,
    tags: tags.map(t => {
      const value: Record<string, unknown> = {};
      if (t.data_type === 'f32')  value.float_value  = t.simValue;
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
