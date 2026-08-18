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
    // R11 (E5) — no source maps in a production build.
    //
    // `client/dist/**/*.js.map` was emitted and then served by express.static,
    // publishing the full un-minified frontend to anyone who asked. No secrets
    // were in it (checked), but it is a free map of every internal route, feature
    // flag and API shape, and there is no reason for it to ship.
    //
    // Flatly false rather than conditioned on NODE_ENV: `build.sourcemap` is
    // read ONLY by `vite build`, and the sole `vite build` in this repo is the
    // deploy build. `vite dev` serves source maps regardless, so nothing is
    // lost — whereas keying this on an env var that the build host may or may
    // not set is how it silently comes back.
    sourcemap: false,
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
