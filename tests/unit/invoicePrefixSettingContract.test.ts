import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('invoice prefix settings wiring', () => {
  const settingsPage = readFileSync('src/features/admin/pages/SettingsControlCenterPage.tsx', 'utf8');
  const settingsContext = readFileSync('src/context/SettingsContext.tsx', 'utf8');
  const payment = readFileSync('src/features/pos/services/payment.ts', 'utf8');
  const wrapper = readFileSync('src/features/pos/hooks/usePosOrder.ts', 'utf8');
  const base = readFileSync('src/features/pos/hooks/usePosOrderBase.ts', 'utf8');
  const migration = readFileSync('supabase/migrations/20260922152000_branch_sales_invoice_prefix.sql', 'utf8');

  it('exposes a per-branch prefix field and saves it through branch settings', () => {
    expect(settingsPage).toContain("label={isAr ? 'بادئة فاتورة المبيعات الجديدة' : 'New Sales Invoice Prefix'}");
    expect(settingsPage).toContain("invoice_prefix: invoicePrefix || null");
    expect(settingsPage).toContain("maxLength={12}");
  });

  it('keeps the dormant global prefix from silently changing existing numbering', () => {
    expect(settingsContext).toContain('branch_invoice_prefix: branch.invoice_prefix ?? null');
    expect(settingsContext).not.toContain('invoice_prefix: branch.invoice_prefix ?? global.invoice_prefix');
  });

  it('applies the branch override only while allocating new sale numbers', () => {
    expect(payment).toContain('nextInvoiceNumber(branchPrefix?: string | null)');
    expect(payment).toContain('formatAllocatedInvoiceNumber(payload?.number, payload?.raw, branchPrefix)');
    expect(wrapper).toContain('nextInvoiceNumber(input.effSettings?.branch_invoice_prefix)');
    expect(base).toContain('nextInvoiceNumber(effSettings?.branch_invoice_prefix)');
  });

  it('preserves the established offline reconciliation marker', () => {
    expect(payment).toContain('INV-OFF-');
  });

  it('adds the setting without rewriting historical invoices', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS invoice_prefix text');
    expect(migration).not.toContain('UPDATE public.sales');
    expect(migration).not.toContain('ALTER TABLE public.sales');
  });
});
