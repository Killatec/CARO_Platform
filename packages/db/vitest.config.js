import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.{js,ts}'],
    setupFiles: ['./__tests__/setup-env.ts'],
  },
});
