import dotenv from 'dotenv';
import os from 'os';
import { createApp } from './app.js';
import { initializeIndex } from './services/templateService.js';
import { ping, runMigrations } from '@caro/db';

// Load environment variables
dotenv.config();

// Validate required environment variables
const REQUIRED_ENV_VARS = ['TEMPLATES_DIR'];
for (const varName of REQUIRED_ENV_VARS) {
  if (!process.env[varName]) {
    console.error(`ERROR: Required environment variable ${varName} is not set.`);
    console.error('Please create a .env file in the project root with the required variables.');
    process.exit(1);
  }
}

const PORT = process.env.PORT || 3001;

// Initialize template index and start server
async function start() {
  try {
    // Verify database connectivity
    try {
      await ping();
      console.log('[db] Connected to PostgreSQL (caro_dev)');
    } catch (err) {
      console.error('[db] Failed to connect to PostgreSQL:', err.message);
      process.exit(1);
    }

    // Run database migrations — abort startup on failure
    try {
      await runMigrations();
    } catch (err) {
      console.error('Server startup aborted — migration failure:', err.message);
      process.exit(1);
    }

    console.log('Initializing template index...');
    await initializeIndex();

    const app = createApp();

    app.listen(PORT, () => {
      const interfaces = os.networkInterfaces();
      const localIP = Object.values(interfaces)
        .flat()
        .find(i => i.family === 'IPv4' && !i.internal)?.address || 'localhost';
      console.log(`Tag Registry Server running at http://${localIP}:${PORT}`);
      console.log(`Templates directory: ${process.env.TEMPLATES_DIR}`);
      console.log(`Max tag path length: ${process.env.MAX_TAG_PATH_LENGTH || 100}`);
      console.log(`Required parent types: ${process.env.VALIDATE_REQUIRED_PARENT_TYPES || '(none)'}`);
      console.log(`Unique parent types: ${process.env.VALIDATE_UNIQUE_PARENT_TYPES || 'false'}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();
