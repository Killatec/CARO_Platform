import express, { Router } from 'express';
import { asyncWrap } from '@caro/server/asyncWrap';
import { CaroError } from '@caro/server/errorHandler';
import { getActiveRegistry, applyRegistry, getRevisions, getRevisionTags } from '../services/registryService.js';
import { loadRoot } from '../services/templateService.js';
import { ERROR_CODES } from '@caro/tag-registry-shared';

type ApiResponse<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string; details?: unknown } };

const router: Router = express.Router();

/**
 * GET /api/v1/registry
 * Returns the current active (non-retired) registry rows from the database.
 */
router.get('/', asyncWrap(async (_req, res) => {
  const tags = await getActiveRegistry();
  const response: ApiResponse<{ tags: typeof tags }> = { ok: true, data: { tags } };
  res.json(response);
}));

/**
 * POST /api/v1/registry/apply
 * Applies the resolved registry for a given root template to the database.
 *
 * Body: { rootName: string, comment: string }
 */
router.post('/apply', asyncWrap(async (req, res) => {
  const { rootName, comment } = req.body as { rootName: unknown; comment: unknown };

  if (!rootName || typeof rootName !== 'string' || rootName.trim() === '') {
    const err = new Error('rootName is required') as CaroError;
    err.status = 400;
    err.code = ERROR_CODES.VALIDATION_ERROR;
    throw err;
  }
  if (!comment || typeof comment !== 'string' || comment.trim() === '') {
    const err = new Error('comment is required') as CaroError;
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
  const response: ApiResponse<typeof result> = { ok: true, data: result };
  res.json(response);
}));

/**
 * GET /api/v1/registry/revisions
 * Returns all registry revisions ordered by registry_rev DESC.
 */
router.get('/revisions', asyncWrap(async (_req, res) => {
  const revisions = await getRevisions();
  const response: ApiResponse<{ revisions: typeof revisions }> = { ok: true, data: { revisions } };
  res.json(response);
}));

/**
 * GET /api/v1/registry/revisions/:rev
 * Returns all tag_registry rows for a given revision.
 */
router.get('/revisions/:rev', asyncWrap(async (req, res) => {
  const rev = parseInt(req.params.rev as string, 10);
  if (isNaN(rev)) {
    const err = new Error('rev must be an integer') as CaroError;
    err.status = 400;
    err.code = ERROR_CODES.VALIDATION_ERROR;
    throw err;
  }
  const tags = await getRevisionTags(rev);
  if (tags === null) {
    const err = new Error(`No tags found for revision ${rev}`) as CaroError;
    err.status = 404;
    err.code = 'NOT_FOUND';
    throw err;
  }
  const response: ApiResponse<{ tags: typeof tags }> = { ok: true, data: { tags } };
  res.json(response);
}));

export default router;
