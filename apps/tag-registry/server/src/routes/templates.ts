import express, { Router } from 'express';
import { asyncWrap } from '@caro/server/asyncWrap';
import * as templateService from '../services/templateService.js';

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; details?: unknown } };

const router: Router = express.Router();

/**
 * GET /api/v1/templates
 * List all templates, optionally filtered by type
 */
router.get('/', asyncWrap(async (req, res) => {
  const type = req.query.type as string | undefined;
  const templates = await templateService.listTemplates(type);
  const response: ApiResponse<{ templates: typeof templates }> = { ok: true, data: { templates } };
  res.json(response);
}));

/**
 * GET /api/v1/templates/root/:template_name
 * Load full reachable template graph from a root
 * NOTE: This route must come BEFORE the /:template_name route
 */
router.get('/root/:template_name', asyncWrap(async (req, res) => {
  const template_name = req.params.template_name as string;
  const result = await templateService.loadRoot(template_name);
  const response: ApiResponse<typeof result> = { ok: true, data: result };
  res.json(response);
}));

/**
 * GET /api/v1/templates/:template_name
 * Get a single template with hash
 */
router.get('/:template_name', asyncWrap(async (req, res) => {
  const template_name = req.params.template_name as string;
  const result = await templateService.getTemplate(template_name);
  const response: ApiResponse<typeof result> = { ok: true, data: result };
  res.json(response);
}));

/**
 * POST /api/v1/templates/batch
 * Batch save templates with hash checking and cascade confirmation
 */
router.post('/batch', asyncWrap(async (req, res) => {
  const { changes, deletions = [], confirmed = false } = req.body as {
    changes: templateService.BatchChange[];
    deletions?: templateService.BatchDeletion[];
    confirmed?: boolean;
  };
  const result = await templateService.batchSave(changes, deletions, confirmed);
  const response: ApiResponse<typeof result> = { ok: true, data: result };
  res.json(response);
}));

/**
 * DELETE /api/v1/templates/:template_name
 * Delete template and remove all references
 */
router.delete('/:template_name', asyncWrap(async (req, res) => {
  const template_name = req.params.template_name as string;
  const { original_hash, confirmed = false } = req.body as {
    original_hash: string;
    confirmed?: boolean;
  };
  const result = await templateService.deleteTemplate(template_name, original_hash, confirmed);
  const response: ApiResponse<typeof result> = { ok: true, data: result };
  res.json(response);
}));

/**
 * POST /api/v1/templates/validate
 * Run full validation across all template files
 */
router.post('/validate', asyncWrap(async (_req, res) => {
  const result = await templateService.validateAll();
  const response: ApiResponse<typeof result> = { ok: true, data: result };
  res.json(response);
}));

export default router;
