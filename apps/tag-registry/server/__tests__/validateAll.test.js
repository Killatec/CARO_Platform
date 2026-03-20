import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { initializeIndex, validateAll } from '../src/services/templateService.js';
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

const validTag = {
  template_type: 'tag', template_name: 'good_tag',
  data_type: 'f64', is_setpoint: false, fields: {}, children: [],
};

const validParam = {
  template_type: 'parameter', template_name: 'good_param', fields: {},
  children: [{ template_name: 'good_tag', asset_name: 'ch', fields: {} }],
};

let tmpDir;

beforeEach(async () => {
  tmpDir = await makeTmpDir();
  process.env.TEMPLATES_DIR = tmpDir;
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  delete process.env.TEMPLATES_DIR;
});

describe('validateAll', () => {
  it('empty index → { valid: true, errors: [], warnings: [] }', async () => {
    await initializeIndex();
    const result = await validateAll();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('all valid templates → valid: true', async () => {
    await writeTemplate(tmpDir, 'tags', validTag);
    await writeTemplate(tmpDir, 'parameters', validParam);
    await initializeIndex();

    const result = await validateAll();
    expect(result.valid).toBe(true);
  });

  it('template with INVALID_REFERENCE → valid: false, errors contains INVALID_REFERENCE', async () => {
    const badMod = {
      template_type: 'module', template_name: 'bad_mod', fields: {},
      children: [{ template_name: 'does_not_exist', asset_name: 'x', fields: {} }],
    };
    await writeTemplate(tmpDir, 'modules', badMod);
    await initializeIndex();

    const result = await validateAll();
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === ERROR_CODES.INVALID_REFERENCE)).toBe(true);
  });

  it('result has valid, errors, and warnings properties', async () => {
    await initializeIndex();
    const result = await validateAll();
    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('warnings');
  });
});
