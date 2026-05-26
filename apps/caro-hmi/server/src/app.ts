import express from 'express';
import type { Application, ErrorRequestHandler } from 'express';
import cors from 'cors';
import compression from 'compression';
import type { TagDef } from '@caro/hmi-context';
import { errorHandler } from '@caro/server';
import { createTagsRouter } from './routes/tags.js';
import { createResetRouter } from './routes/reset.js';
import { createTrendsRouter } from './routes/trends.js';
import { authStub } from './middleware/auth-stub.js';
import type { CmdController } from './cmd-controller.js';
import type { ResetBus } from './reset-bus.js';
import type { DbPipeline } from './db-pipeline.js';

export function createApp(
  tagMap: Map<number, TagDef>,
  cmdController: CmdController,
  resetBus: ResetBus,
  trendableTagIds: Set<number>,
  dbPipeline: DbPipeline,
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

  app.use('/api/v1/tags', createTagsRouter(tagMap, cmdController, trendableTagIds));
  app.use('/api/v1/reset', createResetRouter(resetBus));

  if (process.env.HMI_TRENDS_GZIP === '1') {
    app.use('/api/v1/trends', compression());
  }
  app.use('/api/v1/trends', createTrendsRouter(dbPipeline));

  app.use(errorHandler as ErrorRequestHandler);

  return app;
}
