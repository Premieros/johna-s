import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({root:fileURLToPath(new URL('../../',import.meta.url)),test:{environment:'node',fileParallelism:false,maxWorkers:1,include:['branch-hub/tests/canonical-disk.integration.ts'],testTimeout:180000,hookTimeout:180000}});
