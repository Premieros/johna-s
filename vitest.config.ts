import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// Audited pure Node imports only. New/unclassified tests safely default to DOM.
const nodeFiles = JSON.parse(readFileSync(new URL('./tests/config/node-test-files.json', import.meta.url), 'utf8')) as string[];

// Unit/component tests run in jsdom with the `@` alias (mirrors vite.config.ts).
// DB integration tests (node:pg) use a separate config: vitest.integration.config.ts
// and run inside BEGIN..ROLLBACK transactions so production data is never touched.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    // Vitest 4 removed environmentMatchGlobs; explicit projects are required.
    projects: [
      {
        extends: true,
        test: {
          name: 'node', environment: 'node', include: nodeFiles,
          setupFiles: ['./tests/setup.node.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom', environment: 'jsdom',
          include: ['tests/unit/**/*.test.{ts,tsx}', 'tests/components/**/*.test.{ts,tsx}'],
          exclude: [...nodeFiles, 'tests/integration/**', 'node_modules', 'dist'],
          setupFiles: ['./tests/setup.ts'],
        },
      },
    ],
    exclude: ['tests/integration/**', 'node_modules', 'dist'],
    css: false,
    restoreMocks: true,
  },
});
