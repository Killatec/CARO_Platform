import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@caro/db', () => ({
  getTagTypes: vi.fn().mockResolvedValue([
    { id: 1, type_name: 'f32',  display_name: 'Float 32' },
    { id: 5, type_name: 'bool', display_name: 'Boolean' },
  ]),
  getModuleTypes: vi.fn().mockResolvedValue([
    { id: 1, type_name: 'HMI',  display_name: 'HMI' },
    { id: 2, type_name: 'MQTT', display_name: 'MQTT' },
  ]),
}));
import { mkdtemp, writeFile, mkdir, rm, readFile, access } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { initializeIndex, getTemplate, batchSave } from '../src/services/templateService.ts';
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

async function fileExists(p) {
  try { await access(p); return true; } catch { return false; }
}

const baseTag = {
  template_type: 'tag', template_name: 'tag_a',
  fields: {
    data_type: { field_type: 'TagType', default: 'f32' },
    is_setpoint: { field_type: 'Boolean', default: false },
  },
  children: [],
};

let tmpDir;

beforeEach(async () => {
  tmpDir = await makeTmpDir();
  process.env.TEMPLATES_DIR = tmpDir;
  await writeTemplate(tmpDir, 'tags', baseTag);
  await initializeIndex();
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  delete process.env.TEMPLATES_DIR;
});

// ── No-op ─────────────────────────────────────────────────────────────────────

describe('batchSave — no-op', () => {
  it('empty changes and deletions → { requires_confirmation: false, modified_files: [], deleted_files: [] }', async () => {
    const result = await batchSave([], []);
    expect(result).toEqual({
      requires_confirmation: false,
      modified_files: [],
      deleted_files: [],
    });
  });
});

// ── Hash checking ─────────────────────────────────────────────────────────────

describe('batchSave — hash checking', () => {
  it('STALE_TEMPLATE when original_hash does not match', async () => {
    const { hash } = await getTemplate('tag_a');
    const staleHash = hash.replace(/.$/, 'x'); // mutate last char

    try {
      await batchSave([{ template_name: 'tag_a', original_hash: staleHash, template: baseTag }]);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.code).toBe(ERROR_CODES.STALE_TEMPLATE);
    }
  });

  it('TEMPLATE_NOT_FOUND when updating a non-existent template with non-null hash', async () => {
    try {
      await batchSave([{ template_name: 'ghost', original_hash: 'abc123', template: baseTag }]);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.code).toBe(ERROR_CODES.TEMPLATE_NOT_FOUND);
    }
  });

  it('TEMPLATE_NAME_CONFLICT when original_hash is null but template already exists', async () => {
    try {
      await batchSave([{ template_name: 'tag_a', original_hash: null, template: baseTag }]);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.code).toBe(ERROR_CODES.TEMPLATE_NAME_CONFLICT);
    }
  });
});

// ── New template ──────────────────────────────────────────────────────────────

describe('batchSave — new template (original_hash: null)', () => {
  it('creates file in tags/ for a new tag template', async () => {
    const newTag = {
      template_type: 'tag', template_name: 'brand_new',
      fields: {
        data_type: { field_type: 'TagType', default: 'bool' },
        is_setpoint: { field_type: 'Boolean', default: false },
      },
      children: [],
    };
    const result = await batchSave([{ template_name: 'brand_new', original_hash: null, template: newTag }]);
    expect(result.requires_confirmation).toBe(false);

    const expectedPath = join(tmpDir, 'tags', 'brand_new.json');
    expect(await fileExists(expectedPath)).toBe(true);
  });

  it('creates file in parameters/ for a new parameter template', async () => {
    await mkdir(join(tmpDir, 'parameters'), { recursive: true });
    const newParam = {
      template_type: 'parameter', template_name: 'new_param', fields: {}, children: [],
    };
    await batchSave([{ template_name: 'new_param', original_hash: null, template: newParam }]);

    const expectedPath = join(tmpDir, 'parameters', 'new_param.json');
    expect(await fileExists(expectedPath)).toBe(true);
  });

  it('creates file in modules/ for a new module template', async () => {
    await mkdir(join(tmpDir, 'modules'), { recursive: true });
    const newMod = {
      template_type: 'module', template_name: 'new_mod', fields: {}, children: [],
    };
    await batchSave([{ template_name: 'new_mod', original_hash: null, template: newMod }]);

    const expectedPath = join(tmpDir, 'modules', 'new_mod.json');
    expect(await fileExists(expectedPath)).toBe(true);
  });
});

// ── ModuleType field validation ──────────────────────────────────────────────

describe('batchSave — ModuleType field validation', () => {
  it('module template with valid ModuleType default "HMI" → saves successfully', async () => {
    await mkdir(join(tmpDir, 'modules'), { recursive: true });
    const newMod = {
      template_type: 'module', template_name: 'mod_hmi',
      fields: { Module_Type: { field_type: 'ModuleType', default: 'HMI' } },
      children: [],
    };
    const result = await batchSave([{ template_name: 'mod_hmi', original_hash: null, template: newMod }]);
    expect(result.requires_confirmation).toBe(false);
    expect(result.modified_files.length).toBeGreaterThan(0);
  });

  it('module template with valid ModuleType default "MQTT" → saves successfully', async () => {
    await mkdir(join(tmpDir, 'modules'), { recursive: true });
    const newMod = {
      template_type: 'module', template_name: 'mod_mqtt',
      fields: { Module_Type: { field_type: 'ModuleType', default: 'MQTT' } },
      children: [],
    };
    const result = await batchSave([{ template_name: 'mod_mqtt', original_hash: null, template: newMod }]);
    expect(result.requires_confirmation).toBe(false);
  });

  it('module template with invalid ModuleType default → throws SCHEMA_VALIDATION_ERROR', async () => {
    await mkdir(join(tmpDir, 'modules'), { recursive: true });
    const newMod = {
      template_type: 'module', template_name: 'mod_bad',
      fields: { Module_Type: { field_type: 'ModuleType', default: 'INVALID_TYPE' } },
      children: [],
    };
    try {
      await batchSave([{ template_name: 'mod_bad', original_hash: null, template: newMod }]);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.code).toBe(ERROR_CODES.SCHEMA_VALIDATION_ERROR);
      expect(err.message).toContain('ModuleType');
      expect(err.message).toContain('INVALID_TYPE');
    }
  });

  it('tag template with invalid TagType default still rejected (regression)', async () => {
    const newTag = {
      template_type: 'tag', template_name: 'tag_bad',
      fields: {
        data_type: { field_type: 'TagType', default: 'not_a_real_type' },
        is_setpoint: { field_type: 'Boolean', default: false },
      },
      children: [],
    };
    try {
      await batchSave([{ template_name: 'tag_bad', original_hash: null, template: newTag }]);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.code).toBe(ERROR_CODES.SCHEMA_VALIDATION_ERROR);
      expect(err.message).toContain('TagType');
    }
  });

  it('batch with both valid TagType and valid ModuleType → saves both', async () => {
    await mkdir(join(tmpDir, 'modules'), { recursive: true });
    const newTag = {
      template_type: 'tag', template_name: 'tag_ok',
      fields: {
        data_type: { field_type: 'TagType', default: 'f32' },
        is_setpoint: { field_type: 'Boolean', default: false },
      },
      children: [],
    };
    const newMod = {
      template_type: 'module', template_name: 'mod_ok',
      fields: { Module_Type: { field_type: 'ModuleType', default: 'MQTT' } },
      children: [],
    };
    const result = await batchSave([
      { template_name: 'tag_ok', original_hash: null, template: newTag },
      { template_name: 'mod_ok', original_hash: null, template: newMod },
    ]);
    expect(result.requires_confirmation).toBe(false);
    expect(result.modified_files.length).toBe(2);
  });

  it('batch with valid TagType but invalid ModuleType → entire batch rejected', async () => {
    await mkdir(join(tmpDir, 'modules'), { recursive: true });
    const newTag = {
      template_type: 'tag', template_name: 'tag_fine',
      fields: {
        data_type: { field_type: 'TagType', default: 'f32' },
        is_setpoint: { field_type: 'Boolean', default: false },
      },
      children: [],
    };
    const newMod = {
      template_type: 'module', template_name: 'mod_bad2',
      fields: { Module_Type: { field_type: 'ModuleType', default: 'BOGUS' } },
      children: [],
    };
    try {
      await batchSave([
        { template_name: 'tag_fine', original_hash: null, template: newTag },
        { template_name: 'mod_bad2', original_hash: null, template: newMod },
      ]);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.code).toBe(ERROR_CODES.SCHEMA_VALIDATION_ERROR);
      expect(err.message).toContain('BOGUS');
    }
  });
});

// ── Update existing ───────────────────────────────────────────────────────────

describe('batchSave — update existing', () => {
  it('writes updated content to disk', async () => {
    const { hash } = await getTemplate('tag_a');
    const updated = { ...baseTag, fields: { ...baseTag.fields, data_type: { field_type: 'TagType', default: 'bool' } } };

    await batchSave([{ template_name: 'tag_a', original_hash: hash, template: updated }]);

    const onDisk = JSON.parse(
      await readFile(join(tmpDir, 'tags', 'tag_a.json'), 'utf-8')
    );
    expect(onDisk.fields.data_type.default).toBe('bool');
  });

  it('returns modified_files list', async () => {
    const { hash } = await getTemplate('tag_a');
    const updated = { ...baseTag, fields: { ...baseTag.fields, data_type: { field_type: 'TagType', default: 'bool' } } };

    const result = await batchSave([{ template_name: 'tag_a', original_hash: hash, template: updated }]);
    expect(result.modified_files.length).toBeGreaterThan(0);
  });

  it('updates the in-memory index so subsequent getTemplate returns new hash', async () => {
    const { hash: h1 } = await getTemplate('tag_a');
    const updated = { ...baseTag, fields: { ...baseTag.fields, data_type: { field_type: 'TagType', default: 'bool' } } };
    await batchSave([{ template_name: 'tag_a', original_hash: h1, template: updated }]);

    const { hash: h2, template } = await getTemplate('tag_a');
    expect(h2).not.toBe(h1);
    expect(template.fields.data_type.default).toBe('bool');
  });
});

// ── Deletion ──────────────────────────────────────────────────────────────────

describe('batchSave — deletion', () => {
  it('deletes the file from disk', async () => {
    const { hash } = await getTemplate('tag_a');
    await batchSave([], [{ template_name: 'tag_a', original_hash: hash }]);

    const expectedPath = join(tmpDir, 'tags', 'tag_a.json');
    expect(await fileExists(expectedPath)).toBe(false);
  });

  it('returns deleted_files list', async () => {
    const { hash } = await getTemplate('tag_a');
    const result = await batchSave([], [{ template_name: 'tag_a', original_hash: hash }]);
    expect(result.deleted_files.length).toBe(1);
  });

  it('STALE_TEMPLATE when deletion hash does not match', async () => {
    try {
      await batchSave([], [{ template_name: 'tag_a', original_hash: 'wrong' }]);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.code).toBe(ERROR_CODES.STALE_TEMPLATE);
    }
  });

  it('TEMPLATE_NOT_FOUND when deleting a non-existent template', async () => {
    try {
      await batchSave([], [{ template_name: 'ghost', original_hash: 'abc' }]);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.code).toBe(ERROR_CODES.TEMPLATE_NOT_FOUND);
    }
  });
});

// ── Graph validation ──────────────────────────────────────────────────────────

describe('batchSave — graph validation', () => {
  it('GRAPH VALIDATION — INVALID_REFERENCE rejected: throws VALIDATION_ERROR (code) with INVALID_REFERENCE in details', async () => {
    // tag_a exists. Create a module that references 'ghost' (does not exist).
    // batchSave should call validateGraph on the proposed state and fail.
    const badMod = {
      template_type: 'module', template_name: 'bad_mod', fields: {},
      children: [{ template_name: 'ghost', asset_name: 'g', fields: {} }],
    };

    try {
      await batchSave([{ template_name: 'bad_mod', original_hash: null, template: badMod }]);
      expect.fail('should have thrown');
    } catch (err) {
      // The service throws VALIDATION_ERROR (not INVALID_REFERENCE directly).
      // INVALID_REFERENCE is reported inside err.details.
      expect(err.code).toBe(ERROR_CODES.VALIDATION_ERROR);
      const detailCodes = err.details.map(d => d.code);
      expect(detailCodes.some(c => c === ERROR_CODES.INVALID_REFERENCE)).toBe(true);
    }
  });
});