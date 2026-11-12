import { rpc } from '../rpc';
import type { ApiResult } from '../types';
import type { RpcResult } from '@/lib/types';
type RecoveryResult = RpcResult & { jobs?: unknown[]; job?: unknown };
export const printRecovery = {
  list(p: { p_branch_id: string }): ApiResult<RecoveryResult> {
    return rpc('list_delayed_cloud_print_jobs', p);
  },
  reserve(p: { p_job_id: string; p_agent_id: string }): ApiResult<RecoveryResult> {
    return rpc('reserve_manual_cloud_print_job', p);
  },
  finish(p: { p_job_id: string; p_agent_id: string; p_confirmed: boolean }): ApiResult<RecoveryResult> {
    return rpc('finish_manual_cloud_print_job', p);
  },
};
