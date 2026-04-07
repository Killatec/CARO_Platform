import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5199,
    proxy: {
      '/api': 'http://localhost:3099'
    }
  }
});
