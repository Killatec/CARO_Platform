import { Router } from 'express';
import { asyncWrap } from '@caro/server';
import type { CaroError } from '@caro/server';
import type { CmdController } from '../cmd-controller.js';

export function createCommandsRouter(cmdController: CmdController): Router {
  const router = Router();

  router.post('/', asyncWrap(async (req, res) => {
    const body = req.body as { module_id?: unknown; cmd_str?: unknown };

    if (typeof body.module_id !== 'string' || !body.module_id.trim()) {
      const err = new Error('module_id must be a non-empty string') as CaroError;
      err.status = 400; err.code = 'VALIDATION_ERROR';
      throw err;
    }
    if (typeof body.cmd_str !== 'string' || !body.cmd_str.trim()) {
      const err = new Error('cmd_str must be a non-empty string') as CaroError;
      err.status = 400; err.code = 'VALIDATION_ERROR';
      throw err;
    }

    const { module_id, cmd_str } = body as { module_id: string; cmd_str: string };

    // TODO: domain validation — authorization, allowed command strings, rate limits, etc.

    await cmdController.sendCommand(module_id, cmd_str);
    res.json({ ok: true, data: { module_id, cmd_str } });
  }));

  return router;
}
