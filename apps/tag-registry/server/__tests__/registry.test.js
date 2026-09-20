import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import http from 'node:http';

// Hoist mocks before any module resolution
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
import * as registryService from '../src/services/registryService.ts';
import * as templateService from '../src/services/templateService.ts';
import { ERROR_CODES } from '../../shared/index.js';

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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  delete process.env.PROJECT_ROOT;
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function get(path) {
  const res = await fetch(`${base}${path}`);
  return { status: res.status, body: await res.json() };
}

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

// ── GET /api/v1/registry ──────────────────────────────────────────────────────

describe('GET /api/v1/registry', () => {
  it('returns 200 with ok:true and tags array', async () => {
    registryService.getActiveRegistry.mockResolvedValue([]);
    const { status, body } = await get('/registry');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data.tags)).toBe(true);
  });

  it('returns empty tags array when database is empty', async () => {
    registryService.getActiveRegistry.mockResolvedValue([]);
    const { body } = await get('/registry');
    expect(body.data.tags).toHaveLength(0);
  });

  it('returns tags from getActiveRegistry', async () => {
    const tags = [
      { tag_id: 1001, tag_path: 'Plant1.Chan1.setpoint', data_type: 'f32', is_setpoint: true, trends: false, retired: false, meta: [] },
    ];
    registryService.getActiveRegistry.mockResolvedValue(tags);
    const { body } = await get('/registry');
    expect(body.data.tags).toEqual(tags);
  });
});

// ── POST /api/v1/registry/apply ───────────────────────────────────────────────

describe('POST /api/v1/registry/apply — validation', () => {
  it('returns 400 when rootName is missing', async () => {
    const { status, body } = await post('/registry/apply', { comment: 'test' });
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it('returns 400 when rootName is empty string', async () => {
    const { status } = await post('/registry/apply', { rootName: '', comment: 'test' });
    expect(status).toBe(400);
  });

  it('returns 400 when comment is missing', async () => {
    const { status, body } = await post('/registry/apply', { rootName: 'Plant1_System_A' });
    expect(status).toBe(400);
    expect(body.ok).toBe(false);
  });

  it('returns 400 when comment is empty string', async () => {
    const { status } = await post('/registry/apply', { rootName: 'Plant1_System_A', comment: '' });
    expect(status).toBe(400);
  });
});

describe('POST /api/v1/registry/apply — not found', () => {
  beforeEach(() => {
    // Not testing the PROJECT_ROOT gate here — allow any rootName through so
    // this test exercises the loadRoot-not-found branch in isolation.
    process.env.PROJECT_ROOT = '*';
  });

  it('returns 404 when root template does not exist', async () => {
    const err = new Error('Template not found');
    err.code = ERROR_CODES.TEMPLATE_NOT_FOUND;
    err.status = 404;
    templateService.loadRoot.mockRejectedValue(err);

    const { status, body } = await post('/registry/apply', {
      rootName: 'NonExistent', comment: 'test',
    });
    expect(status).toBe(404);
    expect(body.ok).toBe(false);
  });
});

describe('POST /api/v1/registry/apply — PROJECT_ROOT gate', () => {
  it('rejects with PROJECT_ROOT_MISMATCH when PROJECT_ROOT is unset', async () => {
    delete process.env.PROJECT_ROOT;

    const { status, body } = await post('/registry/apply', {
      rootName: 'Plant1_System_A', comment: 'test',
    });
    expect(status).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(ERROR_CODES.PROJECT_ROOT_MISMATCH);
    expect(templateService.loadRoot).not.toHaveBeenCalled();
  });

  it('rejects with PROJECT_ROOT_MISMATCH when PROJECT_ROOT is an empty string', async () => {
    process.env.PROJECT_ROOT = '';

    const { status, body } = await post('/registry/apply', {
      rootName: 'Plant1_System_A', comment: 'test',
    });
    expect(status).toBe(403);
    expect(body.error.code).toBe(ERROR_CODES.PROJECT_ROOT_MISMATCH);
  });

  it('rejects a rootName that does not match a configured PROJECT_ROOT', async () => {
    process.env.PROJECT_ROOT = 'Plant1_System_A';

    const { status, body } = await post('/registry/apply', {
      rootName: 'SomeOtherRoot', comment: 'test',
    });
    expect(status).toBe(403);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe(ERROR_CODES.PROJECT_ROOT_MISMATCH);
    expect(templateService.loadRoot).not.toHaveBeenCalled();
  });

  it('allows a rootName that matches PROJECT_ROOT exactly', async () => {
    process.env.PROJECT_ROOT = 'Plant1_System_A';
    templateService.loadRoot.mockResolvedValue({
      templates: { Plant1_System_A: { template: { template_type: 'module', template_name: 'Plant1_System_A', fields: {}, children: [] } } },
    });
    registryService.applyRegistry.mockResolvedValue({
      ok: true, registry_rev: 1, added: 1, modified: 0, retired: 0,
    });

    const { status, body } = await post('/registry/apply', {
      rootName: 'Plant1_System_A', comment: 'test',
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('allows any rootName when PROJECT_ROOT is "*"', async () => {
    process.env.PROJECT_ROOT = '*';
    templateService.loadRoot.mockResolvedValue({
      templates: { AnyRoot: { template: { template_type: 'module', template_name: 'AnyRoot', fields: {}, children: [] } } },
    });
    registryService.applyRegistry.mockResolvedValue({
      ok: true, registry_rev: 1, added: 1, modified: 0, retired: 0,
    });

    const { status, body } = await post('/registry/apply', {
      rootName: 'AnyRoot', comment: 'test',
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });
});

describe('POST /api/v1/registry/apply — success', () => {
  const rootTemplate = {
    template_type: 'module', template_name: 'Plant1_System_A',
    fields: {}, children: [],
  };

  beforeEach(() => {
    process.env.PROJECT_ROOT = 'Plant1_System_A';
    templateService.loadRoot.mockResolvedValue({
      templates: { Plant1_System_A: { template: rootTemplate } },
    });
  });

  it('returns 200 with registry_rev and counts on success', async () => {
    registryService.applyRegistry.mockResolvedValue({
      ok: true, registry_rev: 1, added: 7, modified: 0, retired: 0,
    });
    const { status, body } = await post('/registry/apply', {
      rootName: 'Plant1_System_A', comment: 'Initial apply',
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.registry_rev).toBe(1);
    expect(body.data.added).toBe(7);
  });

  it('returns 200 with message when no changes to apply', async () => {
    registryService.applyRegistry.mockResolvedValue({
      ok: true, registry_rev: null, message: 'No changes to apply',
    });
    const { status, body } = await post('/registry/apply', {
      rootName: 'Plant1_System_A', comment: 'No-op apply',
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.message).toBe('No changes to apply');
    expect(body.data.registry_rev).toBeNull();
  });
});

// ── GET /api/v1/registry/revisions ───────────────────────────────────────────

describe('GET /api/v1/registry/revisions', () => {
  it('returns 200 with ok:true and revisions array', async () => {
    registryService.getRevisions.mockResolvedValue([]);
    const { status, body } = await get('/registry/revisions');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data.revisions)).toBe(true);
  });

  it('returns empty array when no revisions exist', async () => {
    registryService.getRevisions.mockResolvedValue([]);
    const { body } = await get('/registry/revisions');
    expect(body.data.revisions).toHaveLength(0);
  });

  it('returns revisions from getRevisions', async () => {
    const revisions = [
      { registry_rev: 2, applied_by: 'dev', applied_at: '2026-03-23T14:07:00Z', comment: 'second' },
      { registry_rev: 1, applied_by: 'dev', applied_at: '2026-03-22T10:00:00Z', comment: 'first' },
    ];
    registryService.getRevisions.mockResolvedValue(revisions);
    const { body } = await get('/registry/revisions');
    expect(body.data.revisions).toEqual(revisions);
  });
});

// ── GET /api/v1/registry/revisions/:rev ──────────────────────────────────────

describe('GET /api/v1/registry/revisions/:rev', () => {
  it('returns 200 with tags for a valid revision', async () => {
    const tags = [
      { tag_id: 1001, registry_rev: 1, tag_path: 'Plant1.Chan1.setpoint', data_type: 'f32', is_setpoint: true, trends: false, retired: false, meta: [] },
    ];
    registryService.getRevisionTags.mockResolvedValue(tags);
    const { status, body } = await get('/registry/revisions/1');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.tags).toEqual(tags);
  });

  it('returns 404 when revision does not exist', async () => {
    registryService.getRevisionTags.mockResolvedValue(null);
    const { status, body } = await get('/registry/revisions/999');
    expect(status).toBe(404);
    expect(body.ok).toBe(false);
  });

  it('returns 400 for non-integer rev parameter', async () => {
    const { status } = await get('/registry/revisions/abc');
    expect(status).toBe(400);
  });

  it('passes the integer rev to getRevisionTags', async () => {
    const tags = [{ tag_id: 1001, registry_rev: 3, tag_path: 'A.B.C', data_type: 'f32', is_setpoint: false, trends: false, retired: false, meta: [] }];
    registryService.getRevisionTags.mockResolvedValue(tags);
    await get('/registry/revisions/3');
    expect(registryService.getRevisionTags).toHaveBeenCalledWith(3);
  });
});
