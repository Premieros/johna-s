import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('live shift expected cash contract', () => {
  it('uses the authoritative active-shift RPC for open shift expected cash in the shifts UI', () => {
    const page = read('src/features/trade/pages/ShiftsPage.tsx');

    expect(page).toContain("api.pos.getActiveShift({ p_branch_id: shift.branch_id })");
    expect(page).toContain('liveExpectedByShift');
    expect(page).toContain('formatCurrency(getExpectedAmount(r), currency, lang)');
    expect(page).toContain('formatCurrency(getExpectedAmount(openShifts[0]), currency, lang)');
    expect(page).toContain('void openCloseModal(r)');
    expect(page).not.toContain('actual_amount: r.expected_amount');
    expect(page).not.toContain('formatCurrency(openShifts[0].expected_amount, currency, lang)');
  });

  it('recomputes open Z-report expected cash from the trusted shift ledger equation', () => {
    const report = read('src/features/trade/services/shiftClosingFinancials.ts');

    expect(report).toContain("op.operation_type === 'sale' || op.operation_type === 'cash_in'");
    expect(report).toContain("op.operation_type === 'refund' || op.operation_type === 'expense' || op.operation_type === 'cash_out'");
    expect(report).toContain("shift.status === 'open'");
    expect(report).toContain('? liveExpectedAmount');
    expect(report).not.toContain('expectedAmount: Number(shift.expected_amount || shift.opening_amount || 0)');
  });
});
