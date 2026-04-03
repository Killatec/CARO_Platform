import express from 'express';
import { asyncWrap } from '../middleware/asyncWrap.js';
import { start, stop, getStatus } from '../services/simulatorService.js';

const router = express.Router();

/**
 * POST /api/v1/simulator/start
 * Body (optional): { intervalMs: number }
 */
router.post('/start', asyncWrap(async (req, res) => {
  const status = getStatus();
  if (status.running) {
    return res.status(409).json({
      ok: false,
      error: { code: 'SIMULATOR_ALREADY_RUNNING', message: 'Simulator is already running.' },
    });
  }

  const { intervalMs } = req.body ?? {};
  if (intervalMs !== undefined) {
    if (typeof intervalMs !== 'number' || !Number.isInteger(intervalMs) || intervalMs < 50) {
      return res.status(400).json({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'intervalMs must be an integer >= 50.' },
      });
    }
  }

  await start(intervalMs);
  res.status(202).json({ ok: true, data: getStatus() });
}));

/**
 * POST /api/v1/simulator/stop
 */
router.post('/stop', asyncWrap(async (req, res) => {
  const status = getStatus();
  if (!status.running) {
    return res.status(409).json({
      ok: false,
      error: { code: 'SIMULATOR_NOT_RUNNING', message: 'Simulator is not running.' },
    });
  }

  stop();
  res.json({ ok: true, data: getStatus() });
}));

/**
 * GET /api/v1/simulator/status
 */
router.get('/status', asyncWrap(async (req, res) => {
  res.json({ ok: true, data: getStatus() });
}));

export default router;
