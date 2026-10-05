import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ record: vi.fn() }));
vi.mock('@/api', () => ({ admin: { recordUserIssue: mocks.record } }));
vi.mock('@/lib/activeBranch', () => ({ getActiveBranchId: () => 'active-branch' }));
vi.mock('@/lib/userFacingError', () => ({ userFacingErrorMessage: () => 'Safe user-facing message' }));
import { classifyUserIssue, deriveUserIssueCode, reportUserIssue } from '@/lib/userIssueTelemetry';
beforeEach(() => { mocks.record.mockReset().mockResolvedValue({}); });
describe('safe structured issue diagnostics', () => {
  it.each([
    [{ code: 'PGRST116', message: 'JSON object requested, multiple rows returned' }, 'PGRST116'],
    [{ code: '42501', message: 'permission denied for relation orders' }, 'SQLSTATE_42501'],
    [{ code: 'P0001', message: 'Request rejected: KITCHEN_WAREHOUSE_MISMATCH' }, 'KITCHEN_WAREHOUSE_MISMATCH'],
    ['Request rejected: PERMISSION_DENIED', 'PERMISSION_DENIED'],
    [{ code: 'STOCK_INSUFFICIENT', message: 'Not enough stock' }, 'STOCK_INSUFFICIENT'],
    [new TypeError('Cannot read properties of undefined'), 'JS_TYPEERROR'],
    [new TypeError('Failed to fetch'), 'NETWORK_ERROR'],
    [new TypeError('Failed to fetch dynamically imported module: https://example.com/assets/page.js'), 'CHUNK_LOAD_ERROR'],
  ])('retains a useful identifier for %o', (source, code) => {
    expect(deriveUserIssueCode(source)).toBe(code);
  });
  it('classifies API, database and JavaScript failures as technical and business rejection as expected', () => {
    expect(classifyUserIssue({ code: 'PGRST116' })).toBe('technical');
    expect(classifyUserIssue({ code: '42501' })).toBe('technical');
    expect(classifyUserIssue(new ReferenceError('missing value'))).toBe('technical');
    expect(classifyUserIssue({ code: 'P0001', message: 'KITCHEN_WAREHOUSE_MISMATCH' })).toBe('expected');
  });
  it('submits safe fields and context without raw error, stack, details, request or token', async () => {
    const source = { code: 'PGRST116', message: 'secret=private-value', details: 'raw query', stack: 'raw stack', request: { token: 'private-token' } };
    await reportUserIssue(source, { action: 'pos_settlement_submit', branchId: 'order-branch', entityType: 'order', entityId: 'order-id' });
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ p_error_code: 'PGRST116', p_user_message: 'Safe user-facing message', p_action: 'pos_settlement_submit', p_branch_id: 'order-branch', p_entity_id: 'order-id' }));
    const payload = JSON.stringify(mocks.record.mock.calls[0][0]);
    for (const value of ['private-value', 'private-token', 'raw stack', 'raw query', 'request']) expect(payload).not.toContain(value);
  });
  it('absorbs telemetry failure instead of rejecting the primary workflow', async () => {
    mocks.record.mockRejectedValue(new Error('telemetry unavailable'));
    await expect(reportUserIssue(new TypeError('Cannot read properties'))).resolves.toBeUndefined();
  });
});
