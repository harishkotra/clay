import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * The client only ever calls `/api` on its own origin. Which runtime answers is
 * the dev script's business: workers on :8787, the Node fallback on :3001.
 */
const runtime = (process.env.RUNTIME ?? 'workers').toLowerCase();
const apiTarget =
  process.env.CLAY_API_TARGET ??
  (runtime === 'node' ? 'http://127.0.0.1:3001' : 'http://127.0.0.1:8787');

export default defineConfig({
  root: 'client',
  plugins: [react(), tailwindcss()],
  server: {
    // Bind IPv4 explicitly so 127.0.0.1:5173 is always reachable, which is the
    // URL the README and the browser harness use.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': { target: apiTarget, changeOrigin: true } },
  },
  build: { outDir: '../dist/client', emptyOutDir: true },
});
