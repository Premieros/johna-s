import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.resolve(process.cwd(), 'src/features/admin/pages/ApprovalCenterPage.tsx'),
  'utf8',
);

describe('approval center permission-first contract', () => {
  it('does not authorize decisions from role labels', () => {
    expect(source).not.toContain('isAdminRole');
    expect(source).not.toMatch(/user\?\.role\s*===/);
    expect(source).not.toContain('useV2Can');
  });

  it('requires canonical approval permission plus the server-required permission', () => {
    expect(source).toContain("const canReviewApprovals = can('approvals.review')");
    expect(source).toContain('canReviewApprovals');
    expect(source).toContain('ALL_PERMISSIONS.includes(row.required_permission as Permission)');
    expect(source).toContain('can(row.required_permission as Permission)');
  });

  it('gates policy management behind approvals.policy.manage', () => {
    expect(source).toContain("const canManagePolicies = can('approvals.policy.manage')");
    expect(source).toContain('canManagePolicies && user');
  });
});
