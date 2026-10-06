export function expenseAccountLabel(expense: Record<string, unknown>, lang: string): string {
  const relation = expense.expense_account;
  const account = (Array.isArray(relation) ? relation[0] : relation) as { code?: string; name?: string; name_en?: string } | null | undefined;
  if (!account) return lang === 'ar' ? 'غير متاح' : 'Unavailable';
  const name = lang === 'ar' ? account.name : account.name_en || account.name;
  return [account.code, name].filter(Boolean).join(' — ') || (lang === 'ar' ? 'غير متاح' : 'Unavailable');
}
