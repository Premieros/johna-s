export function normalizeInvoicePrefix(value?: string | null): string {
  return String(value || '')
    .replace(/[\r\n\t]/g, '')
    .trim()
    .slice(0, 12);
}

export function formatAllocatedInvoiceNumber(
  serverNumber: string | null | undefined,
  rawValue: number | string | null | undefined,
  branchPrefix?: string | null,
): string | null {
  const number = String(serverNumber || '').trim();
  const prefix = normalizeInvoicePrefix(branchPrefix);
  const rawFromPayload = Number(rawValue);
  const rawFromNumber = Number(number.match(/(\d+)$/)?.[1] || '');
  const raw = Number.isSafeInteger(rawFromPayload) && rawFromPayload > 0
    ? rawFromPayload
    : rawFromNumber;

  if (prefix && Number.isSafeInteger(raw) && raw > 0) return `${prefix}${raw}`;
  return number || null;
}
