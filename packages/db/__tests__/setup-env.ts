import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const envPath = resolve(__dirname, '../../../apps/caro-hmi/server/.env');

if (existsSync(envPath)) {
  config({ path: envPath });
} else {
  console.info('[setup-env] apps/caro-hmi/server/.env not found — integration tests will be skipped');
}
