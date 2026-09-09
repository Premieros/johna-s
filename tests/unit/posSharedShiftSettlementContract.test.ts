import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(process.cwd());
const paymentService = readFileSync(resolve(root, 'src/features/pos/services/payment.ts'), 'utf8');

describe('POS shared branch shift settlement contract', () => {
  it('resolves the active branch shift when a caller omits p_shift_id', () => {
    expect(paymentService).toContain('async function resolveSharedBranchShift');
    expect(paymentService).toContain("posApi.getActiveShift({ p_branch_id: p.p_branch_id })");
    expect(paymentService).toContain("return { payload: null, error: 'SHIFT_REQUIRED' }");
    expect(paymentService).toContain('p_shift_id: shiftId');
  });

  it('uses the resolved shift for normal and split settlement', () => {
    expect(paymentService).toContain('const settlementPayload = resolvedShift.payload');
    expect(paymentService).toContain('processSplitSaleForOrder({ ...splitBase, p_payments: splitPayments })');
    expect(paymentService).toContain('posApi.processSale(settlementPayload)');
  });
});
