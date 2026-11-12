import type { Language } from '@/lib/types';

/** Presentation only: retain original category values for filters and storage. */
export function expenseCategoryLabel(category: unknown, lang: Language): string {
  const value = String(category ?? '');
  const labels: Record<string, [string, string]> = {
    rent: ['إيجار', 'Rent'], utilities: ['مرافق', 'Utilities'],
    salaries: ['أجور ورواتب', 'Salaries'], supplies: ['مستلزمات', 'Supplies'],
    maintenance: ['صيانة', 'Maintenance'], marketing: ['تسويق', 'Marketing'],
    transport: ['انتقالات', 'Transport'], other: ['أخرى', 'Other'],
  };
  return labels[value]?.[lang === 'ar' ? 0 : 1] ?? value;
}
