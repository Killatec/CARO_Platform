import { defineConfig } from 'vitest/config';
import { existsSync } from 'fs';
import path from 'path';

// Vite does not follow NodeNext's .js → .ts resolution convention.
// This plugin intercepts relative .js imports and redirects to the .ts
// source file when it exists — preserving NodeNext conventions for tsc
// while allowing vitest to resolve TypeScript sources directly.
const resolveJsToTs = {
  name: 'resolve-js-to-ts',
  enforce: 'pre',
  resolveId(source, importer) {
    if (!source.endsWith('.js') || !importer || !source.startsWith('.')) return;
    const tsPath = path.resolve(path.dirname(importer), source.slice(0, -3) + '.ts');
    if (existsSync(tsPath)) return tsPath;
  },
};

export default defineConfig({
  plugins: [resolveJsToTs],
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.js'],
  },
});
