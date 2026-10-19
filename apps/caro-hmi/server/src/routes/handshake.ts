import { Router } from 'express';
import { asyncWrap } from '@caro/server';
import type { CaroError } from '@caro/server';
import type { HandshakeController } from '../handshake-controller.js';

/**
 * GET /api/v1/handshake/:moduleId
 *
 * The module's last handshake as the backend saw it (request identity, TAG_LIST,
 * CONFIRM, Set push). In memory only, so it starts empty after a backend restart.
 */
export function createHandshakeRouter(handshakeController: Pick<HandshakeController, 'getDetails'>): Router {
  const router = Router();

  router.get('/:moduleId', asyncWrap(async (req, res) => {
    const moduleId = req.params.moduleId as string;
    const details = handshakeController.getDetails(moduleId);
    if (details === null) {
      const err = new Error(`'${moduleId}' is not an MQTT module in the registry`) as CaroError;
      err.status = 404; err.code = 'MODULE_NOT_FOUND';
      throw err;
    }
    res.json({ ok: true, data: details });
  }));

  return router;
}
