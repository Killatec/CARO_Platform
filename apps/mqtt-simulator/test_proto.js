import protobufjs from 'protobufjs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const protoPath = resolve(__dirname, '../../packages/proto/tag.proto');

// Load the actual proto file
const root = await protobufjs.load(protoPath);
const TagValue = root.lookupType('TagValue');

// Test various float values
console.log('Double encoding verification (protobuf field type 1 = 64-bit fixed):');
const test_values = [50.5, 123.456, 1.0, 0.5];

for (const val of test_values) {
  const tv = TagValue.create({ floatValue: val });
  const encoded = TagValue.encode(tv).finish();
  console.log(`Value: ${val.toString().padEnd(10)} Bytes: ${encoded.length} Hex: ${encoded.toString('hex')}`);
}

// Check wireType in protobuf definition
console.log('\nWire type for floatValue field:');
const field = TagValue.fields.floatValue;
console.log(`  Field name: ${field.name}, Type: ${field.type}`);

// In protobuf:
// - float is wire type 5 (32-bit fixed) = 4 bytes
// - double is wire type 1 (64-bit fixed) = 8 bytes
// So if we see 9 byte encoded messages (1 byte header + 8 bytes value), it's using double
// If we see 5 byte encoded messages (1 byte header + 4 bytes value), it's using float
