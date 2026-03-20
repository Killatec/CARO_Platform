/**
 * One-off migration: convert flat fields { name: value } to
 * structured { name: { field_type, default } } shape.
 *
 * Usage:
 *   node apps/tag-registry/scripts/migrate_field_types.js [TEMPLATES_DIR]
 *
 * TEMPLATES_DIR defaults to ./apps/tag-registry/templates or $TEMPLATES_DIR env var.
 * Skips files whose fields are already in the new shape.
 * Only rewrites template.fields — child instance overrides are left as raw values.
 */

import { readdir, readFile, writeFile } from 'fs/promises';
import { join } from 'path';

const TEMPLATES_DIR =
  process.argv[2] ||
  process.env.TEMPLATES_DIR ||
  './apps/tag-registry/templates';

function inferFieldType(value) {
  if (typeof value === 'boolean') return 'Boolean';
  if (typeof value === 'number') return 'Numeric';
  // Numeric string? e.g. "50", "1.5"
  if (typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value))) return 'Numeric';
  return 'String';
}

function coerceDefault(value, fieldType) {
  if (fieldType === 'Numeric') return Number(value);
  if (fieldType === 'Boolean') return Boolean(value);
  return String(value);
}

async function migrateFile(filePath) {
  const content = await readFile(filePath, 'utf-8');
  const template = JSON.parse(content);

  if (!template.fields || typeof template.fields !== 'object' || Array.isArray(template.fields)) {
    return; // no fields to migrate
  }

  let changed = false;
  const newFields = {};

  for (const [fieldName, value] of Object.entries(template.fields)) {
    // Already in new shape — skip
    if (value !== null && typeof value === 'object' && 'field_type' in value && 'default' in value) {
      newFields[fieldName] = value;
      continue;
    }

    const fieldType = inferFieldType(value);
    const defaultValue = coerceDefault(value, fieldType);

    const wasNumericString = typeof value === 'string' && !isNaN(Number(value)) && value.trim() !== '';
    if (wasNumericString) {
      console.log(`  [ambiguous] ${fieldName}: "${value}" inferred as Numeric → ${defaultValue}`);
    }

    newFields[fieldName] = { field_type: fieldType, default: defaultValue };
    changed = true;
  }

  if (!changed) return;

  template.fields = newFields;
  await writeFile(filePath, JSON.stringify(template, null, 2) + '\n', 'utf-8');
  console.log(`Migrated: ${filePath}`);
}

async function scanDirectory(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await scanDirectory(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      await migrateFile(fullPath);
    }
  }
}

console.log(`Migrating templates in: ${TEMPLATES_DIR}`);
await scanDirectory(TEMPLATES_DIR);
console.log('Done.');
