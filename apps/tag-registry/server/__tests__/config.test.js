import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';

// Required because createApp() registers all routers, including those that
// import these services. The config route itself touches no services.
vi.mock('../src/services/registryService.js', () => ({
  getActiveRegistry: vi.fn(),
  applyRegistry:     vi.fn(),
  getRevisions:      vi.fn(),
  getRevisionTags:   vi.fn(),
}));

vi.mock('../src/services/templateService.js', () => ({
  initializeIndex: vi.fn(),
  listTemplates:   vi.fn(),
  getTemplate:     vi.fn(),
  batchSave:       vi.fn(),
  loadRoot:        vi.fn(),
  validateAll:     vi.fn(),
  deleteTemplate:  vi.fn(),
}));

import { createApp } from '../src/app.js';

// ── HTTP server lifecycle ─────────────────────────────────────────────────────

let server;
let base;

beforeAll(async () => {
  const app = createApp();
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  base = `http://127.0.0.1:${port}/api/v1`;
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

// Save and restore the two env vars around every test so they don't bleed.
let savedRequired;
let savedUnique;

beforeEach(() => {
  savedRequired = process.env.VALIDATE_REQUIRED_PARENT_TYPES;
  savedUnique   = process.env.VALIDATE_UNIQUE_PARENT_TYPES;
  delete process.env.VALIDATE_REQUIRED_PARENT_TYPES;
  delete process.env.VALIDATE_UNIQUE_PARENT_TYPES;
});

afterEach(() => {
  if (savedRequired === undefined) {
    delete process.env.VALIDATE_REQUIRED_PARENT_TYPES;
  } else {
    process.env.VALIDATE_REQUIRED_PARENT_TYPES = savedRequired;
  }
  if (savedUnique === undefined) {
    delete process.env.VALIDATE_UNIQUE_PARENT_TYPES;
  } else {
    process.env.VALIDATE_UNIQUE_PARENT_TYPES = savedUnique;
  }
});

// ── Helper ────────────────────────────────────────────────────────────────────

async function getConfig() {
  const res = await fetch(`${base}/config`);
  return { status: res.status, body: await res.json() };
}

// ── GET /api/v1/config ────────────────────────────────────────────────────────

describe('GET /api/v1/config — requiredParentTypes', () => {
  it('returns [] when VALIDATE_REQUIRED_PARENT_TYPES is unset', async () => {
    const { status, body } = await getConfig();
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.requiredParentTypes).toEqual([]);
  });

  it('returns [\'module\'] for VALIDATE_REQUIRED_PARENT_TYPES=module', async () => {
    process.env.VALIDATE_REQUIRED_PARENT_TYPES = 'module';
    const { body } = await getConfig();
    expect(body.data.requiredParentTypes).toEqual(['module']);
  });

  it('returns [\'module\', \'parameter\'] for VALIDATE_REQUIRED_PARENT_TYPES=module,parameter', async () => {
    process.env.VALIDATE_REQUIRED_PARENT_TYPES = 'module,parameter';
    const { body } = await getConfig();
    expect(body.data.requiredParentTypes).toEqual(['module', 'parameter']);
  });

  it('trims whitespace around each value', async () => {
    process.env.VALIDATE_REQUIRED_PARENT_TYPES = ' module , parameter ';
    const { body } = await getConfig();
    expect(body.data.requiredParentTypes).toEqual(['module', 'parameter']);
  });

  it('filters empty strings from consecutive commas', async () => {
    process.env.VALIDATE_REQUIRED_PARENT_TYPES = 'module,,parameter';
    const { body } = await getConfig();
    expect(body.data.requiredParentTypes).toEqual(['module', 'parameter']);
  });

  it('filters trailing comma', async () => {
    process.env.VALIDATE_REQUIRED_PARENT_TYPES = 'module,';
    const { body } = await getConfig();
    expect(body.data.requiredParentTypes).toEqual(['module']);
  });
});

describe('GET /api/v1/config — uniqueParentTypes', () => {
  it('returns false when VALIDATE_UNIQUE_PARENT_TYPES is unset', async () => {
    const { body } = await getConfig();
    expect(body.data.uniqueParentTypes).toBe(false);
  });

  it('returns true for VALIDATE_UNIQUE_PARENT_TYPES=true', async () => {
    process.env.VALIDATE_UNIQUE_PARENT_TYPES = 'true';
    const { body } = await getConfig();
    expect(body.data.uniqueParentTypes).toBe(true);
  });

  it('returns true for VALIDATE_UNIQUE_PARENT_TYPES=TRUE (uppercase)', async () => {
    process.env.VALIDATE_UNIQUE_PARENT_TYPES = 'TRUE';
    const { body } = await getConfig();
    expect(body.data.uniqueParentTypes).toBe(true);
  });

  it('returns false for VALIDATE_UNIQUE_PARENT_TYPES=false', async () => {
    process.env.VALIDATE_UNIQUE_PARENT_TYPES = 'false';
    const { body } = await getConfig();
    expect(body.data.uniqueParentTypes).toBe(false);
  });

  it('returns false for VALIDATE_UNIQUE_PARENT_TYPES= (empty string)', async () => {
    process.env.VALIDATE_UNIQUE_PARENT_TYPES = '';
    const { body } = await getConfig();
    expect(body.data.uniqueParentTypes).toBe(false);
  });
});
