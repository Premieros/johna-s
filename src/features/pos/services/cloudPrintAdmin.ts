import { supabase } from '@/api';

interface AdminQueueActionResult {
  success?: boolean;
  error?: string;
  detail?: string;
  status?: string;
  last_error?: string;
}

export async function retryCloudPrintJob(jobId: string): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('retry_cloud_print_job', { p_job_id: jobId });
  if (error) return { success: false, error: error.message };
  const result = (data ?? {}) as AdminQueueActionResult;
  return result.success
    ? { success: true }
    : { success: false, error: result.error || result.detail || 'PRINT_JOB_RETRY_FAILED' };
}

export async function cancelCloudPrintJob(jobId: string): Promise<{ success: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('cancel_cloud_print_job', { p_job_id: jobId });
  if (error) return { success: false, error: error.message };
  const result = (data ?? {}) as AdminQueueActionResult;
  return result.success
    ? { success: true }
    : { success: false, error: result.error || result.detail || 'PRINT_JOB_CANCEL_FAILED' };
}
