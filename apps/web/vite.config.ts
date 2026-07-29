import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const gatewayServerName = process.env.GATEWAY_SERVER_NAME?.trim();

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    // The gateway preserves the browser Host header. Allow the configured
    // public hostname explicitly while keeping Vite's Host-header protection.
    ...(gatewayServerName && gatewayServerName !== '_'
      ? { allowedHosts: [gatewayServerName] }
      : {}),
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
