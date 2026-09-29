import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('system health device identity integration', () => {
  it('surfaces the local operational device identity without remote persistence', () => {
    const health = readFileSync('src/features/admin/pages/SystemHealthPage.tsx', 'utf8');
    const identity = readFileSync('src/core/runtime/deviceIdentity.ts', 'utf8');

    expect(health).toContain('ensureOperationalDeviceIdentity');
    expect(health).toContain("key: 'device_identity'");
    expect(identity).toContain("localStorage");
    expect(identity).not.toContain("supabase");
    expect(identity).not.toContain("fetch(");
  });
});
