import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8');

describe('permission runtime alignment contract', () => {
  it('gates the approval inbox by approvals.review instead of ordinary role names', () => {
    const source = read('src/components/ApprovalInbox.tsx');

    expect(source).toContain("const can = useCan()");
    expect(source).toContain("const allowed = can('approvals.review')");
    expect(source).not.toContain("user?.role === 'branch_manager'");
    expect(source).not.toContain("user?.role === 'owner'");
    expect(source).not.toContain("user?.role === 'cashier'");
  });

  it('shows manager-discount approval by capability and authorizes percent discounts by monetary value', () => {
    const source = read('src/features/pos/components/checkout/CashierDiscountApprovalCard.tsx');

    expect(source).toContain("const canDirectDiscount = can('pos.discount')");
    expect(source).toContain('if (canDirectDiscount) return null');
    expect(source).not.toContain("role === 'cashier'");
    expect(source).toContain("const monetaryDiscount = type === 'percent'");
    expect(source).toContain('discount_amount: monetaryDiscount');
    expect(source).toContain('requested_value: normalizedInput');
    expect(source).toContain("Math.min(amount, 100)");
  });
});
