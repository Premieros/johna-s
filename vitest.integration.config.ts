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
    // These suites share one Postgres instance and several fixtures intentionally
    // keep transactions open until afterAll. Running files in parallel can create
    // cross-suite table/row lock cycles (notably on public.users), producing
    // PostgreSQL 40P01 deadlocks before assertions execute. Serializing files keeps
    // the exact same tests and RLS coverage while making the DB regression gate deterministic.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
