import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({root:fileURLToPath(new URL('../../',import.meta.url)),test:{environment:'node',fileParallelism:false,maxWorkers:1,include:['branch-hub/tests/canonical-store.integration.ts'],testTimeout:120000,hookTimeout:120000}});
