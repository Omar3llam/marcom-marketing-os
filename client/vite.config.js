import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config for the Lumi Decision OS client.
// Dev server runs on :5173 by default; the Express backend on :3000.
// Use the proxy below to call /api/lumi/* without CORS during development.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
