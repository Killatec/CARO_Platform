import express from 'express';
import { asyncWrap } from '../middleware/asyncWrap.js';
import * as templateService from '../services/templateService.js';

const router = express.Router();

/**
 * GET /api/v1/templates
 * List all templates, optionally filtered by type
 */
router.get('/', asyncWrap(async (req, res) => {
  const { type } = req.query;
  const templates = await templateService.listTemplates(type);
  res.json({ ok: true, data: { templates } });
}));

/**
 * GET /api/v1/templates/root/:template_name
 * Load full reachable template graph from a root
 * NOTE: This route must come BEFORE the /:template_name route
 */
router.get('/root/:template_name', asyncWrap(async (req, res) => {
  const { template_name } = req.params;
  const result = await templateService.loadRoot(template_name);
  res.json({ ok: true, data: result });
}));

/**
 * GET /api/v1/templates/:template_name
 * Get a single template with hash
 */
router.get('/:template_name', asyncWrap(async (req, res) => {
  const { template_name } = req.params;
  const result = await templateService.getTemplate(template_name);
  res.json({ ok: true, data: result });
}));

/**
 * POST /api/v1/templates/batch
 * Batch save templates with hash checking and cascade confirmation
 */
router.post('/batch', asyncWrap(async (req, res) => {
  const { changes, deletions = [], confirmed = false } = req.body;
  const result = await templateService.batchSave(changes, deletions, confirmed);
  res.json({ ok: true, data: result });
}));

/**
 * DELETE /api/v1/templates/:template_name
 * Delete template and remove all references
 */
router.delete('/:template_name', asyncWrap(async (req, res) => {
  const { template_name } = req.params;
  const { original_hash, confirmed = false } = req.body;
  const result = await templateService.deleteTemplate(template_name, original_hash, confirmed);
  res.json({ ok: true, data: result });
}));

/**
 * POST /api/v1/templates/validate
 * Run full validation across all template files
 */
router.post('/validate', asyncWrap(async (req, res) => {
  const result = await templateService.validateAll();
  res.json({ ok: true, data: result });
}));

export default router;
