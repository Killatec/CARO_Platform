import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';

// Required because createApp() registers all routers, including those that
// import these services. The config route itself touches no services.
vi.mock('../src/services/registryService.ts', () => ({
  getActiveRegistry: vi.fn(),
  applyRegistry:     vi.fn(),
  getRevisions:      vi.fn(),
  getRevisionTags:   vi.fn(),
}));

vi.mock('../src/services/templateService.ts', () => ({
  initializeIndex: vi.fn(),
  listTemplates:   vi.fn(),
  getTemplate:     vi.fn(),
  batchSave:       vi.fn(),
  loadRoot:        vi.fn(),
  validateAll:     vi.fn(),
  deleteTemplate:  vi.fn(),
}));

import { createApp } from '../src/app.ts';

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

// Save and restore env vars around every test so they don't bleed.
let savedRequired;
let savedUnique;
let savedDatabase;
let savedProjectRoot;

beforeEach(() => {
  savedRequired    = process.env.VALIDATE_REQUIRED_PARENT_TYPES;
  savedUnique      = process.env.VALIDATE_UNIQUE_PARENT_TYPES;
  savedDatabase    = process.env.POSTGRES_DATABASE;
  savedProjectRoot = process.env.PROJECT_ROOT;
  delete process.env.VALIDATE_REQUIRED_PARENT_TYPES;
  delete process.env.VALIDATE_UNIQUE_PARENT_TYPES;
  delete process.env.POSTGRES_DATABASE;
  delete process.env.PROJECT_ROOT;
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
  if (savedDatabase === undefined) {
    delete process.env.POSTGRES_DATABASE;
  } else {
    process.env.POSTGRES_DATABASE = savedDatabase;
  }
  if (savedProjectRoot === undefined) {
    delete process.env.PROJECT_ROOT;
  } else {
    process.env.PROJECT_ROOT = savedProjectRoot;
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

  it('returns [\'module\', \'system\'] for VALIDATE_REQUIRED_PARENT_TYPES=module,system', async () => {
    process.env.VALIDATE_REQUIRED_PARENT_TYPES = 'module,system';
    const { body } = await getConfig();
    expect(body.data.requiredParentTypes).toEqual(['module', 'system']);
  });

  it('trims whitespace around each value', async () => {
    process.env.VALIDATE_REQUIRED_PARENT_TYPES = ' module , system ';
    const { body } = await getConfig();
    expect(body.data.requiredParentTypes).toEqual(['module', 'system']);
  });

  it('filters empty strings from consecutive commas', async () => {
    process.env.VALIDATE_REQUIRED_PARENT_TYPES = 'module,,system';
    const { body } = await getConfig();
    expect(body.data.requiredParentTypes).toEqual(['module', 'system']);
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

describe('GET /api/v1/config — databaseName', () => {
  it('falls back to "caro_dev" when POSTGRES_DATABASE is unset', async () => {
    const { body } = await getConfig();
    expect(body.data.databaseName).toBe('caro_dev');
  });

  it('returns the configured POSTGRES_DATABASE', async () => {
    process.env.POSTGRES_DATABASE = 'caro_narya1';
    const { body } = await getConfig();
    expect(body.data.databaseName).toBe('caro_narya1');
  });
});

describe('GET /api/v1/config — projectRoot', () => {
  it('returns null when PROJECT_ROOT is unset', async () => {
    const { body } = await getConfig();
    expect(body.data.projectRoot).toBeNull();
  });

  it('returns null when PROJECT_ROOT is an empty string', async () => {
    process.env.PROJECT_ROOT = '';
    const { body } = await getConfig();
    expect(body.data.projectRoot).toBeNull();
  });

  it('returns the configured PROJECT_ROOT', async () => {
    process.env.PROJECT_ROOT = 'CARO_1';
    const { body } = await getConfig();
    expect(body.data.projectRoot).toBe('CARO_1');
  });

  it('returns "*" verbatim', async () => {
    process.env.PROJECT_ROOT = '*';
    const { body } = await getConfig();
    expect(body.data.projectRoot).toBe('*');
  });
});

describe('GET /api/v1/config — secrets', () => {
  it('never includes POSTGRES_PASSWORD in the response', async () => {
    process.env.POSTGRES_PASSWORD = 'super-secret-value';
    const { body } = await getConfig();
    expect(JSON.stringify(body)).not.toContain('super-secret-value');
    expect(body.data.POSTGRES_PASSWORD).toBeUndefined();
    delete process.env.POSTGRES_PASSWORD;
  });
});
