import { Router } from 'express';
import { asyncWrap } from '@caro/server';
import type { ResetBus } from '../reset-bus.js';

export function createResetRouter(resetBus: ResetBus): Router {
  const router = Router();

  router.post('/', asyncWrap(async (_req, res) => {
    const resetNames = resetBus.resetAll();
    res.json({ ok: true, data: { reset: resetNames } });
  }));

  return router;
}
