import express from 'express';
import type { Application, ErrorRequestHandler } from 'express';
import cors from 'cors';
import type { TagDef } from '@caro/hmi-context';
import { errorHandler } from '@caro/server';
import { createTagsRouter } from './routes/tags.js';
import { createModulesRouter } from './routes/modules.js';
import { createResetRouter } from './routes/reset.js';
import { authStub } from './middleware/auth-stub.js';
import type { TelemetryIntake } from './telemetry-intake.js';
import type { CmdController } from './cmd-controller.js';
import type { ResetBus } from './reset-bus.js';

export function createApp(
  tagMap: Map<number, TagDef>,
  intake: TelemetryIntake,
  cmdController: CmdController,
  resetBus: ResetBus,
): Application {
  const app = express();

  app.use(cors({
    origin: [
      'http://localhost:5173',
      'http://localhost:5174',
      'http://localhost:5175',
      'http://localhost:5176',
    ],
  }));
  app.use(express.json());
  app.use(authStub);

  app.use('/api/v1/tags', createTagsRouter(tagMap, cmdController));
  app.use('/api/v1/modules', createModulesRouter(intake));
  app.use('/api/v1/reset', createResetRouter(resetBus));

  app.use(errorHandler as ErrorRequestHandler);

  return app;
}
