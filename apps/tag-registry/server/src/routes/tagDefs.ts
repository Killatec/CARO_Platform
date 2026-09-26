import express, { Router } from 'express';
import { asyncWrap } from '@caro/server/asyncWrap';
import { CaroError } from '@caro/server/errorHandler';
import { ERROR_CODES } from '@caro/tag-registry-shared';
import { generateTagDefsZip } from '../services/tagDefsService.js';

const router: Router = express.Router();

/**
 * GET /api/v1/tag-defs?root=<template_name>
 * Downloads the Tag Defs ZIP for every MQTT module template reachable from root.
 *
 * Success is a binary application/zip body, not the JSON envelope — it is a
 * file download. Errors still flow through errorHandler as the envelope.
 */
router.get('/', asyncWrap(async (req, res) => {
  const root = req.query.root;
  if (typeof root !== 'string' || root.trim() === '') {
    const err = new Error('root is required') as CaroError;
    err.status = 400;
    err.code = ERROR_CODES.VALIDATION_ERROR;
    throw err;
  }

  const { fileName, zip } = await generateTagDefsZip(root);
  res.attachment(fileName);
  res.type('application/zip');
  res.send(Buffer.from(zip));
}));

export default router;
