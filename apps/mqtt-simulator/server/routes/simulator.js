import express from 'express';
import { asyncWrap } from '../middleware/asyncWrap.js';
import { start, stop, getStatus, getLogs, isKnownModule, activateModule, deactivateModule, activateDeltaMode, deactivateDeltaMode, activateProtobuf, deactivateProtobuf, publishSnapshot, injectSetValues } from '../services/simulatorService.js';

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

/**
 * GET /api/v1/simulator/logs
 */
router.get('/logs', asyncWrap(async (req, res) => {
  res.json({ ok: true, data: getLogs() });
}));

/**
 * POST /api/v1/simulator/telemetry/stop/:module_id
 * Removes module from active transmission.
 */
router.post('/telemetry/stop/:module_id', asyncWrap(async (req, res) => {
  if (!getStatus().running) {
    return res.status(409).json({
      ok: false,
      error: { code: 'SIMULATOR_NOT_RUNNING', message: 'Simulator is not running.' },
    });
  }
  const { module_id } = req.params;
  if (!isKnownModule(module_id)) {
    return res.status(404).json({
      ok: false,
      error: { code: 'MODULE_NOT_FOUND', message: `Module ${module_id} not found.` },
    });
  }
  deactivateModule(module_id);
  res.json({ ok: true });
}));

/**
 * POST /api/v1/simulator/telemetry/start/:module_id
 * Adds module back to active transmission.
 */
router.post('/telemetry/start/:module_id', asyncWrap(async (req, res) => {
  if (!getStatus().running) {
    return res.status(409).json({
      ok: false,
      error: { code: 'SIMULATOR_NOT_RUNNING', message: 'Simulator is not running.' },
    });
  }
  const { module_id } = req.params;
  if (!isKnownModule(module_id)) {
    return res.status(404).json({
      ok: false,
      error: { code: 'MODULE_NOT_FOUND', message: `Module ${module_id} not found.` },
    });
  }
  activateModule(module_id);
  res.json({ ok: true });
}));

/**
 * POST /api/v1/simulator/delta/enable/:module_id
 * Switches module to delta (publish-only-changed) mode.
 */
router.post('/delta/enable/:module_id', asyncWrap(async (req, res) => {
  if (!getStatus().running) {
    return res.status(409).json({
      ok: false,
      error: { code: 'SIMULATOR_NOT_RUNNING', message: 'Simulator is not running.' },
    });
  }
  const { module_id } = req.params;
  if (!isKnownModule(module_id)) {
    return res.status(404).json({
      ok: false,
      error: { code: 'MODULE_NOT_FOUND', message: `Module ${module_id} not found.` },
    });
  }
  activateDeltaMode(module_id);
  res.json({ ok: true });
}));

/**
 * POST /api/v1/simulator/delta/disable/:module_id
 * Switches module back to full publish mode.
 */
router.post('/delta/disable/:module_id', asyncWrap(async (req, res) => {
  if (!getStatus().running) {
    return res.status(409).json({
      ok: false,
      error: { code: 'SIMULATOR_NOT_RUNNING', message: 'Simulator is not running.' },
    });
  }
  const { module_id } = req.params;
  if (!isKnownModule(module_id)) {
    return res.status(404).json({
      ok: false,
      error: { code: 'MODULE_NOT_FOUND', message: `Module ${module_id} not found.` },
    });
  }
  deactivateDeltaMode(module_id);
  res.json({ ok: true });
}));

/**
 * POST /api/v1/simulator/protobuf/enable/:module_id
 * Switches module to Protobuf encoding.
 */
router.post('/protobuf/enable/:module_id', asyncWrap(async (req, res) => {
  if (!getStatus().running) {
    return res.status(409).json({
      ok: false,
      error: { code: 'SIMULATOR_NOT_RUNNING', message: 'Simulator is not running.' },
    });
  }
  const { module_id } = req.params;
  if (!isKnownModule(module_id)) {
    return res.status(404).json({
      ok: false,
      error: { code: 'MODULE_NOT_FOUND', message: `Module ${module_id} not found.` },
    });
  }
  activateProtobuf(module_id);
  res.json({ ok: true });
}));

/**
 * POST /api/v1/simulator/protobuf/disable/:module_id
 * Switches module back to JSON encoding.
 */
router.post('/protobuf/disable/:module_id', asyncWrap(async (req, res) => {
  if (!getStatus().running) {
    return res.status(409).json({
      ok: false,
      error: { code: 'SIMULATOR_NOT_RUNNING', message: 'Simulator is not running.' },
    });
  }
  const { module_id } = req.params;
  if (!isKnownModule(module_id)) {
    return res.status(404).json({
      ok: false,
      error: { code: 'MODULE_NOT_FOUND', message: `Module ${module_id} not found.` },
    });
  }
  deactivateProtobuf(module_id);
  res.json({ ok: true });
}));

/**
 * POST /api/v1/simulator/snapshot/:module_id
 * Forces a full telemetry publish for the module (bypasses delta mode).
 */
router.post('/snapshot/:module_id', asyncWrap(async (req, res) => {
  if (!getStatus().running) {
    return res.status(409).json({
      ok: false,
      error: { code: 'SIMULATOR_NOT_RUNNING', message: 'Simulator is not running.' },
    });
  }
  const { module_id } = req.params;
  if (!isKnownModule(module_id)) {
    return res.status(404).json({
      ok: false,
      error: { code: 'MODULE_NOT_FOUND', message: `Module ${module_id} not found.` },
    });
  }
  publishSnapshot(module_id);
  res.json({ ok: true });
}));

/**
 * POST /api/v1/simulator/inject/:module_id
 * Publishes a SET_VALUES command with random setpoint values for the module.
 */
router.post('/inject/:module_id', asyncWrap(async (req, res) => {
  if (!getStatus().running) {
    return res.status(409).json({
      ok: false,
      error: { code: 'SIMULATOR_NOT_RUNNING', message: 'Simulator is not running.' },
    });
  }
  const { module_id } = req.params;
  if (!isKnownModule(module_id)) {
    return res.status(404).json({
      ok: false,
      error: { code: 'MODULE_NOT_FOUND', message: `Module ${module_id} not found.` },
    });
  }
  try {
    injectSetValues(module_id);
  } catch (err) {
    return res.status(400).json({
      ok: false,
      error: { code: 'NO_SETPOINT_TAGS', message: err.message },
    });
  }
  res.json({ ok: true });
}));

export default router;
