import { describe, expect, it } from 'vitest';
import { isAuthSessionError } from '@/lib/authSessionError';

describe('auth session error classification', () => {
  it('classifies expired/missing JWT and AUTH_REQUIRED responses', () => {
    expect(isAuthSessionError({ status: 401, message: 'Unauthorized' })).toBe(true);
    expect(isAuthSessionError({ code: 'PGRST301', message: 'JWT expired' })).toBe(true);
    expect(isAuthSessionError({ code: 'PGRST303', message: 'JWT claims invalid' })).toBe(true);
    expect(isAuthSessionError({ message: 'AUTH_REQUIRED' })).toBe(true);
    expect(isAuthSessionError({ code: 'session_not_found' })).toBe(true);
  });

  it('does not classify network or permission failures as expired sessions', () => {
    expect(isAuthSessionError({ message: 'Failed to fetch' })).toBe(false);
    expect(isAuthSessionError({ status: 403, message: 'PERMISSION_DENIED:users.manage' })).toBe(false);
    expect(isAuthSessionError({ code: '42501', message: 'row-level security violation' })).toBe(false);
  });
});
