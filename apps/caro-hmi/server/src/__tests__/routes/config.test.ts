import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { errorHandler } from '@caro/server';
import { createConfigRouter } from '../../routes/config.js';

// This suite mutates process.env.PROJECT_ROOT. Capture the ambient value up
// front (dotenv is NOT imported here — the route must not depend on a loaded
// .env) and restore it afterwards so no other suite inherits a mutation.
const ORIGINAL_PROJECT_ROOT = process.env.PROJECT_ROOT;

function buildApp() {
  const app = express();
  app.use('/api/v1/config', createConfigRouter());
  app.use(errorHandler as ErrorRequestHandler);
  return app;
}

function restore(value: string | undefined) {
  if (value === undefined) delete process.env.PROJECT_ROOT;
  else process.env.PROJECT_ROOT = value;
}

describe('GET /api/v1/config', () => {
  beforeEach(() => {
    delete process.env.PROJECT_ROOT;
  });

  afterAll(() => {
    restore(ORIGINAL_PROJECT_ROOT);
  });

  it('returns PROJECT_ROOT verbatim, including case', async () => {
    process.env.PROJECT_ROOT = 'Narya1';

    const res = await request(buildApp()).get('/api/v1/config');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: { projectRoot: 'Narya1' } });
  });

  it('trims surrounding whitespace', async () => {
    process.env.PROJECT_ROOT = '  Narya1  ';

    const res = await request(buildApp()).get('/api/v1/config');

    expect(res.body.data.projectRoot).toBe('Narya1');
  });

  it('returns null when PROJECT_ROOT is unset', async () => {
    const res = await request(buildApp()).get('/api/v1/config');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: { projectRoot: null } });
  });

  it('returns null when PROJECT_ROOT is empty or whitespace only', async () => {
    process.env.PROJECT_ROOT = '';
    expect((await request(buildApp()).get('/api/v1/config')).body.data.projectRoot).toBeNull();

    process.env.PROJECT_ROOT = '   ';
    expect((await request(buildApp()).get('/api/v1/config')).body.data.projectRoot).toBeNull();
  });

  // Load-bearing. The HMI's /config deliberately serves projectRoot ONLY —
  // no databaseName, no other env-derived field. Auth is stubbed, so this
  // endpoint is reachable by anything that can reach the port, and nothing in
  // the client needs infrastructure names. This assertion is what stops a
  // future edit from helpfully copying tag-registry's richer payload over.
  it('serves projectRoot and nothing else', async () => {
    process.env.PROJECT_ROOT = 'Narya1';

    const res = await request(buildApp()).get('/api/v1/config');

    expect(Object.keys(res.body.data)).toEqual(['projectRoot']);
    expect(Object.keys(res.body)).toEqual(['ok', 'data']);
  });
});
