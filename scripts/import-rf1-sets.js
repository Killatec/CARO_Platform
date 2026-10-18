/**
 * One-off import of RF_Control's legacy setpoint file into commanded_setpoints
 * (migration D11: each Set's current value is imported once from RF1_Sets.json).
 *
 * Usage (from the repo root, against the database named in the root .env):
 *   node scripts/import-rf1-sets.js --sets <path/to/RF1_Sets.json> [--map scripts/data/rf1-sets-map.json] [--apply]
 *
 * Without --apply it is a dry run: it prints what would change and writes nothing.
 * Any unmapped tag, missing key or type mismatch aborts before anything is written.
 * Rows are written with ack_status 'accepted' and set_by 'import:<file name>'.
 * pending_setpoint_values is not touched — nothing was ACKed.
 *
 * Requires the built packages (npm run dev:fresh, or build @caro/db,
 * @caro/server and @caro/tag-registry-shared).
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { loadEnv } from '@caro/server/env';
import { getActiveTags, getCommandedSetpointsByTagIds, upsertCommandedSetpoints, pool } from '@caro/db';
import { moduleRelativeTagName } from '@caro/tag-registry-shared';

function parseArgs(argv) {
  const args = { map: 'scripts/data/rf1-sets-map.json', apply: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sets') args.sets = argv[++i];
    else if (argv[i] === '--map') args.map = argv[++i];
    else if (argv[i] === '--apply') args.apply = true;
    else throw new Error(`unknown argument: ${argv[i]}`);
  }
  if (!args.sets) throw new Error('--sets <path/to/RF1_Sets.json> is required');
  return args;
}

/** Flattens nested objects to dot-joined keys: { Mag_1_Fwd: { Gain } } → 'Mag_1_Fwd.Gain'. */
function leaves(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) leaves(v, key, out);
    else out.set(key, v);
  }
  return out;
}

function typeProblem(value, dataType) {
  if (dataType === 'bool') return typeof value === 'boolean' ? null : 'not a boolean';
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'not a finite number';
  if (dataType === 'i16' || dataType === 'i32') {
    if (!Number.isInteger(value)) return 'not an integer';
    const [min, max] = dataType === 'i16' ? [-32768, 32767] : [-2147483648, 2147483647];
    if (value < min || value > max) return `outside ${dataType}`;
    return null;
  }
  if (dataType === 'f32') return null;
  return `unsupported data_type ${dataType}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnv();

  const file = leaves(JSON.parse(readFileSync(args.sets, 'utf8')));
  const { module_id: moduleId, map } = JSON.parse(readFileSync(args.map, 'utf8'));
  const setBy = `import:${basename(args.sets)}`;

  const registrySets = new Map();
  for (const row of await getActiveTags()) {
    if (row.module !== moduleId || !row.is_setpoint) continue;
    registrySets.set(moduleRelativeTagName(row.meta), { tag_id: row.tag_id, data_type: row.data_type });
  }
  if (registrySets.size === 0) throw new Error(`no active Set tags for module ${moduleId} in the registry`);

  const errors = [];
  const entries = [];
  for (const [key, { tag_name: tagName }] of Object.entries(map)) {
    if (!file.has(key)) { errors.push(`${key}: not in ${basename(args.sets)}`); continue; }
    const tag = registrySets.get(tagName);
    if (!tag) { errors.push(`${key} → ${tagName}: no such ${moduleId} Set in the registry`); continue; }
    const value = file.get(key);
    const problem = typeProblem(value, tag.data_type);
    if (problem) { errors.push(`${key} → ${tagName} (${tag.data_type}): ${JSON.stringify(value)} is ${problem}`); continue; }
    entries.push({ key, tagName, tag_id: tag.tag_id, value });
  }
  if (errors.length > 0) {
    console.error(`Aborted — nothing written. ${errors.length} problem(s):\n  ${errors.join('\n  ')}`);
    process.exitCode = 1;
    return;
  }

  const current = new Map((await getCommandedSetpointsByTagIds(entries.map(e => e.tag_id))).map(r => [r.tag_id, r]));
  const changes = [];
  for (const e of entries.sort((a, b) => a.tag_id - b.tag_id)) {
    const row = current.get(e.tag_id);
    if (!row) changes.push(`  + ${e.tag_id} ${e.tagName} = ${JSON.stringify(e.value)}`);
    else if (row.value !== e.value || row.ack_status !== 'accepted' || row.set_by !== setBy) {
      changes.push(`  ~ ${e.tag_id} ${e.tagName}: ${JSON.stringify(row.value)} (${row.ack_status}) → ${JSON.stringify(e.value)}`);
    }
  }
  const mappedNames = new Set(entries.map(e => e.tagName));
  const unpopulated = [...registrySets.keys()].filter(n => !mappedNames.has(n)).sort();
  const unmappedKeys = [...file.keys()].filter(k => !(k in map));

  console.log(`${moduleId}: ${entries.length} of ${registrySets.size} Sets from ${args.sets} (set_by '${setBy}')`);
  console.log(`${changes.length} row(s) to write:\n${changes.join('\n') || '  (none — the store already matches)'}`);
  console.log(`${unpopulated.length} Set(s) with no value in the file stay unpopulated: ${unpopulated.join(', ')}`);
  console.log(`${unmappedKeys.length} file key(s) not imported (no mapped tag): ${unmappedKeys.join(', ')}`);

  if (!args.apply) {
    console.log('\nDry run — nothing written. Re-run with --apply to write.');
    return;
  }

  await upsertCommandedSetpoints(entries.map(e => ({ tag_id: e.tag_id, value: e.value, ack_status: 'accepted', set_by: setBy })));
  const written = await getCommandedSetpointsByTagIds(entries.map(e => e.tag_id));
  const ok = entries.every(e => {
    const r = written.find(w => w.tag_id === e.tag_id);
    return r && r.value === e.value && r.ack_status === 'accepted' && r.set_by === setBy;
  });
  if (!ok) {
    console.error('Applied, but the read-back does not match — check commanded_setpoints.');
    process.exitCode = 1;
    return;
  }
  console.log(`\nApplied and verified: ${entries.length} row(s) in commanded_setpoints.`);
}

main()
  .catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
