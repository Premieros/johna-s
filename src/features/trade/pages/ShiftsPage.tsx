import { useEffect, useMemo, useState } from 'react';
import { Timer, Play, Square, Printer, FileText, CalendarCheck, AlertTriangle } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel, DesignPagination } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import { Button } from '@/components/Button';
import { Input, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { BranchBadge } from '@/components/BranchBadge';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import type { Shift, RpcResult } from '@/lib/types';
import { buildThermalZReportText, buildA4ZReportHtml } from '../services/shiftClosingReport';
import { fetchShiftClosingReportServer } from '../services/shiftClosingFinancials';
import { buildA4DayClosingReportHtml, fetchDayClosingReportServer } from '../services/dayClosingReport';
import { enqueueCloudReportPrint } from '../../pos/services/cloudPrint';

interface ShiftUserRow { id: string; full_name: string | null; email: string | null; }
interface ActiveShiftPayload { open?: boolean; shift?: { id?: string; expected?: number }; }
interface ShiftCloseResult extends RpcResult {
  open_order_count?: number;
  open_table_count?: number;
  open_orders_preserved?: boolean;
}
interface CloseBlock { openOrderCount: number; openTableCount: number; }

export function ShiftsPage() {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const { user } = useAuth();
  const branchFilter = useBranchFilter();
  const can = useCan();
  const isAr = lang === 'ar';

  const { rows: items, loading, error, total, hasMore, loadMore, loadingMore, refresh: reloadShifts } = usePaginatedRows<Shift>({
    table: 'shifts',
    select: 'id, branch_id, cashier_id, opened_at, closed_at, opening_amount, expected_amount, actual_amount, difference, status, notes, created_at',
    order: { column: 'opened_at', ascending: false },
    branch_id: branchFilter,
    pageSize: 100,
  });
  const [search, setSearch] = useState('');
  const { branches } = useBranches();
  const { effectiveSettings, branchSettingsMap } = useSettings();
  const currency = effectiveSettings(branchFilter)?.currency || 'EGP';
  const targetBranchId = branchFilter || user?.branch_id || '';
  const targetBusinessDaySettings = targetBranchId ? branchSettingsMap[targetBranchId] : null;
  const [users, setUsers] = useState<ShiftUserRow[]>([]);
  const [liveExpectedByShift, setLiveExpectedByShift] = useState<Record<string, number>>({});

  const [openModal, setOpenModal] = useState(false);
  const [openForm, setOpenForm] = useState({ opening_amount: 0, notes: '' });
  const [closeTarget, setCloseTarget] = useState<Shift | null>(null);
  const [closeForm, setCloseForm] = useState({ actual_amount: 0, notes: '' });
  const [closeBlock, setCloseBlock] = useState<CloseBlock | null>(null);
  const [closing, setClosing] = useState(false);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [dayCloseModal, setDayCloseModal] = useState(false);
  const [dayClosing, setDayClosing] = useState(false);
  const [dayDate, setDayDate] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }));

  async function loadMeta() {
    const { data } = await supabase.from('users').select('id, full_name, email');
    setUsers((data as ShiftUserRow[]) || []);
  }
  useEffect(() => { void loadMeta(); }, []);

  useEffect(() => {
    let cancelled = false;
    const openItems = items.filter((shift) => shift.status === 'open' && shift.branch_id);
    if (openItems.length === 0) {
      setLiveExpectedByShift({});
      return () => { cancelled = true; };
    }
    void Promise.all(openItems.map(async (shift) => {
      const fallback = Number(shift.expected_amount ?? shift.opening_amount ?? 0);
      const { data, error: activeError } = await api.pos.getActiveShift({ p_branch_id: shift.branch_id });
      const active = data as unknown as ActiveShiftPayload | null;
      if (activeError || !active?.open || active.shift?.id !== shift.id) return [shift.id, fallback] as const;
      return [shift.id, Number(active.shift.expected ?? fallback)] as const;
    })).then((entries) => {
      if (!cancelled) setLiveExpectedByShift(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [items]);

  const getExpectedAmount = (shift: Shift) => {
    const stored = Number(shift.expected_amount ?? shift.opening_amount ?? 0);
    return shift.status === 'open' ? (liveExpectedByShift[shift.id] ?? stored) : stored;
  };

  const joinedItems = useMemo(() => {
    const cashierById = new Map(users.map((u) => [u.id, u]));
    return items.map((s) => ({
      ...s,
      branch: branches.find((b) => b.id === s.branch_id),
      cashier: cashierById.get(s.cashier_id) as unknown as Shift['cashier'],
    }));
  }, [items, users, branches]);

  const openShift = async () => {
    if (!can('shifts.open')) return;
    if (!targetBranchId) { show(t('selectBranchFirst'), 'error'); return; }
    const existingOpen = items.find((shift) => shift.branch_id === targetBranchId && shift.status === 'open');
    if (existingOpen) {
      show(isAr ? 'يوجد شفت مفتوح بالفعل لهذا الفرع. يجب إغلاقه قبل فتح شفت جديد.' : 'This branch already has an open shift. Close it before opening another.', 'error');
      setOpenModal(false);
      return;
    }
    const { data, error: openError } = await api.shifts.open({
      p_branch_id: targetBranchId,
      p_opening_amount: openForm.opening_amount || 0,
      p_notes: openForm.notes || null,
    });
    if (openError) { show(openError.message, 'error'); return; }
    const res = data as RpcResult | null;
    if (!res?.success) {
      show(res?.detail || res?.error || t('error'), 'error');
      if (res?.error === 'SHIFT_ALREADY_OPEN') { setOpenModal(false); reloadShifts(); }
      return;
    }
    await logAudit('create', 'shifts', res.shift_id || '', { opening_amount: openForm.opening_amount });
    show(t('shiftOpened'), 'success');
    setOpenModal(false);
    setOpenForm({ opening_amount: 0, notes: '' });
    reloadShifts();
  };

  const openCloseModal = async (shift: Shift) => {
    let expected = getExpectedAmount(shift);
    if (shift.status === 'open' && shift.branch_id) {
      const { data, error: activeError } = await api.pos.getActiveShift({ p_branch_id: shift.branch_id });
      const active = data as unknown as ActiveShiftPayload | null;
      if (!activeError && active?.open && active.shift?.id === shift.id) {
        expected = Number(active.shift.expected ?? expected);
        setLiveExpectedByShift((current) => ({ ...current, [shift.id]: expected }));
      }
    }
    setCloseTarget(shift);
    setCloseBlock(null);
    setCloseForm({ actual_amount: expected, notes: '' });
  };

  const finishClose = async (res: ShiftCloseResult, preservedOpenOrders: boolean) => {
    if (!closeTarget) return;
    await logAudit('update', 'shifts', closeTarget.id, {
      expected: res.expected,
      actual: res.actual,
      difference: res.difference,
      open_orders_preserved: preservedOpenOrders,
      open_order_count: res.open_order_count ?? 0,
      open_table_count: res.open_table_count ?? 0,
    });
    show(
      preservedOpenOrders
        ? (isAr ? 'تم إغلاق الوردية مع إبقاء الطلبات والطاولات المفتوحة كما هي' : 'Shift closed; open orders and tables were preserved')
        : t('shiftClosed'),
      'success',
    );
    setCloseTarget(null);
    setCloseBlock(null);
    setCloseForm({ actual_amount: 0, notes: '' });
    reloadShifts();
  };

  const closeShift = async () => {
    if (!closeTarget || closing) return;
    setClosing(true);
    try {
      const { data, error: closeError } = await api.shifts.close({
        p_shift_id: closeTarget.id,
        p_actual_amount: closeForm.actual_amount,
        p_notes: closeForm.notes || null,
      });
      if (closeError) { show(closeError.message, 'error'); return; }
      const res = data as ShiftCloseResult | null;
      if (!res?.success) {
        if (res?.error === 'OPEN_ORDERS_BLOCK_SHIFT_CLOSE') {
          const block = {
            openOrderCount: Number(res.open_order_count ?? 0),
            openTableCount: Number(res.open_table_count ?? 0),
          };
          setCloseBlock(block);
          show(
            isAr
              ? `تعذر إغلاق الوردية: يوجد ${block.openOrderCount} طلب مفتوح/معلق على ${block.openTableCount} طاولة.`
              : `Shift close blocked: ${block.openOrderCount} open/held order(s) on ${block.openTableCount} table(s).`,
            'error',
          );
          return;
        }
        show(res?.detail || res?.error || t('error'), 'error');
        return;
      }
      await finishClose(res, false);
    } finally {
      setClosing(false);
    }
  };

  const handlePrintZReport = async (shift: Shift, format: 'thermal' | 'a4') => {
    setPrintingId(shift.id);
    try {
      const summary = await fetchShiftClosingReportServer(shift.id);
      if (format === 'thermal') {
        const text = buildThermalZReportText(summary, currency, lang);
        const queued = await enqueueCloudReportPrint({
          branchId: shift.branch_id,
          payload: { text, paperWidthMm: 80, copies: 1 },
          idempotencyKey: `zreport:${shift.id}:${summary.closedAt || 'open'}:${Date.now()}`,
        });
        if (!queued.accepted) {
          show(
            isAr
              ? `تعذر إرسال Z-Report لمحطة الكاشير: ${queued.error || 'PRINT_QUEUE_FAILED'}`
              : `Could not queue Z-Report to cashier station: ${queued.error || 'PRINT_QUEUE_FAILED'}`,
            'error',
          );
          return;
        }
        show(
          isAr ? 'تم إرسال Z-Report إلى محطة طباعة الكاشير' : 'Z-Report queued to the cashier print station',
          'success',
        );
        return;
      }

      const html = buildA4ZReportHtml(summary, currency, lang);
      const w = window.open('', '_blank', 'width=900,height=800');
      if (w) { w.document.write(html); w.document.close(); }
    } catch (err: unknown) {
      show(err instanceof Error ? err.message : 'Error generating report', 'error');
    } finally {
      setPrintingId(null);
    }
  };

  const printDayReport = async () => {
    if (!targetBranchId) { show(t('selectBranchFirst'), 'error'); return; }
    try {
      const report = await fetchDayClosingReportServer(targetBranchId, dayDate);
      const html = buildA4DayClosingReportHtml(report, currency, lang);
      const w = window.open('', '_blank', 'width=1000,height=850');
      if (w) { w.document.write(html); w.document.close(); }
    } catch (err: unknown) {
      show(err instanceof Error ? err.message : (isAr ? 'تعذر تحميل تقرير اليوم' : 'Could not load day report'), 'error');
    }
  };

  const closeDay = async () => {
    if (!targetBranchId || dayClosing) { if (!targetBranchId) show(t('selectBranchFirst'), 'error'); return; }
    setDayClosing(true);
    try {
      const { data, error: closeError } = await api.shifts.dayClose({
        p_branch_id: targetBranchId,
        p_business_date: dayDate,
      });
      if (closeError) { show(closeError.message, 'error'); return; }
      const res = data as (RpcResult & { daily_close_id?: string; already_closed?: boolean }) | null;
      if (!res?.success) {
        if (res?.error === 'OPEN_SHIFTS_REMAIN') {
          show(isAr ? 'لا يمكن إغلاق اليوم قبل إغلاق الشفت المفتوح في الفرع.' : 'Close the branch open shift before day close.', 'error');
          return;
        }
        if (res?.error === 'NO_SHIFTS_FOR_DAY') {
          show(isAr ? 'لا توجد شفتات لهذا اليوم المالي، لذلك لا يمكن إغلاقه بوضع أول شفت/آخر شفت.' : 'No shifts exist for this business date, so shift-span day close cannot run.', 'error');
          return;
        }
        if (res?.error === 'BUSINESS_DAY_NOT_FINISHED') {
          show(isAr ? 'وقت نهاية اليوم المالي المحدد لم يأتِ بعد.' : 'The configured business-day end time has not been reached yet.', 'error');
          return;
        }
        show(res?.detail || res?.error || t('error'), 'error');
        return;
      }
      await logAudit('update', 'daily_closes', res.daily_close_id || '', {
        branch_id: targetBranchId,
        business_date: dayDate,
        already_closed: Boolean(res.already_closed),
      });
      show(res.already_closed
        ? (isAr ? 'اليوم مغلق بالفعل وتم تحميل نسخة الإغلاق الثابتة' : 'Day was already closed; immutable snapshot loaded')
        : (isAr ? 'تم إغلاق اليوم وحفظ التقرير الثابت' : 'Day closed and immutable snapshot saved'), 'success');
      setDayCloseModal(false);
      await printDayReport();
    } finally {
      setDayClosing(false);
    }
  };

  const filtered = joinedItems.filter((i) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return i.id?.toLowerCase().includes(s) || i.cashier?.full_name?.toLowerCase().includes(s) || i.branch?.name?.toLowerCase().includes(s);
  });

  const columns: Column<Shift>[] = [
    { key: 'opened_at', header: t('openedAt'), render: (r) => <span className="text-sm text-ui-muted">{formatDateTime(r.opened_at, lang)}</span> },
    { key: 'branch', header: t('branch'), render: (r) => <BranchBadge name={r.branch?.name || '-'} /> },
    { key: 'cashier', header: t('cashier'), render: (r) => r.cashier?.full_name || r.cashier?.email || '-' },
    { key: 'status', header: t('shiftStatus'), render: (r) => <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.status === 'open' ? 'bg-ui-success-soft text-ui-success' : 'bg-ui-page-alt text-ui-muted'}`}>{t(r.status === 'open' ? 'open' : 'closed')}</span> },
    { key: 'opening_amount', header: t('openingAmount'), render: (r) => <span className="text-sm">{formatCurrency(r.opening_amount, currency, lang)}</span> },
    { key: 'expected_amount', header: t('expectedAmount'), render: (r) => <span className="text-sm">{formatCurrency(getExpectedAmount(r), currency, lang)}</span> },
    { key: 'actual_amount', header: t('actualAmount'), render: (r) => <span className="text-sm">{formatCurrency(r.actual_amount ?? 0, currency, lang)}</span> },
    { key: 'difference', header: t('difference'), render: (r) => <span className={`text-sm font-semibold ${Math.abs(r.difference) > 0.009 ? 'text-ui-danger' : 'text-ui-success'}`}>{formatCurrency(r.difference, currency, lang)}</span> },
    { key: 'closed_at', header: t('closedAt'), render: (r) => r.closed_at ? <span className="text-sm text-ui-subtle">{formatDateTime(r.closed_at, lang)}</span> : '-' },
    { key: 'actions', header: t('actions'), render: (r) => (
      <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => handlePrintZReport(r, 'thermal')} disabled={printingId === r.id} className="p-1.5 rounded-md hover:bg-ui-info-soft text-ui-info transition" title={isAr ? 'طباعة إيصال Z-Report حراري' : 'Print Thermal Z-Report'}><Printer className="w-4 h-4" /></button>
        <button onClick={() => handlePrintZReport(r, 'a4')} disabled={printingId === r.id} className="p-1.5 rounded-md hover:bg-ui-primary-soft text-ui-primary transition" title={isAr ? 'طباعة تقرير إغلاق A4 تفصيلي' : 'Print A4 Full Closing Report'}><FileText className="w-4 h-4" /></button>
        {r.status === 'open' && can('shifts.close') && (
          <button onClick={() => { void openCloseModal(r); }} className="p-1.5 rounded-md hover:bg-ui-danger-soft text-ui-danger transition" title={isAr ? 'إغلاق الوردية' : t('closeShift')}><Square className="w-4 h-4" /></button>
        )}
      </div>
    )},
  ];

  const openShifts = items.filter((s) => s.status === 'open');
  const targetOpenShift = openShifts.find((s) => s.branch_id === targetBranchId) || null;

  return (
    <DesignSurface testId="shifts-page">
      <DesignPageHeader
        title={isAr ? 'إدارة الورديات واليومية' : t('shifts')}
        subtitle={isAr ? 'إدارة الورديات وتقارير الإغلاق؛ إغلاق اليوم المالي يبقى منفصلًا عن إغلاق الوردية' : 'Manage shifts and closing reports; financial day close remains separate from shift close'}
        actions={<div className="flex flex-wrap gap-2">
          {(can('shifts.day_close') || can('shifts.report.shift')) && targetBranchId && (
            <Button variant="outline" onClick={() => { void printDayReport(); }}><FileText className="w-4 h-4" /> {isAr ? 'تقرير اليومية الكامل' : 'Full Day Report'}</Button>
          )}
          {can('shifts.day_close') && targetBranchId && (
            <Button variant="outline" onClick={() => {
              if (targetBusinessDaySettings?.business_day_mode === 'shift_span' && targetOpenShift?.opened_at) {
                setDayDate(new Date(targetOpenShift.opened_at).toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' }));
              }
              setDayCloseModal(true);
            }}><CalendarCheck className="w-4 h-4" /> {isAr ? 'إغلاق اليوم' : 'Close Day'}</Button>
          )}
          {can('shifts.open') && !targetOpenShift && (
            <Button onClick={() => setOpenModal(true)}><Play className="w-4 h-4" /> {t('openShift')}</Button>
          )}
        </div>}
      />

      {openShifts.length > 0 && (
        <DesignPanel className="border-brand-200 dark:border-brand-800 bg-brand-50/50 dark:bg-brand-900/10" testId="shifts-open-banner">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3"><Timer className="w-6 h-6 text-brand-600 dark:text-brand-400" /><div><p className="font-semibold text-brand-800 dark:text-brand-300">{t('open')} · {formatDateTime(openShifts[0].opened_at, lang)}</p><p className="text-sm text-brand-700 dark:text-brand-400">{t('expectedAmount')}: {formatCurrency(getExpectedAmount(openShifts[0]), currency, lang)}</p></div></div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => handlePrintZReport(openShifts[0], 'thermal')}><Printer className="w-4 h-4" /> {isAr ? 'إيصال Z-Report' : 'Thermal Z-Report'}</Button>
              {can('shifts.close') && <Button variant="danger" size="sm" onClick={() => { void openCloseModal(openShifts[0]); }}><Square className="w-4 h-4" /> {isAr ? 'إغلاق الوردية' : t('closeShift')}</Button>}
            </div>
          </div>
        </DesignPanel>
      )}

      <DesignPanel testId="shifts-search-panel"><div className="flex flex-col sm:flex-row gap-3"><DesignSearch value={search} onChange={setSearch} className="flex-1" label={t('search')} placeholder={isAr ? 'بحث بالفرع أو الكاشير...' : 'Search by branch or cashier...'} testId="shifts-search" /></div></DesignPanel>
      <DesignPanel testId="shifts-table-panel"><DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')} /><DesignPagination loaded={items.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} /></DesignPanel>

      <Modal open={openModal} onClose={() => setOpenModal(false)} title={t('openShift')}>
        <div className="space-y-4">
          <div className="p-4 bg-ui-page-alt rounded-lg text-sm text-ui-muted">{isAr ? `الفرع: ${branches.find((b) => b.id === (branchFilter || user?.branch_id))?.name || '-'}` : `Branch: ${branches.find((b) => b.id === (branchFilter || user?.branch_id))?.name || '-'}`}</div>
          <Input type="number" min={0} step="0.01" label={t('openingAmount')} value={String(openForm.opening_amount)} onChange={(e) => setOpenForm({ ...openForm, opening_amount: Number(e.target.value) })} />
          <Textarea label={t('notes')} value={openForm.notes} onChange={(e) => setOpenForm({ ...openForm, notes: e.target.value })} rows={2} />
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpenModal(false)}>{t('cancel')}</Button><Button onClick={openShift}><Play className="w-4 h-4" /> {t('openShift')}</Button></div>
        </div>
      </Modal>

      <Modal open={dayCloseModal} onClose={() => { if (!dayClosing) setDayCloseModal(false); }} title={isAr ? 'إغلاق اليوم المالي' : 'Financial Day Close'}>
        <div className="space-y-4">
          <div className="rounded-lg border border-ui-border bg-ui-page-alt p-4 text-sm text-ui-muted">
            {isAr
              ? 'إغلاق اليوم لا يخفي أي بيانات: التقرير يحفظ كل الشفتات والمبيعات والمصروفات والمستخدمين ومشتريات الكاش. يجب إغلاق كل الشفتات أولًا.'
              : 'Day close keeps full detail: shifts, sales, expenses, users and cash purchases. Every shift must be closed first.'}
          </div>
          <Input type="date" label={isAr ? 'تاريخ العمل' : 'Business Date'} value={dayDate} onChange={(e) => setDayDate(e.target.value)} />
          <div className="p-3 bg-ui-page-alt rounded-lg text-sm space-y-1">
            <div><span className="text-ui-muted">{isAr ? 'الفرع:' : 'Branch:'}</span>{' '}
              <strong>{branches.find((b) => b.id === targetBranchId)?.name || '-'}</strong>
            </div>
            <div><span className="text-ui-muted">{isAr ? 'طريقة اليوم المالي:' : 'Business day mode:'}</span>{' '}
              <strong>{targetBusinessDaySettings?.business_day_mode === 'shift_span'
                ? (isAr ? `من أول شفت بعد ${targetBusinessDaySettings?.business_day_start || '09:00'} إلى آخر شفت` : `First shift after ${targetBusinessDaySettings?.business_day_start || '09:00'} → last shift`)
                : (isAr ? `وقت ثابت ${targetBusinessDaySettings?.business_day_start || '00:00'} → ${targetBusinessDaySettings?.business_day_end || '00:00'}` : `Fixed ${targetBusinessDaySettings?.business_day_start || '00:00'} → ${targetBusinessDaySettings?.business_day_end || '00:00'}`)}</strong>
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" disabled={dayClosing} onClick={() => setDayCloseModal(false)}>{t('cancel')}</Button>
            <Button variant="outline" disabled={dayClosing} onClick={() => { void printDayReport(); }}><FileText className="w-4 h-4" /> {isAr ? 'معاينة التقرير الكامل' : 'Preview Full Report'}</Button>
            <Button variant="danger" disabled={dayClosing} onClick={() => { void closeDay(); }}><CalendarCheck className="w-4 h-4" /> {isAr ? 'تأكيد إغلاق اليوم وطباعة التقرير' : 'Close Day & Print'}</Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!closeTarget} onClose={() => { if (!closing) { setCloseTarget(null); setCloseBlock(null); } }} title={isAr ? 'إغلاق الوردية' : t('closeShift')}>
        {closeTarget && <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="p-3 bg-ui-page-alt rounded-lg"><p className="text-xs text-ui-subtle mb-1">{t('openingAmount')}</p><p className="font-semibold">{formatCurrency(closeTarget.opening_amount, currency, lang)}</p></div>
            <div className="p-3 bg-ui-primary-soft rounded-lg"><p className="text-xs text-ui-subtle mb-1">{t('expectedAmount')}</p><p className="font-semibold text-ui-primary">{formatCurrency(getExpectedAmount(closeTarget), currency, lang)}</p></div>
            <div className="p-3 bg-ui-page-alt rounded-lg"><p className="text-xs text-ui-subtle mb-1">{isAr ? 'صافي حركة الدرج' : 'Net drawer movement'}</p><p className="font-semibold">{formatCurrency(getExpectedAmount(closeTarget) - closeTarget.opening_amount, currency, lang)}</p></div>
          </div>

          {closeBlock && <div className="rounded-lg border border-ui-danger/30 bg-ui-danger-soft p-4 text-sm">
            <div className="flex items-start gap-2"><AlertTriangle className="w-5 h-5 text-ui-danger shrink-0 mt-0.5" /><div><p className="font-semibold text-ui-danger">{isAr ? 'لا يمكن إغلاق الوردية مع وجود طلبات مفتوحة' : 'Shift cannot close while orders remain open'}</p><p className="mt-1 text-ui-muted">{isAr ? `يوجد ${closeBlock.openOrderCount} طلب مفتوح/معلق مرتبط بـ ${closeBlock.openTableCount} طاولة. يجب على المستخدم إغلاق أو تسوية كل الطلبات أولًا، ثم إعادة محاولة إغلاق الوردية.` : `${closeBlock.openOrderCount} open/held order(s) remain on ${closeBlock.openTableCount} table(s). The user must resolve every order before closing the shift.`}</p></div></div>
          </div>}

          <div className="flex gap-2"><Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => handlePrintZReport(closeTarget, 'thermal')}><Printer className="w-4 h-4" /> {isAr ? 'معاينة إيصال Z-Report' : 'Preview Thermal'}</Button><Button type="button" variant="outline" size="sm" className="flex-1" onClick={() => handlePrintZReport(closeTarget, 'a4')}><FileText className="w-4 h-4" /> {isAr ? 'معاينة تقرير A4' : 'Preview A4'}</Button></div>
          <Input type="number" min={0} step="0.01" label={isAr ? 'المبلغ الفعلي بالدرج (العد الفعلي) *' : t('actualAmount')} value={String(closeForm.actual_amount)} onChange={(e) => setCloseForm({ ...closeForm, actual_amount: Number(e.target.value) })} />
          <Textarea label={isAr ? 'ملاحظات إغلاق الوردية' : t('notes')} value={closeForm.notes} onChange={(e) => setCloseForm({ ...closeForm, notes: e.target.value })} rows={2} />
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button variant="secondary" disabled={closing} onClick={() => { setCloseTarget(null); setCloseBlock(null); }}>{t('cancel')}</Button>
            <Button variant="danger" disabled={closing} onClick={closeShift}><Square className="w-4 h-4" /> {isAr ? 'تأكيد إغلاق الوردية' : t('closeShift')}</Button>
          </div>
        </div>}
      </Modal>
    </DesignSurface>
  );
}
