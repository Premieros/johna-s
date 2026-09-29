export type OperationalDeviceType = 'pos' | 'kds' | 'print_agent' | 'admin' | 'browser';

export type OperationalDeviceIdentity = {
  device_id: string;
  branch_id: string | null;
  device_type: OperationalDeviceType;
  app_version: string;
  first_seen_at: string;
  last_seen_at: string;
};

const STORAGE_KEY = 'johns_operational_device_identity_v1';

function createDeviceId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `device_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function readOperationalDeviceIdentity(): OperationalDeviceIdentity | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OperationalDeviceIdentity>;
    if (!parsed.device_id || !parsed.first_seen_at) return null;
    return {
      device_id: String(parsed.device_id),
      branch_id: parsed.branch_id ? String(parsed.branch_id) : null,
      device_type: (parsed.device_type || 'browser') as OperationalDeviceType,
      app_version: String(parsed.app_version || 'unknown'),
      first_seen_at: String(parsed.first_seen_at),
      last_seen_at: String(parsed.last_seen_at || parsed.first_seen_at),
    };
  } catch {
    return null;
  }
}

export function ensureOperationalDeviceIdentity(params: {
  branchId?: string | null;
  deviceType?: OperationalDeviceType;
  appVersion?: string;
} = {}): OperationalDeviceIdentity {
  const existing = readOperationalDeviceIdentity();
  const timestamp = nowIso();
  const next: OperationalDeviceIdentity = existing
    ? {
        ...existing,
        branch_id: params.branchId ?? existing.branch_id,
        device_type: params.deviceType ?? existing.device_type,
        app_version: params.appVersion ?? existing.app_version,
        last_seen_at: timestamp,
      }
    : {
        device_id: createDeviceId(),
        branch_id: params.branchId ?? null,
        device_type: params.deviceType ?? 'browser',
        app_version: params.appVersion ?? 'unknown',
        first_seen_at: timestamp,
        last_seen_at: timestamp,
      };

  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Identity is observability metadata only; storage failure must never block operation.
    }
  }

  return next;
}

export function clearOperationalDeviceIdentityForTests(): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // No-op.
  }
}
