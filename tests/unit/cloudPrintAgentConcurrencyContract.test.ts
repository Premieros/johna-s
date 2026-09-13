import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('cloud print agent concurrency contract', () => {
  it('partitions claimed work by physical printer before starting jobs', () => {
    const source = read('src/features/pos/components/settings/CloudPrintAgent.tsx');

    expect(source).toContain('function physicalPrinterKey(printerName: string)');
    expect(source).toContain('const routes = getLocalPrinterRoutes();');
    expect(source).toContain("const lanes = new Map<string, Array<{ job: CloudPrintJob; printerName: string }>>();");
    expect(source).toContain('for (const job of jobs) {');
    expect(source).toContain('`printer:${physicalPrinterKey(printerName)}`');
    expect(source).toContain('lane.push({ job, printerName });');
    expect(source).toContain('Promise.allSettled(Array.from(lanes.values()).map(async (lane) => {');
    expect(source).toContain('for (const entry of lane) {');
    expect(source).toContain('await executeJob(entry.job, agentId, entry.printerName);');

    const executeJobStart = source.indexOf('async function executeJob');
    const batchStart = source.indexOf('async function executeClaimedBatch');
    const executeJob = source.slice(executeJobStart, batchStart);
    expect(executeJob).not.toContain('getLocalPrinterRoutes()');
  });

  it('keeps the Electron layer FIFO per printer while allowing other printers to continue', () => {
    const queue = read('electron/printerQueue.cjs');
    const queueTest = read('electron/printerQueue.test.cjs');
    const bridge = read('electron/main.cjs');

    expect(queue).toContain('this.tails = new Map();');
    expect(queue).toContain('const previous = this.tails.get(key) || Promise.resolve();');
    expect(queue).toContain('const current = previous.catch(() => undefined).then(task);');
    expect(bridge).toContain('printerQueue.enqueue(printerName');
    expect(bridge).toContain("withTimeout(new Promise((resolve) => {");
    expect(bridge).toContain("PRINT_CALLBACK_TIMEOUT_MS, 'PRINT_CALLBACK_TIMEOUT'");

    expect(queueTest).toContain("'cashier-1-start'");
    expect(queueTest).toContain("'cashier-1-end'");
    expect(queueTest).toContain("'cashier-2-start'");
    expect(queueTest).toContain("withTimeout(barista, 100, 'BARISTA_BLOCKED')");
    expect(queueTest).toContain('releaseKitchen();');
  });

  it('uses the cloud queue for remote browser/phone printing and keeps print retry side-effect free', () => {
    const cloud = read('src/features/pos/services/cloudPrint.ts');
    const printing = read('src/features/pos/utils/printing.ts');
    const kitchen = read('src/features/pos/services/kitchen.ts');
    const securityMigration = read('supabase/migrations/20260911232000_cloud_print_agent.sql');
    const receiptRetry = read('supabase/migrations/20260912003000_cloud_print_receipt_retry_idempotency.sql');

    expect(cloud).toContain("supabase.rpc('enqueue_cloud_kitchen_print'");
    expect(cloud).toContain("supabase.rpc('enqueue_cloud_receipt_print'");
    expect(printing).toContain('if (pending && !isRunningInElectron())');
    expect(printing).toContain('const cloud = await enqueueCloudReceiptPrint');
    expect(printing.indexOf('const cloud = await enqueueCloudReceiptPrint')).toBeLessThan(printing.indexOf('const routes = getLocalPrinterRoutes();'));

    expect(kitchen).toContain("('send_to_kitchen'");
    expect(kitchen).toContain('await enqueueCloudKitchenPrintJobs');
    expect(kitchen.indexOf("('send_to_kitchen'")).toBeLessThan(kitchen.indexOf('await enqueueCloudKitchenPrintJobs'));

    for (const forbidden of ['send_to_kitchen(', 'process_sale', 'deduct_sale_unit_inventory(', 'payment_transactions']) {
      expect(receiptRetry).not.toContain(forbidden);
    }
    expect(securityMigration).toContain('UNIQUE (branch_id, idempotency_key)');
    expect(receiptRetry).toContain("OR (status = 'failed' AND attempts < 5)");
  });
});
