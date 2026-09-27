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

  it('keeps discount approval leaf provider-free and permission-first', () => {
    const card = read('src/features/pos/components/checkout/CashierDiscountApprovalCard.tsx');
    const panel = read('src/features/pos/components/checkout/PaymentPanel.tsx');
    const workspace = read('src/features/pos/pages/PosWorkspacePage.tsx');

    expect(card).toContain('canDirectDiscount: boolean');
    expect(card).toContain('if (canDirectDiscount) return null');
    expect(card).not.toContain('useCan(');
    expect(card).not.toContain('useAuth(');
    expect(card).not.toContain("role === 'cashier'");

    expect(panel).toContain('canDirectDiscount?: boolean');
    expect(panel).toContain('canDirectDiscount={p.canDirectDiscount === true}');
    expect(workspace).toContain('canDirectDiscount={perms.canDiscount}');
  });

  it('authorizes percentage discounts using the exact monetary discount value', () => {
    const source = read('src/features/pos/components/checkout/CashierDiscountApprovalCard.tsx');

    expect(source).toContain("const normalizedInput = type === 'percent'");
    expect(source).toContain('Math.min(amount, 100)');
    expect(source).toContain("const monetaryDiscount = type === 'percent'");
    expect(source).toContain('(Math.max(subtotal, 0) * normalizedInput) / 100');
    expect(source).toContain('discount_amount: monetaryDiscount');
    expect(source).toContain('requested_value: normalizedInput');
  });
});
