/** Remote input is deliberately restricted to read-only navigation and scrolling. */
export const SUPPORT_ROUTES = new Set(['/dashboard', '/reports', '/inventory-center', '/inventory', '/products', '/raw-materials', '/costing', '/procurement-center', '/operations']);
export type SupportCommand = { type: 'navigate'; path: string } | { type: 'scroll'; delta: number };
export function parseSupportCommand(raw: string): SupportCommand | null {
  if (raw.length > 512) return null;
  try {
    const command = JSON.parse(raw);
    if (command?.type === 'navigate' && typeof command.path === 'string' && SUPPORT_ROUTES.has(command.path)) return { type: 'navigate', path: command.path };
    if (command?.type === 'scroll' && Number.isFinite(command.delta) && Math.abs(command.delta) <= 600) return { type: 'scroll', delta: command.delta };
  } catch { /* Untrusted peer data is never executable code. */ }
  return null;
}
export interface SupportSession {
  requester_name: string; branch_name: string; operator_name: string | null;
  id: string; branch_id: string; requester_id: string; operator_id: string | null;
  state: 'waiting' | 'claimed' | 'sharing' | 'closed';
  created_at: string; expires_at: string;
}
export function sessionIsLive(session: SupportSession, now = Date.now()) {
  return session.state !== 'closed' && Date.parse(session.expires_at) > now;
}
export const SUPPORT_ENABLED = import.meta.env.VITE_LIVE_SUPPORT_ENABLED === 'true';
