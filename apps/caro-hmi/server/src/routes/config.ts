import { Router } from 'express';
import { asyncWrap } from '@caro/server';

/**
 * GET /api/v1/config
 *
 * Runtime identity of the system this server is serving. The client uses
 * `projectRoot` for two things: selecting its page tree under
 * `client/src/hmi-definitions/<PROJECT_ROOT>/`, and namespacing localStorage
 * so two systems viewed from the same browser never read each other's
 * saved state.
 *
 * `databaseName` is deliberately NOT served here, unlike tag-registry's
 * `/config`. Tag Registry is an admin tool; the HMI is the operator surface
 * and its auth is still stubbed, so this endpoint is reachable by anything
 * that can reach port 3003. Nothing in the client needs the database name,
 * and the startup log already prints it for the "did the switch take?"
 * check. The envelope makes adding it later non-breaking if that changes.
 *
 * Fields are hand-picked, never spread from process.env.
 *
 * Read per-request rather than from `config.ts`'s frozen singleton. The value
 * cannot actually change at runtime — env is loaded once at startup — so this
 * is a testability choice, not a liveness one: it lets a test set
 * PROJECT_ROOT per case without a module reset.
 */
export function createConfigRouter(): Router {
  const router = Router();

  router.get('/', asyncWrap(async (_req, res) => {
    const projectRoot = process.env.PROJECT_ROOT?.trim() || null;
    res.json({ ok: true, data: { projectRoot } });
  }));

  return router;
}
