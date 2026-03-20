import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, mkdir, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { initializeIndex, loadRoot } from '../src/services/templateService.js';
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

const tag = {
  template_type: 'tag', template_name: 'T',
  data_type: 'f64', is_setpoint: false, fields: {}, children: [],
};
const param = {
  template_type: 'parameter', template_name: 'P', fields: {},
  children: [{ template_name: 'T', asset_name: 'ch', fields: {} }],
};
const module_ = {
  template_type: 'module', template_name: 'M', fields: {},
  children: [{ template_name: 'P', asset_name: 'sub', fields: {} }],
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

describe('loadRoot — not found', () => {
  it('throws TEMPLATE_NOT_FOUND for unknown root', async () => {
    await initializeIndex();
    try {
      await loadRoot('missing');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err.code).toBe(ERROR_CODES.TEMPLATE_NOT_FOUND);
    }
  });
});

describe('loadRoot — single node', () => {
  it('returns just the root template when it has no children', async () => {
    await writeTemplate(tmpDir, 'tags', tag);
    await initializeIndex();

    const result = await loadRoot('T');
    expect(result.root_template_name).toBe('T');
    expect(Object.keys(result.templates)).toEqual(['T']);
  });
});

describe('loadRoot — full graph', () => {
  beforeEach(async () => {
    await writeTemplate(tmpDir, 'tags', tag);
    await writeTemplate(tmpDir, 'parameters', param);
    await writeTemplate(tmpDir, 'modules', module_);
    await initializeIndex();
  });

  it('returns root_template_name', async () => {
    const result = await loadRoot('M');
    expect(result.root_template_name).toBe('M');
  });

  it('includes the root template in templates', async () => {
    const result = await loadRoot('M');
    expect(result.templates).toHaveProperty('M');
  });

  it('includes all reachable templates', async () => {
    const result = await loadRoot('M');
    expect(Object.keys(result.templates).sort()).toEqual(['M', 'P', 'T']);
  });

  it('each entry has { template, hash }', async () => {
    const result = await loadRoot('M');
    for (const entry of Object.values(result.templates)) {
      expect(entry).toHaveProperty('template');
      expect(entry).toHaveProperty('hash');
    }
  });

  it('loadRoot from leaf T only returns T', async () => {
    const result = await loadRoot('T');
    expect(Object.keys(result.templates)).toEqual(['T']);
  });
});

describe('loadRoot — cycle safety', () => {
  it('does not infinite-loop on a circular reference', async () => {
    // A → B → A (circular). loadRoot should terminate.
    const A = {
      template_type: 'module', template_name: 'A', fields: {},
      children: [{ template_name: 'B', asset_name: 'b', fields: {} }],
    };
    const B = {
      template_type: 'module', template_name: 'B', fields: {},
      children: [{ template_name: 'A', asset_name: 'a', fields: {} }],
    };
    await writeTemplate(tmpDir, 'modules', A);
    await writeTemplate(tmpDir, 'modules', B);
    await initializeIndex();

    // Should resolve without hanging
    const result = await loadRoot('A');
    expect(Object.keys(result.templates).sort()).toEqual(['A', 'B']);
  });
});

describe('loadRoot — dangling reference', () => {
  it('silently skips children that are not in the index', async () => {
    const ghost = {
      template_type: 'module', template_name: 'Ghost', fields: {},
      children: [{ template_name: 'does_not_exist', asset_name: 'x', fields: {} }],
    };
    await writeTemplate(tmpDir, 'modules', ghost);
    await initializeIndex();

    const result = await loadRoot('Ghost');
    expect(Object.keys(result.templates)).toEqual(['Ghost']);
  });
});
