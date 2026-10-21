import { describe, expect, it } from 'vitest';
import { exceedsMoney, financeRejectionMessage } from '@/features/accounting/services/financeFeedback';
import { userFacingErrorMessage } from '@/lib/userFacingError';
describe('financial business feedback', () => {
  it('explains insufficient funds using authoritative available balance, not SQL detail', () => {
    const message = financeRejectionMessage({ error: 'INSUFFICIENT_TREASURY_BALANCE', available: 50, requested: 100, detail: 'private SQL details' }, 'EGP', 'ar');
    expect(message).toContain('رصيد مصدر السداد لا يكفي');
    expect(message).toContain('المتاح الآن');
    expect(message).toContain('50');
    expect(message).not.toContain('private');
    expect(message).not.toContain('خطأ في النظام');
  });
  it('explains invoice limits and preserves the distinction from total party debt', () => {
    expect(financeRejectionMessage({ error: 'PAYMENT_EXCEEDS_INVOICE', open: 3500 }, 'EGP', 'ar')).toContain('الفاتورة المختارة');
    expect(userFacingErrorMessage('PAYMENT_EXCEEDS_AP', 'ar')).toContain('المستحق');
    expect(exceedsMoney(5900, 3500)).toBe(true);
    expect(exceedsMoney(89666.1, 89666.10)).toBe(false);
  });
  it('does not tell a user that an ambiguous financial request made no change', () => {
    const message = userFacingErrorMessage('FINANCE_RESULT_UNCONFIRMED', 'ar');
    expect(message).toContain('قبل إعادة المحاولة');
    expect(message).not.toContain('لم يتم تنفيذ');
  });
});
