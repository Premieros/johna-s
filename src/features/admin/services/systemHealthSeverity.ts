export type OperationalHealthStatus = 'ok' | 'warning' | 'error' | 'checking';

export function zeroCountStatus(
  value: unknown,
  severity: 'warning' | 'error' = 'error',
): OperationalHealthStatus {
  const count = Number(value ?? 0);
  const normalized = Number.isFinite(count) ? count : 0;
  return normalized === 0 ? 'ok' : severity;
}

export function pendingCountStatus(value: unknown): OperationalHealthStatus {
  const count = Number(value ?? 0);
  const normalized = Number.isFinite(count) ? count : 0;
  return normalized > 0 ? 'warning' : 'ok';
}

export function blockedCountStatus(value: unknown): OperationalHealthStatus {
  const count = Number(value ?? 0);
  const normalized = Number.isFinite(count) ? count : 0;
  return normalized > 0 ? 'error' : 'ok';
}

export function presenceStatus(value: unknown): OperationalHealthStatus {
  return value ? 'ok' : 'warning';
}
