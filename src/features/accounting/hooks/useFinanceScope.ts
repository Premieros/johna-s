import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';

/** Read tokens never cancel or repeat a financial write. */
export function useFinanceScope(branchId: string | null, view = '') {
  const { user } = useAuth();
  const key = JSON.stringify([user?.id ?? null, branchId, view]);
  const scope = useRef({ key, requests: new Map<string, number>() });
  if (scope.current.key !== key) scope.current = { key, requests: new Map() };
  const capture = useCallback((channel?: string) => {
    const current = scope.current;
    const sequence = channel ? (current.requests.get(channel) ?? 0) + 1 : 0;
    if (channel) current.requests.set(channel, sequence);
    return () => scope.current === current && (!channel || current.requests.get(channel) === sequence);
  }, []);
  useEffect(() => () => {
    scope.current = { key: scope.current.key, requests: new Map() };
  }, []);
  return { key, capture };
}
