import { formatCurrency } from '@/lib/format';
import { userFacingErrorMessage, type ErrorLanguage } from '@/lib/userFacingError';

export type FinanceResult = {
  success?: boolean; error?: string; detail?: string; reference_number?: string;
  available?: number; requested?: number; open?: number;
};

export function financeRejectionMessage(result: FinanceResult | null, currency: string, lang: ErrorLanguage) {
  // This exact code means a missing finance permission; do not globally match
  // unrelated status restrictions such as PURCHASE_EDIT_STATUS_NOT_ALLOWED.
  if (result?.error === 'NOT_ALLOWED') return lang === 'ar'
    ? 'لا تملك صلاحية تنفيذ هذه العملية. راجع المسؤول.'
    : 'You do not have permission for this operation. Contact an administrator.';
  const message = userFacingErrorMessage(result?.error || result?.detail, lang);
  // Only server-provided business values; never expose SQL details or guess a balance.
  const value = result?.error === 'INSUFFICIENT_TREASURY_BALANCE' ? result.available : result?.open;
  if (value == null || !Number.isFinite(Number(value))) return message;
  if (!['INSUFFICIENT_TREASURY_BALANCE', 'PAYMENT_EXCEEDS_INVOICE', 'PAYMENT_EXCEEDS_AP', 'PAYMENT_EXCEEDS_AR'].includes(result?.error || '')) return message;
  const label = result?.error === 'INSUFFICIENT_TREASURY_BALANCE'
    ? (lang === 'ar' ? 'المتاح الآن' : 'Available now')
    : (lang === 'ar' ? 'المتبقي للسداد' : 'Remaining due');
  return `${message} ${label}: ${formatCurrency(Number(value), currency, lang)}.`;
}

export function exceedsMoney(amount: number, available: number) {
  return Math.round((amount + Number.EPSILON) * 100) > Math.round((available + Number.EPSILON) * 100);
}
