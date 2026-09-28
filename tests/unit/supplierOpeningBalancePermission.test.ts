import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const permissions = fs.readFileSync('src/lib/permissionDefs.ts', 'utf8');
const contracts = fs.readFileSync('src/lib/permissionContracts.ts', 'utf8');
const suppliersPage = fs.readFileSync('src/features/parties/pages/SuppliersPage.tsx', 'utf8');
const statementModal = fs.readFileSync('src/features/parties/components/SupplierStatementModal.tsx', 'utf8');
const accountingApi = fs.readFileSync('src/api/domains/accounting.ts', 'utf8');
const migration = fs.readFileSync(
  'supabase/migrations/20260928003000_supplier_opening_balance_permission.sql',
  'utf8',
);

describe('supplier opening balance permission and accounting contract', () => {
  it('defines a standalone sensitive permission that depends on supplier visibility', () => {
    expect(permissions).toContain("'suppliers.opening_balance.manage'");
    expect(permissions).toContain('إضافة رصيد افتتاحي للمورد');
    expect(contracts).toContain("'suppliers.opening_balance.manage': ['suppliers.view']");
    expect(contracts).toContain("'suppliers.opening_balance.manage',");
  });

  it('enforces the permission in the UI and the backend RPC', () => {
    expect(suppliersPage).toContain("can('suppliers.opening_balance.manage')");
    expect(suppliersPage).toContain('supplier-opening-balance-section');
    expect(migration).toContain("can_permission('suppliers.opening_balance.manage')");
    expect(migration).toContain("'permission', 'suppliers.opening_balance.manage'");
    expect(migration).toContain('assert_user_work_authorized_cached(p_branch_id)');
  });

  it('posts a real balanced AP opening journal rather than changing suppliers.balance', () => {
    expect(migration).toContain("'supplier_opening_balance'");
    expect(migration).toContain("'account_key','ap'");
    expect(migration).toContain("'account_code','3200'");
    expect(migration).toContain("'Opening Balance Equity'");
    expect(migration).not.toContain('UPDATE public.suppliers SET balance');
  });

  it('feeds AP aging, supplier statement, payment allocation, and the balance sheet', () => {
    expect(migration).toContain('public.supplier_opening_balances');
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.get_ap_aging');
    expect(migration).toContain("'opening_balance',COALESCE(v_opening,0)");
    expect(migration).toContain('SET settled_amount = settled_amount + v_applied');
    expect(migration).toContain("'opening_equity',opening_equity");
    expect(statementModal).toContain("entryType === 'opening_balance'");
    expect(statementModal).toContain("s.opening_balance || 0");
  });

  it('exposes only the dedicated RPCs to the frontend', () => {
    expect(accountingApi).toContain("rpc('get_supplier_opening_balance'");
    expect(accountingApi).toContain("rpc('set_supplier_opening_balance'");
    expect(suppliersPage).toContain('setSupplierOpeningBalance');
    expect(suppliersPage).toContain('getSupplierOpeningBalance');
  });
});
