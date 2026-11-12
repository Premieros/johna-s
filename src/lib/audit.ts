import { supabase } from './supabase';

export async function logAudit(action: string, entity: string, entityId?: string, details?: Record<string, unknown>, branchId?: string | null): Promise<void> {
  try {
    // Identity is informational here; RLS remains the authority for the insert.
    // Avoid an extra remote auth request after a successful business operation.
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    const { error } = await supabase.from('audit_log').insert({
      user_id: user?.id || null,
      user_email: user?.email || null,
      action,
      entity,
      entity_id: entityId || null,
      details: details || null,
      branch_id: branchId ?? (typeof details?.branch_id === 'string' ? details.branch_id : null),
    });
    if (error) console.warn('AUDIT_WRITE_FAILED', error.code);
  } catch {
    // Never turn a completed business operation into a retry/duplicate action.
    console.warn('AUDIT_WRITE_FAILED');
  }
}
