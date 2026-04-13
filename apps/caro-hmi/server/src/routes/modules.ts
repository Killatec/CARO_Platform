import { Router } from 'express';
import { asyncWrap } from '@caro/server';
import type { TelemetryIntake } from '../telemetry-intake.js';

export function createModulesRouter(intake: TelemetryIntake): Router {
  const router = Router();

  router.get('/status', asyncWrap(async (_req, res) => {
    res.json({ ok: true, data: intake.getModuleStats() });
  }));

  return router;
}
