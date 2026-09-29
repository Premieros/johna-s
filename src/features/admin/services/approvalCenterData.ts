import { supabase } from '@/api';

export type ApprovalQueueItem = {
  source_type: 'manager_approval' | 'waste' | 'stock_count' | 'warehouse_transfer';
  source_id: string;
  branch_id: string;
  title: string;
  status: string;
  requested_by: string | null;
  requested_at: string;
  required_permission: string;
  payload: Record<string, unknown>;
};

export type ApprovalDecisionResult = {
  success?: boolean;
  error?: string;
  detail?: string;
};

export type ApprovalPolicyRow = {
  id: string;
  scope: string;
  branch_id: string | null;
  min_amount: number | null;
  max_amount: number | null;
  approver_mode: 'permission' | 'user' | 'both';
  approver_permission: string | null;
  approver_user_id: string | null;
  priority: number;
  is_active: boolean;
};

export async function loadOperationalApprovalQueue(branchId: string | null): Promise<ApprovalQueueItem[]> {
  const { data, error } = await supabase.rpc('get_operational_approval_queue', { p_branch_id: branchId });
  if (error) throw error;
  return (data || []) as ApprovalQueueItem[];
}

export async function decideOperationalApproval(params: {
  sourceType: ApprovalQueueItem['source_type'];
  sourceId: string;
  approve: boolean;
  reason: string | null;
}): Promise<ApprovalDecisionResult> {
  const { data, error } = await supabase.rpc('decide_operational_approval', {
    p_source_type: params.sourceType,
    p_source_id: params.sourceId,
    p_approve: params.approve,
    p_reason: params.reason,
  });
  if (error) throw error;
  return (data || {}) as ApprovalDecisionResult;
}

export async function loadApprovalPolicyData(): Promise<{
  policies: ApprovalPolicyRow[];
  users: Array<{ id: string; full_name: string }>;
  userError: string | null;
}> {
  const [policyResult, userResult] = await Promise.all([
    supabase.from('approval_policies').select('*').order('priority').order('created_at'),
    supabase.from('users').select('id,full_name').eq('is_active', true).order('full_name'),
  ]);
  if (policyResult.error) throw policyResult.error;
  return {
    policies: (policyResult.data || []) as ApprovalPolicyRow[],
    users: userResult.error ? [] : ((userResult.data || []) as Array<{ id: string; full_name: string }>),
    userError: userResult.error?.message || null,
  };
}

export async function createApprovalPolicy(payload: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('approval_policies').insert(payload);
  if (error) throw error;
}

export async function setApprovalPolicyActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await supabase.from('approval_policies').update({ is_active: isActive }).eq('id', id);
  if (error) throw error;
}

export async function deleteApprovalPolicy(id: string): Promise<void> {
  const { error } = await supabase.from('approval_policies').delete().eq('id', id);
  if (error) throw error;
}
