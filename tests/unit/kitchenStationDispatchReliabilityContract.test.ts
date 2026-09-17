import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const orderHook = fs.readFileSync(path.join(root, 'src/features/pos/hooks/usePosOrderBase.ts'), 'utf8');
const kitchenService = fs.readFileSync(path.join(root, 'src/features/pos/services/kitchen.ts'), 'utf8');
const dispatchService = fs.readFileSync(path.join(root, 'src/features/pos/services/kitchenDispatch.ts'), 'utf8');
const cloudPrint = fs.readFileSync(path.join(root, 'src/features/pos/services/cloudPrint.ts'), 'utf8');

describe('kitchen station dispatch reliability contract', () => {
  it('passes the authoritative POS branch into kitchen dispatch', () => {
    expect(orderHook).toContain("p_branch_id: branchId");
    expect(kitchenService).toContain("p_branch_id?: string | null");
    expect(kitchenService).toContain("branchId: p.p_branch_id");
    expect(kitchenService).not.toContain("from('orders').select('branch_id')");
  });

  it('retries station enqueue with the same idempotency key', () => {
    expect(cloudPrint).toContain('const KITCHEN_ENQUEUE_MAX_ATTEMPTS = 3;');
    expect(cloudPrint).toContain('const idempotencyKey = `kitchen:${station}:${keySeed}`;');
    expect(cloudPrint).toContain('attempt <= KITCHEN_ENQUEUE_MAX_ATTEMPTS');
    expect(cloudPrint).toContain('p_idempotency_key: idempotencyKey');
    expect(cloudPrint).toContain('kitchen station enqueue failed after retries');
  });

  it('keeps station fallback scoped only to stations not confirmed in cloud queue', () => {
    expect(dispatchService).toContain("if (cloudQueuedStations.has(station))");
    expect(dispatchService).toContain("printKitchenStationsLocally(items, params.context)");
    expect(dispatchService).toContain("state: localPrinted ? ('local_printed' as const) : ('failed' as const)");
  });
});
