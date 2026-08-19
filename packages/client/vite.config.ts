import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  // .env lives at the monorepo root, shared with the server.
  envDir: resolve(here, '../..'),
  resolve: {
    alias: {
      // Point at the source so shared types/logic go through Vite's pipeline (no build step).
      '@poker/shared': resolve(here, '../shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    // Bind to every interface so phones and other devices on the network can reach it.
    host: true,
    // Fail loudly instead of drifting to 5174 — a silent port change looks like
    // "the site is down" when you're typing the URL into a phone.
    strictPort: true,
  },
});
