/** Failed sources never become an empty or partial successful report. */
export function requireReportData<T>(result: { data: T | null; error: { message?: string } | null }, signal?: AbortSignal): T {
  signal?.throwIfAborted();
  if (result.error) throw new Error(result.error.message || 'REPORT_SOURCE_FAILED');
  if (result.data === null || result.data === undefined) throw new Error('REPORT_SOURCE_INVALID');
  const value = result.data as { success?: boolean; error?: string; message?: string };
  if (value?.success === false) throw new Error(value.error || value.message || 'REPORT_SOURCE_FAILED');
  return result.data;
}
