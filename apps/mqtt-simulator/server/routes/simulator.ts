import express, { Request, Response } from 'express';
import { asyncWrap } from '@caro/server/asyncWrap';
import { start, stop, getStatus, getLogs, isKnownModule, activateModule, deactivateModule, activateDeltaMode, deactivateDeltaMode, activateProtobuf, deactivateProtobuf, activateAcceptSets, deactivateAcceptSets, activateSkipAck, deactivateSkipAck, activateFault, deactivateFault, publishSnapshot, injectSetValues } from '../services/simulatorService.js';

const router = express.Router();

/**
 * POST /api/v1/simulator/start
 * Body (optional): { intervalMs: number }
 */
router.post('/start', asyncWrap(async (req: Request, res: Response) => {
  const status = getStatus();
  if (status.running) {
    res.status(409).json({
      ok: false,
      error: { code: 'SIMULATOR_ALREADY_RUNNING', message: 'Simulator is already running.' },
    });
    return;
  }

  const { intervalMs } = req.body ?? {};
  if (intervalMs !== undefined) {
    if (typeof intervalMs !== 'number' || !Number.isInteger(intervalMs) || intervalMs < 50) {
      res.status(400).json({
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'intervalMs must be an integer >= 50.' },
      });
      return;
    }
  }

  await start(intervalMs);
  res.status(202).json({ ok: true, data: getStatus() });
}));

/**
 * POST /api/v1/simulator/stop
 */
router.post('/stop', asyncWrap(async (req: Request, res: Response) => {
  const status = getStatus();
  if (!status.running) {
    res.status(409).json({
      ok: false,
      error: { code: 'SIMULATOR_NOT_RUNNING', message: 'Simulator is not running.' },
    });
    return;
  }

  stop();
  res.json({ ok: true, data: getStatus() });
}));

/**
 * GET /api/v1/simulator/status
 */
router.get('/status', asyncWrap(async (req: Request, res: Response) => {
  res.json({ ok: true, data: getStatus() });
}));

/**
 * GET /api/v1/simulator/logs
 */
router.get('/logs', asyncWrap(async (req: Request, res: Response) => {
  res.json({ ok: true, data: getLogs() });
}));

/**
 * POST /api/v1/simulator/telemetry/stop/:module_id
 * Removes module from active transmission.
 */
router.post('/telemetry/stop/:module_id', asyncWrap(async (req: Request, res: Response) => {
  if (!getStatus().running) {
    res.status(409).json({
      ok: false,
      error: { code: 'SIMULATOR_NOT_RUNNING', message: 'Simulator is not running.' },
    });
    return;
  }
  const module_id = req.params['module_id'] as string;
  if (!isKnownModule(module_id)) {
    res.status(404).json({
      ok: false,
      error: { code: 'MODULE_NOT_FOUND', message: `Module ${module_id} not found.` },
    });
    return;
  }
  deactivateModule(module_id);
  res.json({ ok: true });
}));

/**
 * POST /api/v1/simulator/telemetry/start/:module_id
 * Adds module back to active transmission.
 */
router.post('/telemetry/start/:module_id', asyncWrap(async (req: Request, res: Response) => {
  if (!getStatus().running) {
    res.status(409).json({
      ok: false,
      error: { code: 'SIMULATOR_NOT_RUNNING', message: 'Simulator is not running.' },
    });
    return;
  }
  const module_id = req.params['module_id'] as string;
  if (!isKnownModule(module_id)) {
    res.status(404).json({
      ok: false,
      error: { code: 'MODULE_NOT_FOUND', message: `Module ${module_id} not found.` },
    });
    return;
  }
  activateModule(module_id);
  res.json({ ok: true });
}));

/**
 * POST /api/v1/simulator/delta/enable/:module_id
 * Switches module to delta (publish-only-changed) mode.
 */
router.post('/delta/enable/:module_id', asyncWrap(async (req: Request, res: Response) => {
  if (!getStatus().running) {
    res.status(409).json({
      ok: false,
      error: { code: 'SIMULATOR_NOT_RUNNING', message: 'Simulator is not running.' },
    });
    return;
  }
  const module_id = req.params['module_id'] as string;
  if (!isKnownModule(module_id)) {
    res.status(404).json({
      ok: false,
      error: { code: 'MODULE_NOT_FOUND', message: `Module ${module_id} not found.` },
    });
    return;
  }
  activateDeltaMode(module_id);
  res.json({ ok: true });
}));

/**
 * POST /api/v1/simulator/delta/disable/:module_id
 * Switches module back to full publish mode.
 */
router.post('/delta/disable/:module_id', asyncWrap(async (req: Request, res: Response) => {
  if (!getStatus().running) {
    res.status(409).json({
      ok: false,
      error: { code: 'SIMULATOR_NOT_RUNNING', message: 'Simulator is not running.' },
    });
    return;
  }
  const module_id = req.params['module_id'] as string;
  if (!isKnownModule(module_id)) {
    res.status(404).json({
      ok: false,
      error: { code: 'MODULE_NOT_FOUND', message: `Module ${module_id} not found.` },
    });
    return;
  }
  deactivateDeltaMode(module_id);
  res.json({ ok: true });
}));

/**
 * POST /api/v1/simulator/protobuf/enable/:module_id
 * Switches module to Protobuf encoding.
 */
router.post('/protobuf/enable/:module_id', asyncWrap(async (req: Request, res: Response) => {
  if (!getStatus().running) {
    res.status(409).json({
      ok: false,
      error: { code: 'SIMULATOR_NOT_RUNNING', message: 'Simulator is not running.' },
    });
    return;
  }
  const module_id = req.params['module_id'] as string;
  if (!isKnownModule(module_id)) {
    res.status(404).json({
      ok: false,
      error: { code: 'MODULE_NOT_FOUND', message: `Module ${module_id} not found.` },
    });
    return;
  }
  activateProtobuf(module_id);
  res.json({ ok: true });
}));

/**
 * POST /api/v1/simulator/protobuf/disable/:module_id
 * Switches module back to JSON encoding.
 */
router.post('/protobuf/disable/:module_id', asyncWrap(async (req: Request, res: Response) => {
  if (!getStatus().running) {
    res.status(409).json({
      ok: false,
      error: { code: 'SIMULATOR_NOT_RUNNING', message: 'Simulator is not running.' },
    });
    return;
  }
  const module_id = req.params['module_id'] as string;
  if (!isKnownModule(module_id)) {
    res.status(404).json({
      ok: false,
      error: { code: 'MODULE_NOT_FOUND', message: `Module ${module_id} not found.` },
    });
    return;
  }
  deactivateProtobuf(module_id);
  res.json({ ok: true });
}));

/**
 * POST /api/v1/simulator/accept-sets/:module_id/activate
 * Enables acceptance of SET_VALUES commands for the module (default state).
 */
router.post('/accept-sets/:module_id/activate', asyncWrap(async (req: Request, res: Response) => {
  if (!getStatus().running) {
    res.status(409).json({
      ok: false,
      error: { code: 'SIMULATOR_NOT_RUNNING', message: 'Simulator is not running.' },
    });
    return;
  }
  const module_id = req.params['module_id'] as string;
  if (!isKnownModule(module_id)) {
    res.status(404).json({
      ok: false,
      error: { code: 'MODULE_NOT_FOUND', message: `Module ${module_id} not found.` },
    });
    return;
  }
  activateAcceptSets(module_id);
  res.json({ ok: true });
}));

/**
 * POST /api/v1/simulator/accept-sets/:module_id/deactivate
 * Disables acceptance of SET_VALUES commands — all writes rejected with MODULE_FAULT.
 */
router.post('/accept-sets/:module_id/deactivate', asyncWrap(async (req: Request, res: Response) => {
  if (!getStatus().running) {
    res.status(409).json({
      ok: false,
      error: { code: 'SIMULATOR_NOT_RUNNING', message: 'Simulator is not running.' },
    });
    return;
  }
  const module_id = req.params['module_id'] as string;
  if (!isKnownModule(module_id)) {
    res.status(404).json({
      ok: false,
      error: { code: 'MODULE_NOT_FOUND', message: `Module ${module_id} not found.` },
    });
    return;
  }
  deactivateAcceptSets(module_id);
  res.json({ ok: true });
}));

/**
 * POST /api/v1/simulator/skip-ack/:module_id/activate
 * Enables skip-ack for the module — all commands are silently dropped, no CMD_ACK published.
 */
router.post('/skip-ack/:module_id/activate', asyncWrap(async (req: Request, res: Response) => {
  if (!getStatus().running) {
    res.status(409).json({
      ok: false,
      error: { code: 'SIMULATOR_NOT_RUNNING', message: 'Simulator is not running.' },
    });
    return;
  }
  const module_id = req.params['module_id'] as string;
  if (!isKnownModule(module_id)) {
    res.status(404).json({
      ok: false,
      error: { code: 'MODULE_NOT_FOUND', message: `Module ${module_id} not found.` },
    });
    return;
  }
  activateSkipAck(module_id);
  res.json({ ok: true });
}));

/**
 * POST /api/v1/simulator/skip-ack/:module_id/deactivate
 * Disables skip-ack — CMD_ACK is published normally.
 */
router.post('/skip-ack/:module_id/deactivate', asyncWrap(async (req: Request, res: Response) => {
  if (!getStatus().running) {
    res.status(409).json({
      ok: false,
      error: { code: 'SIMULATOR_NOT_RUNNING', message: 'Simulator is not running.' },
    });
    return;
  }
  const module_id = req.params['module_id'] as string;
  if (!isKnownModule(module_id)) {
    res.status(404).json({
      ok: false,
      error: { code: 'MODULE_NOT_FOUND', message: `Module ${module_id} not found.` },
    });
    return;
  }
  deactivateSkipAck(module_id);
  res.json({ ok: true });
}));

/**
 * POST /api/v1/simulator/fault/enable/:module_id
 * Puts module into FAULT mode — telemetry publishes status: 'FAULT'.
 */
router.post('/fault/enable/:module_id', asyncWrap(async (req: Request, res: Response) => {
  if (!getStatus().running) {
    res.status(409).json({
      ok: false,
      error: { code: 'SIMULATOR_NOT_RUNNING', message: 'Simulator is not running.' },
    });
    return;
  }
  const module_id = req.params['module_id'] as string;
  if (!isKnownModule(module_id)) {
    res.status(404).json({
      ok: false,
      error: { code: 'MODULE_NOT_FOUND', message: `Module ${module_id} not found.` },
    });
    return;
  }
  activateFault(module_id);
  res.json({ ok: true });
}));

/**
 * POST /api/v1/simulator/fault/disable/:module_id
 * Clears FAULT mode — telemetry reverts to status: 'ONLINE'.
 */
router.post('/fault/disable/:module_id', asyncWrap(async (req: Request, res: Response) => {
  if (!getStatus().running) {
    res.status(409).json({
      ok: false,
      error: { code: 'SIMULATOR_NOT_RUNNING', message: 'Simulator is not running.' },
    });
    return;
  }
  const module_id = req.params['module_id'] as string;
  if (!isKnownModule(module_id)) {
    res.status(404).json({
      ok: false,
      error: { code: 'MODULE_NOT_FOUND', message: `Module ${module_id} not found.` },
    });
    return;
  }
  deactivateFault(module_id);
  res.json({ ok: true });
}));

/**
 * POST /api/v1/simulator/snapshot/:module_id
 * Forces a full telemetry publish for the module (bypasses delta mode).
 */
router.post('/snapshot/:module_id', asyncWrap(async (req: Request, res: Response) => {
  if (!getStatus().running) {
    res.status(409).json({
      ok: false,
      error: { code: 'SIMULATOR_NOT_RUNNING', message: 'Simulator is not running.' },
    });
    return;
  }
  const module_id = req.params['module_id'] as string;
  if (!isKnownModule(module_id)) {
    res.status(404).json({
      ok: false,
      error: { code: 'MODULE_NOT_FOUND', message: `Module ${module_id} not found.` },
    });
    return;
  }
  publishSnapshot(module_id);
  res.json({ ok: true });
}));

/**
 * POST /api/v1/simulator/inject/:module_id
 * Publishes a SET_VALUES command with random setpoint values for the module.
 */
router.post('/inject/:module_id', asyncWrap(async (req: Request, res: Response) => {
  if (!getStatus().running) {
    res.status(409).json({
      ok: false,
      error: { code: 'SIMULATOR_NOT_RUNNING', message: 'Simulator is not running.' },
    });
    return;
  }
  const module_id = req.params['module_id'] as string;
  if (!isKnownModule(module_id)) {
    res.status(404).json({
      ok: false,
      error: { code: 'MODULE_NOT_FOUND', message: `Module ${module_id} not found.` },
    });
    return;
  }
  try {
    injectSetValues(module_id);
  } catch (err) {
    res.status(400).json({
      ok: false,
      error: { code: 'NO_SETPOINT_TAGS', message: (err as Error).message },
    });
    return;
  }
  res.json({ ok: true });
}));

export default router;
