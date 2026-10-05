import { useCallback, useLayoutEffect, useState } from 'react';
import { accounting } from '@/api/domains/accounting';
import { useLatestRead } from '@/hooks/useLatestRead';
import type { JournalCursor, JournalPageDto } from '@/lib/types';

interface Scope {
  branchId: string | null;
  userId: string | undefined;
  from: string;
  to: string;
  referenceType: string;
  search: string;
}
const empty: JournalPageDto = {
  rows: [], summary: { total_count: 0, debit_total: 0, credit_total: 0, balance: 0 },
  page_size: 100, has_more: false, next_cursor: null,
};

export function useJournalPageRead({ branchId, userId, from, to, referenceType, search }: Scope) {
  const scope = JSON.stringify([branchId, userId, from, to, referenceType, search]);
  const [navigation, setNavigation] = useState<{ scope: string; cursors: (JournalCursor | null)[]; index: number }>({ scope, cursors: [null], index: 0 });
  // Derive the first page immediately for a new scope; never issue a new-branch
  // request with an old branch's cursor before an effect has reset state.
  const index = navigation.scope === scope ? navigation.index : 0;
  const cursor = navigation.scope === scope ? navigation.cursors[index] : null;
  useLayoutEffect(() => {
    setNavigation(current => current.scope === scope ? current : { scope, cursors: [null], index: 0 });
  }, [scope]);
  const read = useCallback(async () => {
    if (!branchId || !userId) return empty;
    const { data, error } = await accounting.getJournalsPage({
      p_branch_id: branchId, p_from_date: from || null, p_to_date: to || null,
      p_reference_type: referenceType || null, p_search: search || null, p_page_size: 100,
      p_after_entry_date: cursor?.entry_date ?? null,
      p_after_entry_number: cursor?.entry_number ?? null, p_after_id: cursor?.id ?? null,
    });
    if (error) throw error;
    if (!data || !Array.isArray(data.rows) || data.rows.length > 100 || !data.summary
      || ![data.summary.total_count, data.summary.debit_total, data.summary.credit_total, data.summary.balance].every(Number.isFinite)) {
      throw new Error('JOURNAL_PAGE_RESPONSE_INVALID');
    }
    return data;
  }, [branchId, userId, from, to, referenceType, search, cursor]);
  const latest = useLatestRead(read, search ? 300 : 0);
  const next = () => {
    if (latest.loading || latest.error || !latest.data?.has_more || !latest.data.next_cursor) return;
    const nextCursor = latest.data.next_cursor;
    setNavigation(current => {
      const currentIndex = current.scope === scope ? current.index : 0;
      if (currentIndex !== index) return current;
      const cursors = current.scope === scope ? current.cursors.slice(0, index + 1) : [null];
      return { scope, cursors: [...cursors, nextCursor], index: index + 1 };
    });
  };
  const previous = () => {
    if (latest.loading || index === 0) return;
    setNavigation(current => current.scope === scope && current.index === index
      ? { ...current, index: index - 1 } : current);
  };
  const refresh = () => {
    if (index > 0) setNavigation({ scope, cursors: [null], index: 0 });
    else void latest.reload();
  };
  return { ...latest, scope, index, next, previous, refresh };
}
