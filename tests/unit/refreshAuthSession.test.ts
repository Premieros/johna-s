import { describe, expect, it } from 'vitest';
import { refreshAuthSession } from '@/lib/refreshAuthSession';

describe('refresh failure classification', () => {
  it.each([{ status: 503 }, { status: 429 }, { message: 'Failed to fetch' }, { code: '57014' }])('retains the session on unavailable refresh: %j', async (error) => {
    expect(await refreshAuthSession(async () => ({ data: { session: null }, error }))).toEqual({ status: 'unavailable' });
  });
  it('retains the session when the refresh transport throws', async () => {
    expect(await refreshAuthSession(async () => { throw new TypeError('Failed to fetch'); })).toEqual({ status: 'unavailable' });
  });
  it.each(['refresh_token_not_found', 'session_not_found', 'refresh_token_already_used'])('rejects genuinely revoked sessions: %s', async (code) => {
    expect(await refreshAuthSession(async () => ({ data: { session: null }, error: { code } }))).toEqual({ status: 'expired' });
  });
});
