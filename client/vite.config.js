import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'url';

// Anchor the `@` alias to THIS file's directory using
// fileURLToPath(import.meta.url). Using process.cwd() here is
// fragile: the resolver runs in a worker whose cwd may not be
// the client/ directory, so `@/foo` would silently fail to
// resolve, Vite would drop the import, and the bundle would
// quietly omit every aliased module.
const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // Firebase SDK (~200KB) — separately cacheable so app-code
          // deploys don't force returning users to re-download Firebase.
          'vendor-firebase': ['firebase/app', 'firebase/auth'],
          // React core + router — also stable across deploys.
          'vendor-react':    ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
