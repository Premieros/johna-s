import { useSyncExternalStore } from 'react';
import { getReportPermissionVersion, subscribeReportPermissions } from '@/lib/reportRequestCache';
export function useReportPermissionVersion() {
  return useSyncExternalStore(subscribeReportPermissions, getReportPermissionVersion, getReportPermissionVersion);
}
