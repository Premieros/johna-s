import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ insert: vi.fn(), session: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabase: {
  auth: { getSession: state.session }, from: () => ({ insert: state.insert }),
} }));
import { logAudit } from '@/lib/audit';

describe('operation audit branch attribution', () => {
  beforeEach(() => {
    state.session.mockResolvedValue({ data: { session: { user: { id: 'actor', email: 'actor@test.local' } } } });
    state.insert.mockResolvedValue({ error: null });
  });

  it('uses the operation branch rather than actor/home or currently selected branch', async () => {
    await logAudit('update', 'shifts', 'shift', { branch_id: 'other', actual: 20 }, 'operation');
    expect(state.insert).toHaveBeenCalledWith(expect.objectContaining({ branch_id: 'operation', user_id: 'actor', entity_id: 'shift' }));
  });

  it('preserves an explicit branch carried by daily closing details', async () => {
    await logAudit('update', 'daily_closes', 'close', { branch_id: 'cleopatra' });
    expect(state.insert).toHaveBeenCalledWith(expect.objectContaining({ branch_id: 'cleopatra' }));
  });

  it('reports rejected inserts without inviting a retry of a successful close', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    state.insert.mockResolvedValue({ error: { code: '42501', message: 'private details' } });
    await expect(logAudit('update', 'shifts', 'shift', {}, 'smouha')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('AUDIT_WRITE_FAILED', '42501');
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('private details'));
  });
});
