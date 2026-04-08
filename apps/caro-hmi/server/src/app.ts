import express from 'express';
import type { Application } from 'express';
import cors from 'cors';
import type { TagDef } from '@caro/hmi-context';
import { errorHandler } from '@caro/server';
import { createTagsRouter } from './routes/tags.js';
import { authStub } from './middleware/auth-stub.js';

export function createApp(tagMap: Map<number, TagDef>): Application {
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

  app.use('/api/v1/tags', createTagsRouter(tagMap));

  app.use(errorHandler);

  return app;
}
