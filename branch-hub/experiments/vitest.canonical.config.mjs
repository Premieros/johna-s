import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root:fileURLToPath(new URL('../../',import.meta.url)),
  test:{environment:'node',fileParallelism:false,maxWorkers:1,
    setupFiles:['branch-hub/experiments/pglite-vitest-setup.mjs'],
    include:['tests/integration/split_payment_atomicity.test.ts','tests/integration/kitchen_quantity_delta.test.ts','tests/integration/process_sale_order_settlement.test.ts','tests/integration/auto_sale_production_reversal.test.ts','tests/integration/modifier_burger_lifecycle.test.ts'],
    testTimeout:30000,hookTimeout:120000}
});
