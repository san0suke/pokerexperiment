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
  },
});
