import express, { Router } from 'express';
import { asyncWrap } from '@caro/server/asyncWrap';
import { getModuleTypes } from '@caro/db';

const router: Router = express.Router();

router.get('/', asyncWrap(async (_req, res) => {
  const moduleTypes = await getModuleTypes();
  res.json({ ok: true, data: moduleTypes });
}));

export default router;
