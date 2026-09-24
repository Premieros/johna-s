import { supabase } from '@/api';
import type {
  MyWorkAuthorizationState,
  WorkAuthorizationClient,
  WorkAuthorizationSnapshot,
} from './workAuthorizationContract';

type RpcEnvelope<T> = {
  success?: boolean;
  error?: string;
  detail?: string;
  data?: T;
};

function unwrap<T>(value: unknown, fallbackMessage: string): T {
  const envelope = value as RpcEnvelope<T> | null;
  if (envelope && envelope.success === false) {
    throw new Error(envelope.detail || envelope.error || fallbackMessage);
  }
  if (envelope && envelope.data !== undefined) {
    return envelope.data;
  }
  return value as T;
}

async function callRpc<T>(
  name: string,
  params: Record<string, unknown>,
  fallbackMessage: string,
): Promise<T> {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw error;
  return unwrap<T>(data, fallbackMessage);
}

/**
 * Production provider contract.
 *
 * IMPORTANT:
 * - This provider is intentionally NOT mounted while the backend migration is absent.
 * - It calls RPCs only; it never reads or writes work-authorization tables directly.
 * - Server RPCs remain authoritative for permissions, branch scope, self-approval,
 *   shift binding, revocation and audit.
 */
export function createSupabaseWorkAuthorizationClient(): WorkAuthorizationClient {
  const getSnapshot: WorkAuthorizationClient['getSnapshot'] = async (query) =>
    callRpc<WorkAuthorizationSnapshot>(
      'get_work_authorization_snapshot',
      { p_branch_id: query?.branchId || null },
      'Failed to load work authorization snapshot',
    );

  const getMyState: WorkAuthorizationClient['getMyState'] = async (branchId) =>
    callRpc<MyWorkAuthorizationState>(
      'get_my_work_authorization_state',
      { p_branch_id: branchId },
      'Failed to load work authorization state',
    );

  const requestAuthorization: WorkAuthorizationClient['requestAuthorization'] = async (branchId) =>
    callRpc<MyWorkAuthorizationState>(
      'request_work_authorization',
      { p_branch_id: branchId },
      'Failed to request work authorization',
    );

  const approve: WorkAuthorizationClient['approve'] = async (requestId) => {
    await callRpc<unknown>(
      'decide_work_authorization',
      {
        p_request_id: requestId,
        p_approve: true,
        p_reason: null,
      },
      'Failed to approve work authorization',
    );
  };

  const reject: WorkAuthorizationClient['reject'] = async (requestId, reason) => {
    await callRpc<unknown>(
      'decide_work_authorization',
      {
        p_request_id: requestId,
        p_approve: false,
        p_reason: reason,
      },
      'Failed to reject work authorization',
    );
  };

  const revoke: WorkAuthorizationClient['revoke'] = async (authorizationId, reason) => {
    await callRpc<unknown>(
      'revoke_work_authorization',
      {
        p_authorization_id: authorizationId,
        p_reason: reason,
      },
      'Failed to revoke work authorization',
    );
  };

  const setRequirement: WorkAuthorizationClient['setRequirement'] = async (userId, branchId, required) => {
    await callRpc<unknown>(
      'set_work_authorization_requirement',
      {
        p_user_id: userId,
        p_branch_id: branchId,
        p_required: required,
      },
      'Failed to update work authorization policy',
    );
  };

  const subscribeToMyChanges: WorkAuthorizationClient['subscribeToMyChanges'] = async (branchId, onChange) => {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user?.id;
    if (!userId) return () => {};

    const channel = supabase
      .channel('work-authorization-' + userId + '-' + branchId)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'work_authorizations',
          filter: 'user_id=eq.' + userId,
        },
        (payload) => {
          const nextBranch = (payload.new as { branch_id?: string } | null)?.branch_id;
          const prevBranch = (payload.old as { branch_id?: string } | null)?.branch_id;
          if (nextBranch === branchId || prevBranch === branchId) onChange();
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'work_authorization_policies',
          filter: 'user_id=eq.' + userId,
        },
        (payload) => {
          const nextBranch = (payload.new as { branch_id?: string } | null)?.branch_id;
          const prevBranch = (payload.old as { branch_id?: string } | null)?.branch_id;
          if (nextBranch === branchId || prevBranch === branchId) onChange();
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  };

  return {
    getSnapshot,
    getMyState,
    requestAuthorization,
    approve,
    reject,
    revoke,
    setRequirement,
    subscribeToMyChanges,
  };
}
