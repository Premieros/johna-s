import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/features/accounting/pages/FinancialReportsPage.tsx', 'utf8');

describe('accounting debit/credit labels', () => {
  it('uses accounting labels instead of the generic payment credit translation', () => {
    expect(source).toContain("const accountingDebitLabel = isAr ? 'مدين' : 'Debit';");
    expect(source).toContain("const accountingCreditLabel = isAr ? 'دائن' : 'Credit';");
    expect(source).not.toContain("{t('credit')}");
    expect(source).not.toContain("{t('debit')}");
  });

  it('keeps trial balance debit/credit headers fixed and independent of ledger account type', () => {
    expect(source).not.toContain("ledgerIsAsset ? (isAr ? 'وارد' : 'Inflow') : t('debit')");
    expect(source).not.toContain("ledgerIsAsset ? (isAr ? 'منصرف' : 'Outflow') : t('credit')");
  });
});
