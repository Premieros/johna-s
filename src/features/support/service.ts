import { supabase } from '@/api';
import type { SupportSession } from './protocol';
export async function createRequest(branchId: string) {
  const { data: auth, error: authError } = await supabase.auth.getSession();
  if (authError || !auth.session?.user) throw new Error('AUTH_REQUIRED');
  const { data, error } = await supabase.from('live_support_sessions').insert({ branch_id: branchId, requester_id: auth.session?.user.id }).select('*').single();
  if (error) throw error;
  return data as SupportSession;
}
export async function readSession(id: string) {
  const { data, error } = await supabase.from('live_support_sessions').select('*').eq('id', id).single();
  if (error) throw error;
  return data as SupportSession;
}
export async function listRequests() {
  const { data, error } = await supabase.from('live_support_sessions').select('*').neq('state', 'closed').gt('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(50);
  if (error) throw error;
  return (data || []) as SupportSession[];
}
export async function changeSession(id: string, patch: { state?: SupportSession['state']; operator_id?: string }) {
  const { data, error } = await supabase.from('live_support_sessions').update(patch).eq('id', id).select('*').single();
  if (error) throw error;
  return data as SupportSession;
}
export async function signal(sessionId: string, payload: unknown) {
  const { data: auth } = await supabase.auth.getSession();
  if (!auth.session?.user) throw new Error('AUTH_REQUIRED');
  const { error } = await supabase.from('live_support_signals').insert({ session_id: sessionId, sender_id: auth.session?.user.id, payload });
  if (error) throw error;
}
export async function readSignals(sessionId: string, after: number, userId: string) {
  const { data, error } = await supabase.from('live_support_signals').select('id,payload').eq('session_id', sessionId).neq('sender_id', userId).gt('id', after).order('id').limit(100);
  if (error) throw error;
  return (data || []) as { id: number; payload: { type: string; sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } }[];
}
export async function audit(sessionId: string, event: 'view_granted' | 'control_requested' | 'control_granted' | 'control_revoked' | 'ended') {
  const { data: auth } = await supabase.auth.getSession();
  if (!auth.session?.user) throw new Error('AUTH_REQUIRED');
  const { error } = await supabase.from('live_support_events').insert({ session_id: sessionId, actor_id: auth.session?.user.id, event });
  if (error) throw error;
}
