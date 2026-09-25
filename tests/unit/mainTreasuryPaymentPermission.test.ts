import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const migration = fs.readFileSync(
  'supabase/migrations/20260926024000_main_treasury_payment_permission.sql',
  'utf8',
);
const permissions = fs.readFileSync('src/lib/permissionDefs.ts', 'utf8');
const contracts = fs.readFileSync('src/lib/permissionContracts.ts', 'utf8');
const payments = fs.readFileSync('src/features/accounting/pages/PaymentsPage.tsx', 'utf8');

describe('main treasury supplier-payment permission contract', () => {
  it('defines a dedicated permission instead of overloading treasury transfer', () => {
    expect(permissions).toContain("'accounting.treasury.main_cash.pay'");
    expect(permissions).toContain("السداد من الخزنة الرئيسية");
    expect(contracts).toContain("'accounting.treasury.main_cash.pay': ['procurement.payment.create']");
    expect(contracts).toContain('لا يمنح التحويل بين الخزن');
  });

  it('keeps backward compatibility for existing treasury-transfer holders', () => {
    expect(migration).toContain("can_permission('accounting.treasury.transfer')");
    expect(migration).toContain("can_permission('accounting.treasury.main_cash.pay')");
    expect(migration).toContain('MAIN_TREASURY_PAYMENT_PERMISSION_REQUIRED');
  });

  it('keeps supplier payment permission required for the payment action', () => {
    expect(migration).toContain("can_permission('procurement.payment.create')");
    expect(migration).toContain('Supplier payments require procurement.payment.create.');
  });

  it('shows source details and the reason main treasury is unavailable', () => {
    expect(payments).toContain('canUseMainTreasury');
    expect(payments).toContain('الخزنة الرئيسية غير متاحة لهذا المستخدم');
    expect(payments).toContain('selected.branch_name');
    expect(payments).toContain('selected.balance');
    expect(payments).toContain("selected.scope === 'organization'");
  });
});
