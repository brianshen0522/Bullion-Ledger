import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      // Proxy API calls to the backend so cookies work on the same origin in
      // dev (avoids SameSite cross-origin headaches during local dev).
      '/api': {
        target: process.env.API_URL ?? 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    // Source maps are opt-in so production deployments do not publish source
    // unless the operator explicitly needs them for a private error tracker.
    sourcemap: process.env.GENERATE_SOURCEMAP === 'true',
  },
});
