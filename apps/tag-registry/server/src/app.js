import express from 'express';
import cors from 'cors';
import templatesRouter from './routes/templates.js';
import registryRouter from './routes/registry.js';
import { errorHandler } from './middleware/errorHandler.js';

/**
 * Express app factory
 */
export function createApp() {
  const app = express();

  // Middleware
  app.use(cors());
  app.use(express.json());

  // Routes
  app.use('/api/v1/templates', templatesRouter);

  app.use('/api/v1/registry', registryRouter);

  // Error handler (must be last)
  app.use(errorHandler);

  
  return app;
}
