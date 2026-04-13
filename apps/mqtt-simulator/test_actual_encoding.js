import { loadProto, encodeProto } from './server/services/protobuf.js';

await loadProto();

// Test encoding like the simulator does
const tags = [
  { tag_id: 1001, data_type: 'f32', simValue: 50.5 },
  { tag_id: 1002, data_type: 'f32', simValue: 123.456 },
  { tag_id: 1003, data_type: 'bool', simValue: true }
];

const buf = encodeProto('test-module', tags, 'ONLINE');
console.log(`Encoded message size: ${buf.length} bytes`);
console.log(`Hex: ${buf.toString('hex')}`);
console.log(`\nBreakdown:`);
console.log(`  - timestamp (uint64): ~10 bytes`);
console.log(`  - status (string ONLINE): ~7 bytes`);
console.log(`  - tags: ${buf.length - 17} bytes (approx)`);

// The important part: each float tag should be either:
// - 9 bytes (1 field header + 8 for double)
// - 5 bytes (1 field header + 4 for float)
// Let's estimate: 3 tags, each ~9-10 bytes = 27-30 bytes for tags part
// Plus headers and timestamp/status overhead
