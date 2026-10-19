import { describe, it, expect } from 'vitest';
import request from 'supertest';
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import { errorHandler } from '@caro/server';
import { createHandshakeRouter } from '../../routes/handshake.js';
import type { HandshakeDetails } from '../../handshake-controller.js';

const RF1: HandshakeDetails = { module_id: 'RF1', status: 4, request: null, tag_list: null, confirm: null, push: null };

function buildApp() {
  const app = express();
  app.use('/api/v1/handshake', createHandshakeRouter({
    getDetails: (moduleId: string) => (moduleId === 'RF1' ? RF1 : null),
  }));
  app.use(errorHandler as ErrorRequestHandler);
  return app;
}

describe('GET /api/v1/handshake/:moduleId', () => {
  it('returns the module details in the envelope', async () => {
    const res = await request(buildApp()).get('/api/v1/handshake/RF1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, data: RF1 });
  });

  it('MODULE_NOT_FOUND (404) for a module that is not an MQTT module', async () => {
    const res = await request(buildApp()).get('/api/v1/handshake/HMI');
    expect(res.status).toBe(404);
    expect(res.body.ok).toBe(false);
    expect(res.body.error.code).toBe('MODULE_NOT_FOUND');
  });
});
