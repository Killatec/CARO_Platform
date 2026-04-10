import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { initializeIndex, listTemplates, getTemplate } from '../src/services/templateService.ts';
import { ERROR_CODES } from '../../shared/index.js';

async function makeTmpDir() {
  return mkdtemp(join(tmpdir(), 'caro-test-'));
}

async function writeTemplate(dir, subdir, template) {
  const fullDir = join(dir, subdir);
  await mkdir(fullDir, { recursive: true });
  await writeFile(
    join(fullDir, `${template.template_name}.json`),
    JSON.stringify(template, null, 2) + '\n',
    'utf-8'
  );
}

const tagA = {
  template_type: 'tag', template_name: 'tag_a',
  fields: {
    data_type: { field_type: 'TagType', default: 'f32' },
    is_setpoint: { field_type: 'Boolean', default: false },
  },
  children: [],
};
const tagB = {
  template_type: 'tag', template_name: 'tag_b',
  fields: {
    data_type: { field_type: 'TagType', default: 'i32' },
    is_setpoint: { field_type: 'Boolean', default: true },
  },
  children: [],
};
const param = {
  template_type: 'parameter', template_name: 'param_x',
  fields: {}, children: [],
};

let tmpDir;

beforeEach(async () => {
  tmpDir = await makeTmpDir();
  process.env.TEMPLATES_DIR = tmpDir;
  await writeTemplate(tmpDir, 'tags', tagA);
  await writeTemplate(tmpDir, 'tags', tagB);
  await writeTemplate(tmpDir, 'parameters', param);
  await initializeIndex();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  delete process.env.TEMPLATES_DIR;
});

// ── listTemplates ─────────────────────────────────────────────────────────────

describe('listTemplates', () => {
  it('returns all templates when no type filter is applied', async () => {
    const list = await listTemplates();
    expect(list).toHaveLength(3);
  });

  it('filters by template_type correctly', async () => {
    const tags = await listTemplates('tag');
    expect(tags).toHaveLength(2);
    tags.forEach(t => expect(t.template_type).toBe('tag'));
  });

  it('returns empty array for an unknown type', async () => {
    const results = await listTemplates('nonexistent');
    expect(results).toHaveLength(0);
  });

  it('each entry has template_name, template_type, file_path', async () => {
    const list = await listTemplates();
    for (const entry of list) {
      expect(entry).toHaveProperty('template_name');
      expect(entry).toHaveProperty('template_type');
      expect(entry).toHaveProperty('file_path');
    }
  });
});

// ── getTemplate ───────────────────────────────────────────────────────────────

describe('getTemplate', () => {
  it('returns { template, hash } for a known template', async () => {
    const result = await getTemplate('tag_a');
    expect(result).toHaveProperty('template');
    expect(result).toHaveProperty('hash');
    expect(result.template.template_name).toBe('tag_a');
  });

  it('hash is a non-empty string', async () => {
    const result = await getTemplate('tag_a');
    expect(typeof result.hash).toBe('string');
    expect(result.hash.length).toBeGreaterThan(0);
  });

  it('throws TEMPLATE_NOT_FOUND for an unknown name', async () => {
    try {
      await getTemplate('does_not_exist');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.code).toBe(ERROR_CODES.TEMPLATE_NOT_FOUND);
    }
  });
});