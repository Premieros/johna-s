import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// DB integration tests (node:pg). They connect to the database given by
// SUPABASE_DB_URL / DATABASE_URL (in .env or the environment) and run inside
// BEGIN..ROLLBACK transactions so no data is ever persisted. When no URL is
// configured the whole suite is skipped.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.{ts,ts}'],
    exclude: ['node_modules', 'dist'],
    // All integration files share one PostgreSQL database. Running files in
    // parallel can deadlock when separate transactional fixtures touch the
    // same global tables (for example public.users / public.roles). Keep test
    // files serial while preserving every assertion and RLS/security check.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
