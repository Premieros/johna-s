import { describe, expect, it } from 'vitest';
import { parseSupportCommand, sessionIsLive, SUPPORT_ENABLED, type SupportSession } from '@/features/support/protocol';
describe('live support fail-closed remote commands', () => {
  it('allows actual read-only navigation and bounded scrolling', () => {
    expect(parseSupportCommand('{"type":"navigate","path":"/inventory"}')).toEqual({ type: 'navigate', path: '/inventory' });
    expect(parseSupportCommand('{"type":"scroll","delta":500}')).toEqual({ type: 'scroll', delta: 500 });
  });
  it.each(['/pos', '/kitchen-display', '/users', '/settings', '/payments', '/shifts', '/reports?run=delete', 'https://evil.test', 'javascript:alert(1)'])('rejects privileged or external route %s', path => {
    expect(parseSupportCommand(JSON.stringify({ type: 'navigate', path }))).toBeNull();
  });
  it.each(['{"type":"click","selector":"button"}', '{"type":"eval","code":"alert(1)"}', '{"type":"scroll","delta":99999}', '{"type":"scroll","delta":"100"}', 'broken', 'x'.repeat(1000)])('rejects arbitrary input', value => expect(parseSupportCommand(value)).toBeNull());
  it('expires sessions and rejects a closed session', () => {
    const session = { state: 'sharing', expires_at: new Date(1000).toISOString() } as SupportSession;
    expect(sessionIsLive(session, 999)).toBe(true);
    expect(sessionIsLive(session, 1000)).toBe(false);
    expect(sessionIsLive({ ...session, state: 'closed' }, 999)).toBe(false);
  });
  it('is disabled by default', () => expect(SUPPORT_ENABLED).toBe(false));
});
