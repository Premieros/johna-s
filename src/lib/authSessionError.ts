export function isAuthSessionError(input: unknown): boolean {
  if (!input) return false;

  const obj = typeof input === 'object' ? input as Record<string, unknown> : {};
  const status = Number(obj.status ?? obj.statusCode ?? 0);
  if (status === 401) return true;

  const text = [
    typeof input === 'string' ? input : '',
    typeof obj.code === 'string' ? obj.code : '',
    typeof obj.message === 'string' ? obj.message : '',
    typeof obj.details === 'string' ? obj.details : '',
    typeof obj.hint === 'string' ? obj.hint : '',
    typeof obj.error === 'string' ? obj.error : '',
  ].filter(Boolean).join(' ');

  return /\bAUTH_REQUIRED\b/i.test(text)
    || /\bPGRST301\b/i.test(text)
    || /\b(?:bad_jwt|invalid_jwt|session_not_found|refresh_token_not_found|refresh_token_already_used)\b/i.test(text)
    || /(?:jwt|access token|refresh token|session).*(?:expired|invalid|missing|not found)/i.test(text)
    || /(?:expired|invalid|missing).*(?:jwt|access token|refresh token|session)/i.test(text);
}
