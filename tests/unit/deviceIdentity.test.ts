import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearOperationalDeviceIdentityForTests,
  ensureOperationalDeviceIdentity,
  readOperationalDeviceIdentity,
} from '@/core/runtime/deviceIdentity';

describe('operational device identity foundation', () => {
  beforeEach(() => {
    clearOperationalDeviceIdentityForTests();
  });

  it('creates and persists a stable local device identity', () => {
    const first = ensureOperationalDeviceIdentity({
      branchId: 'branch-a',
      deviceType: 'pos',
      appVersion: 'test-version',
    });
    const second = ensureOperationalDeviceIdentity();

    expect(first.device_id).toBeTruthy();
    expect(second.device_id).toBe(first.device_id);
    expect(second.branch_id).toBe('branch-a');
    expect(second.device_type).toBe('pos');
    expect(second.app_version).toBe('test-version');
    expect(readOperationalDeviceIdentity()?.device_id).toBe(first.device_id);
  });

  it('updates attribution metadata without replacing device identity', () => {
    const first = ensureOperationalDeviceIdentity({ branchId: 'branch-a', deviceType: 'browser' });
    const next = ensureOperationalDeviceIdentity({ branchId: 'branch-b', deviceType: 'admin', appVersion: 'v2' });

    expect(next.device_id).toBe(first.device_id);
    expect(next.branch_id).toBe('branch-b');
    expect(next.device_type).toBe('admin');
    expect(next.app_version).toBe('v2');
    expect(Date.parse(next.last_seen_at)).toBeGreaterThanOrEqual(Date.parse(first.last_seen_at));
  });

  it('fails open when localStorage writes are unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    expect(() => ensureOperationalDeviceIdentity({ deviceType: 'browser' })).not.toThrow();
    spy.mockRestore();
  });
});
