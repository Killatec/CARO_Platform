import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { initializeIndex, listTemplates, getTemplate } from '../src/services/templateService.js';

async function makeTmpDir() {
  return mkdtemp(join(tmpdir(), 'caro-test-'));
}

async function writeTemplate(dir, subdir, template) {
  const fullDir = join(dir, subdir);
  await mkdir(fullDir, { recursive: true });
  const filePath = join(fullDir, `${template.template_name}.json`);
  await writeFile(filePath, JSON.stringify(template, null, 2) + '\n', 'utf-8');
}

const tagTemplate = {
  template_type: 'tag',
  template_name: 'my_tag',
  data_type: 'f64',
  is_setpoint: false,
  fields: {},
  children: [],
};

const paramTemplate = {
  template_type: 'parameter',
  template_name: 'my_param',
  fields: {},
  children: [],
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

describe('initializeIndex', () => {
  it('loads a single template from the tags/ subdir', async () => {
    await writeTemplate(tmpDir, 'tags', tagTemplate);
    await initializeIndex();

    const list = await listTemplates();
    expect(list).toHaveLength(1);
    expect(list[0].template_name).toBe('my_tag');
  });

  it('loads templates from multiple subdirectories', async () => {
    await writeTemplate(tmpDir, 'tags', tagTemplate);
    await writeTemplate(tmpDir, 'parameters', paramTemplate);
    await initializeIndex();

    const list = await listTemplates();
    expect(list).toHaveLength(2);
  });

  it('ignores non-JSON files', async () => {
    await mkdir(join(tmpDir, 'tags'), { recursive: true });
    await writeFile(join(tmpDir, 'tags', 'readme.txt'), 'ignore me', 'utf-8');
    await initializeIndex();

    const list = await listTemplates();
    expect(list).toHaveLength(0);
  });

  it('ignores JSON files without template_name', async () => {
    await mkdir(join(tmpDir, 'tags'), { recursive: true });
    await writeFile(
      join(tmpDir, 'tags', 'noname.json'),
      JSON.stringify({ some: 'data' }),
      'utf-8'
    );
    await initializeIndex();

    const list = await listTemplates();
    expect(list).toHaveLength(0);
  });

  it('resets the index on each call', async () => {
    await writeTemplate(tmpDir, 'tags', tagTemplate);
    await initializeIndex();
    expect((await listTemplates()).length).toBe(1);

    // Remove the file and re-init — index should now be empty
    await rm(join(tmpDir, 'tags', 'my_tag.json'));
    await initializeIndex();
    expect((await listTemplates()).length).toBe(0);
  });

  it('throws when TEMPLATES_DIR is not set', async () => {
    delete process.env.TEMPLATES_DIR;
    await expect(initializeIndex()).rejects.toThrow('TEMPLATES_DIR environment variable is not set');
  });

  it('handles a missing TEMPLATES_DIR path gracefully (ENOENT → no templates)', async () => {
    process.env.TEMPLATES_DIR = join(tmpDir, 'does_not_exist');
    await initializeIndex();
    const list = await listTemplates();
    expect(list).toHaveLength(0);
  });
});
