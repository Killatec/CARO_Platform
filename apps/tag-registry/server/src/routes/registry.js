import express from 'express';
import { asyncWrap } from '../middleware/asyncWrap.js';
import { getActiveRegistry, applyRegistry, getRevisions, getRevisionTags } from '../services/registryService.js';
import { loadRoot } from '../services/templateService.js';
import { ERROR_CODES } from '../../../shared/index.js';

const router = express.Router();

/**
 * GET /api/v1/registry
 * Returns the current active (non-retired) registry rows from the database.
 */
router.get('/', asyncWrap(async (req, res) => {
  const tags = await getActiveRegistry();
  res.json({ ok: true, data: { tags } });
}));

/**
 * POST /api/v1/registry/apply
 * Applies the resolved registry for a given root template to the database.
 *
 * Body: { rootName: string, comment: string }
 */
router.post('/apply', asyncWrap(async (req, res) => {
  const { rootName, comment } = req.body;

  if (!rootName || typeof rootName !== 'string' || rootName.trim() === '') {
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'rootName is required' } });
  }
  if (!comment || typeof comment !== 'string' || comment.trim() === '') {
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'comment is required' } });
  }

  // Load full template graph for rootName
  let rootData;
  try {
    rootData = await loadRoot(rootName);
  } catch (err) {
    if (err.code === ERROR_CODES.TEMPLATE_NOT_FOUND) {
      return res.status(404).json({ ok: false, error: { code: err.code, message: err.message } });
    }
    throw err;
  }

  // Build templateMap (Map<template_name, template>) from loadRoot result
  const templateMap = new Map(
    Object.entries(rootData.templates).map(([name, entry]) => [name, entry.template])
  );

  try {
    const result = await applyRegistry(templateMap, rootName, comment.trim());
    res.json({ ok: true, data: result });
  } catch (err) {
    console.error('[registry/apply] Failed to apply registry:', err);
    res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to apply registry' } });
  }
}));

/**
 * GET /api/v1/registry/revisions
 * Returns all registry revisions ordered by registry_rev DESC.
 */
router.get('/revisions', asyncWrap(async (req, res) => {
  const revisions = await getRevisions();
  res.json({ ok: true, data: { revisions } });
}));

/**
 * GET /api/v1/registry/revisions/:rev
 * Returns all tag_registry rows for a given revision.
 */
router.get('/revisions/:rev', asyncWrap(async (req, res) => {
  const rev = parseInt(req.params.rev, 10);
  if (isNaN(rev)) {
    return res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'rev must be an integer' } });
  }
  const tags = await getRevisionTags(rev);
  if (tags === null) {
    return res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: `No tags found for revision ${rev}` } });
  }
  res.json({ ok: true, data: { tags } });
}));

export default router;
