import express from 'express';
import { asyncWrap } from '@caro/server/asyncWrap';
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
    const err = new Error('rootName is required');
    err.status = 400;
    err.code = ERROR_CODES.VALIDATION_ERROR;
    throw err;
  }
  if (!comment || typeof comment !== 'string' || comment.trim() === '') {
    const err = new Error('comment is required');
    err.status = 400;
    err.code = ERROR_CODES.VALIDATION_ERROR;
    throw err;
  }

  // Load full template graph for rootName
  const rootData = await loadRoot(rootName);

  // Build templateMap (Map<template_name, template>) from loadRoot result
  const templateMap = new Map(
    Object.entries(rootData.templates).map(([name, entry]) => [name, entry.template])
  );

  const result = await applyRegistry(templateMap, rootName, comment.trim());
  res.json({ ok: true, data: result });
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
    const err = new Error('rev must be an integer');
    err.status = 400;
    err.code = ERROR_CODES.VALIDATION_ERROR;
    throw err;
  }
  const tags = await getRevisionTags(rev);
  if (tags === null) {
    const err = new Error(`No tags found for revision ${rev}`);
    err.status = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }
  res.json({ ok: true, data: { tags } });
}));

export default router;
