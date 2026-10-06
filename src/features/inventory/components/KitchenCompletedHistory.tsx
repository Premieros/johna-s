import { memo, useCallback, useState } from 'react';
import { catalog } from '@/api/domains/catalog';
import { useAuth } from '@/context/AuthContext';
import { useLatestRead } from '@/hooks/useLatestRead';
import { businessDateISO, reportDateRangeUtc } from '@/lib/businessTime';
import { useHistoryAccess } from '@/lib/useHistoryAccess';
import { userFacingErrorMessage } from '@/lib/userFacingError';
import { Input } from '@/components/Input';
import { Button } from '@/components/Button';

export const KitchenCompletedHistory = memo(function KitchenCompletedHistory({ branchId, station, ar }: { branchId: string; station: string; ar: boolean }) {
  const { user } = useAuth();
  const history = useHistoryAccess();
  const [from, setFrom] = useState(businessDateISO);
  const [to, setTo] = useState(businessDateISO);
  const [applied, setApplied] = useState(() => ({ from: businessDateISO(), to: businessDateISO(), page: 0 }));
  const read = useCallback(async () => {
    if (!user?.id) throw new Error('AUTH_REQUIRED');
    const range = history.clampRange(applied.from, applied.to);
    const bounds = reportDateRangeUtc(range.from, range.to);
    const { data, error } = await catalog.getKitchenCompletedHistory({ p_branch_id: branchId, p_station: station || null,
      p_from_ts: bounds.startIso, p_to_ts: bounds.endExclusiveIso, p_page: applied.page });
    if (error) throw error;
    return data ?? { rows: [], count: 0 };
  }, [branchId, station, applied, user?.id, history]);
  const result = useLatestRead(read);
  const invalidPeriod = !from || !to || from > to;
  return <div data-testid="kds-completed-history" className="space-y-3">
    <p className="text-sm text-ui-muted">{ar ? 'الطلبات التي تم تقديمها أو إلغاؤها. الفترة حسب آخر تحديث للطلب.' : 'Served or cancelled orders. Period follows the last order update.'}</p>
    <div className="flex flex-wrap items-end gap-2">
      <Input type="date" label={ar ? 'من' : 'From'} value={from} onChange={e => setFrom(e.target.value)} />
      <Input type="date" label={ar ? 'إلى' : 'To'} value={to} onChange={e => setTo(e.target.value)} />
      <Button disabled={invalidPeriod} onClick={() => setApplied({ from, to, page: 0 })}>{ar ? 'عرض الفترة' : 'Apply period'}</Button>
      <Button variant="outline" disabled={result.loading} onClick={() => void result.reload()}>{ar ? 'تحديث المنتهية' : 'Refresh completed'}</Button>
    </div>
    {result.loading && <p role="status">{ar ? 'جاري التحميل...' : 'Loading...'}</p>}
    {result.error != null && <div role="alert" className="text-ui-danger">{userFacingErrorMessage(result.error, ar ? 'ar' : 'en')} <Button onClick={() => void result.reload()}>{ar ? 'إعادة المحاولة' : 'Retry'}</Button></div>}
    {result.data && <>
      <nav aria-label={ar ? 'صفحات الطلبات المنتهية' : 'Completed order pages'} className="flex flex-wrap items-center gap-3">
        <span>{ar ? 'الإجمالي' : 'Total'}: {result.data.count}</span>
        <Button variant="outline" disabled={applied.page === 0 || result.loading} onClick={() => setApplied(p => ({ ...p, page: p.page - 1 }))}>{ar ? 'السابق' : 'Previous'}</Button>
        <span>{applied.page + 1} / {Math.max(1, Math.ceil(result.data.count / 100))}</span>
        <Button variant="outline" disabled={(applied.page + 1) * 100 >= result.data.count || result.loading} onClick={() => setApplied(p => ({ ...p, page: p.page + 1 }))}>{ar ? 'التالي' : 'Next'}</Button>
      </nav>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {result.data.rows.map(row => <div key={row.order_id} className="rounded-xl border border-ui-border bg-ui-surface p-4">
          <p className="text-lg font-bold">#{row.order_number}</p>
          {row.table_name && <p>{ar ? 'الطاولة' : 'Table'}: {row.table_name}</p>}
          <p>{row.kitchen_status === 'served' ? (ar ? 'تم التقديم' : 'Served') : (ar ? 'ملغي' : 'Cancelled')}</p>
          <time dateTime={row.updated_at} className="text-sm text-ui-muted">{new Date(row.updated_at).toLocaleString(ar ? 'ar-EG' : 'en-GB', { timeZone: 'Africa/Cairo' })}</time>
        </div>)}
      </div>
      {!result.data.rows.length && <p className="py-8 text-center text-ui-muted">{ar ? 'لا توجد طلبات منتهية متاحة في هذه الفترة والمحطة' : 'No completed orders available for this period and station'}</p>}
    </>}
  </div>;
});
