import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bell, CalendarDays, ClipboardCheck, Clock3, Factory, PackageSearch,
  ReceiptText, RotateCcw, ShoppingBag, ShoppingCart, Trash2, Wallet,
  ArrowLeftRight, X,
  type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/api';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { formatFinancialCurrency } from '@/lib/format';
import type { AuditLog } from '@/lib/types';

type ActivityKind =
  | 'sale'
  | 'purchase'
  | 'refund'
  | 'expense'
  | 'transfer'
  | 'shift'
  | 'void'
  | 'stock_count'
  | 'production'
  | 'waste'
  | 'activity';

type ActivityPresentation = {
  kind: ActivityKind;
  title: string;
  icon: LucideIcon;
};

const DISPLAY_MS = 4200;
const SLIDE_MS = 280;
const POLL_MS = 5000;
const MAX_RECENT = 30;

function detailValue(details: Record<string, unknown> | null, keys: string[]): unknown {
  if (!details) return null;
  for (const key of keys) {
    const value = details[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function numericDetail(details: Record<string, unknown> | null): number | null {
  const value = detailValue(details, [
    'amount',
    'total',
    'refund_amount',
    'returned_amount',
    'total_cost',
    'actual',
    'expected',
    'value',
  ]);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function presentationFor(row: AuditLog, ar: boolean): ActivityPresentation {
  const haystack = `${row.action} ${row.entity || ''}`.toLowerCase();

  if (haystack.includes('refund') || haystack.includes('return')) {
    return { kind: 'refund', title: ar ? 'مرتجع جديد' : 'New refund', icon: RotateCcw };
  }
  if (haystack.includes('purchase')) {
    return { kind: 'purchase', title: ar ? 'شراء جديد' : 'New purchase', icon: ShoppingBag };
  }
  if (haystack.includes('expense')) {
    return { kind: 'expense', title: ar ? 'مصروف جديد' : 'New expense', icon: Wallet };
  }
  if (haystack.includes('void') || haystack.includes('cancel_sent')) {
    return { kind: 'void', title: ar ? 'إلغاء / Void' : 'Void / cancellation', icon: X };
  }
  if (haystack.includes('stock_count') || haystack.includes('inventory_count')) {
    return { kind: 'stock_count', title: ar ? 'جرد مخزون' : 'Stock count', icon: ClipboardCheck };
  }
  if (haystack.includes('warehouse_transfer') || haystack.includes('stock_transfer') || haystack.includes('transfer')) {
    return { kind: 'transfer', title: ar ? 'تحويل مخزون' : 'Stock transfer', icon: ArrowLeftRight };
  }
  if (haystack.includes('shift')) {
    const close = haystack.includes('close');
    return { kind: 'shift', title: close ? (ar ? 'إغلاق شفت' : 'Shift closed') : (ar ? 'فتح شفت' : 'Shift opened'), icon: Clock3 };
  }
  if (haystack.includes('production') || haystack.includes('manufactur')) {
    return { kind: 'production', title: ar ? 'تصنيع جديد' : 'Production activity', icon: Factory };
  }
  if (haystack.includes('waste')) {
    return { kind: 'waste', title: ar ? 'هالك جديد' : 'Waste recorded', icon: Trash2 };
  }
  if (haystack.includes('sale') || haystack.includes('payment')) {
    return { kind: 'sale', title: ar ? 'بيع جديد' : 'New sale', icon: ShoppingCart };
  }

  return {
    kind: 'activity',
    title: ar ? 'حركة جديدة' : 'New activity',
    icon: ReceiptText,
  };
}

function activitySummary(row: AuditLog, ar: boolean, money: (value: number) => string) {
  const details = row.details || null;
  const documentNumber = detailValue(details, [
    'invoice_number',
    'order_number',
    'reference_number',
    'transfer_number',
    'count_number',
    'number',
  ]);
  const amount = numericDetail(details);
  const actor = detailValue(details, ['user_name', 'cashier_name', 'employee_name', 'operator_name']);
  const fallbackActor = row.user_email ? row.user_email.split('@')[0] : null;

  const parts: string[] = [];
  if (documentNumber) parts.push(`${ar ? 'رقم' : '#'} ${String(documentNumber)}`);
  if (amount !== null) parts.push(money(amount));
  if (actor || fallbackActor) parts.push(String(actor || fallbackActor));
  if (parts.length === 0 && row.entity) parts.push(row.entity);

  return parts.join(' — ') || (ar ? 'تم تسجيل العملية بنجاح' : 'Activity recorded successfully');
}

function storageKey(userId: string | undefined, branchId: string | null) {
  if (!userId) return null;
  return `dashboard-standby:last-read:${userId}:${branchId || 'all'}`;
}

function readLastRead(key: string | null): number {
  if (!key || typeof window === 'undefined') return Date.now();
  const value = Number(window.localStorage.getItem(key));
  if (Number.isFinite(value) && value > 0) return value;
  const now = Date.now();
  window.localStorage.setItem(key, String(now));
  return now;
}

function writeLastRead(key: string | null, value: number) {
  if (!key || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // UI-only state; business operations never depend on local storage.
  }
}

function MiniCalendar({ now, ar }: { now: Date; ar: boolean }) {
  const year = now.getFullYear();
  const month = now.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const week = ar ? ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'] : ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const locale = ar ? 'ar-EG-u-nu-latn' : 'en-US';
  const monthLabel = now.toLocaleDateString(locale, { month: 'long' });

  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-black uppercase tracking-[0.16em] text-[#ff5c82]">{monthLabel}</span>
        <CalendarDays className="h-4 w-4 text-[#67e8f9]" />
      </div>
      <div className="grid grid-cols-7 gap-x-2 gap-y-1 text-center text-[10px] sm:text-[11px]">
        {week.map((day, index) => <span key={`${day}-${index}`} className="font-bold text-white/70">{day}</span>)}
        {cells.map((day, index) => (
          <span
            key={`calendar-${index}`}
            className={`flex h-5 items-center justify-center rounded-full font-bold ${day === now.getDate() ? 'bg-[#ff4f78] text-white shadow-[0_0_16px_rgba(255,79,120,0.55)]' : 'text-white'}`}
          >
            {day ?? ''}
          </span>
        ))}
      </div>
    </div>
  );
}

export function DashboardStandbyBar({ canCreateSale }: { canCreateSale: boolean }) {
  const { lang } = useLanguage();
  const { user } = useAuth();
  const can = useCan();
  const branchFilter = useBranchFilter();
  const { branches } = useBranches();
  const { effectiveSettings } = useSettings();
  const ar = lang === 'ar';
  const canViewAudit = can('audit.view');
  const settings = effectiveSettings(branchFilter);
  const money = useCallback(
    (value: number) => formatFinancialCurrency(value, settings?.currency || 'EGP', lang),
    [lang, settings?.currency],
  );

  const [now, setNow] = useState(() => new Date());
  const [recent, setRecent] = useState<AuditLog[]>([]);
  const [queue, setQueue] = useState<AuditLog[]>([]);
  const [active, setActive] = useState<AuditLog | null>(null);
  const [showEvent, setShowEvent] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const initialLoadRef = useRef(true);
  const seenIdsRef = useRef(new Set<string>());
  const readingRef = useRef(false);

  const lastReadKey = useMemo(() => storageKey(user?.id, branchFilter), [branchFilter, user?.id]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    initialLoadRef.current = true;
    seenIdsRef.current = new Set();
    setRecent([]);
    setQueue([]);
    setActive(null);
    setShowEvent(false);
    setUnread(0);
  }, [branchFilter, user?.id]);

  const loadActivity = useCallback(async () => {
    if (!canViewAudit || readingRef.current) return;
    readingRef.current = true;
    try {
      let query = supabase
        .from('audit_log')
        .select('id,user_id,user_email,action,entity,entity_id,details,branch_id,created_at')
        .order('created_at', { ascending: false })
        .limit(MAX_RECENT);

      if (branchFilter) query = query.eq('branch_id', branchFilter);
      const result = await query;
      if (result.error) return;

      const rows = (result.data || []) as AuditLog[];
      setRecent(rows);

      if (initialLoadRef.current) {
        rows.forEach((row) => seenIdsRef.current.add(row.id));
        const lastRead = readLastRead(lastReadKey);
        setUnread(rows.filter((row) => new Date(row.created_at).getTime() > lastRead).length);
        initialLoadRef.current = false;
        return;
      }

      const fresh = rows
        .filter((row) => !seenIdsRef.current.has(row.id))
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

      if (fresh.length > 0) {
        fresh.forEach((row) => seenIdsRef.current.add(row.id));
        setQueue((current) => [...current, ...fresh]);
        if (!panelOpen) setUnread((value) => value + fresh.length);
      }
    } finally {
      readingRef.current = false;
    }
  }, [branchFilter, canViewAudit, lastReadKey, panelOpen]);

  useEffect(() => {
    void loadActivity();
    if (!canViewAudit) return;

    const poll = window.setInterval(() => void loadActivity(), POLL_MS);
    const channel = supabase.channel(`dashboard-standby-${user?.id || 'anonymous'}-${branchFilter || 'all'}`);
    if (branchFilter) {
      channel.on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'audit_log', filter: `branch_id=eq.${branchFilter}` },
        () => void loadActivity(),
      );
    } else {
      channel.on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'audit_log' },
        () => void loadActivity(),
      );
    }
    channel.subscribe();

    return () => {
      window.clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [branchFilter, canViewAudit, loadActivity, user?.id]);

  useEffect(() => {
    if (active || queue.length === 0) return;
    setActive(queue[0]);
    setQueue((current) => current.slice(1));
  }, [active, queue]);

  useEffect(() => {
    if (!active) return;

    const enterFrame = window.requestAnimationFrame(() => setShowEvent(true));
    const hideTimer = window.setTimeout(() => setShowEvent(false), DISPLAY_MS);
    const clearTimer = window.setTimeout(() => setActive(null), DISPLAY_MS + SLIDE_MS);

    return () => {
      window.cancelAnimationFrame(enterFrame);
      window.clearTimeout(hideTimer);
      window.clearTimeout(clearTimer);
    };
  }, [active]);

  const markRead = () => {
    const stamp = Date.now();
    writeLastRead(lastReadKey, stamp);
    setUnread(0);
  };

  const togglePanel = () => {
    setPanelOpen((open) => {
      const next = !open;
      if (next) markRead();
      return next;
    });
  };

  const locale = ar ? 'ar-EG-u-nu-latn' : 'en-US';
  const dayNumber = now.toLocaleDateString(locale, { day: '2-digit' });
  const weekday = now.toLocaleDateString(locale, { weekday: 'long' });
  const monthName = now.toLocaleDateString(locale, { month: 'long' });
  const year = now.toLocaleDateString(locale, { year: 'numeric' });
  const branchName = branchFilter ? branches.find((branch) => branch.id === branchFilter)?.name : null;
  const activePresentation = active ? presentationFor(active, ar) : null;
  const ActiveIcon = activePresentation?.icon || ReceiptText;
  const activeDocument = active ? detailValue(active.details || null, [
    'invoice_number', 'order_number', 'reference_number', 'transfer_number', 'count_number', 'number',
  ]) : null;
  const activeAmount = active ? numericDetail(active.details || null) : null;
  const activeActor = active
    ? detailValue(active.details || null, ['user_name', 'cashier_name', 'employee_name', 'operator_name'])
      || (active.user_email ? active.user_email.split('@')[0] : null)
    : null;

  const idleTransform = showEvent
    ? (ar ? '-translate-x-full' : 'translate-x-full')
    : 'translate-x-0';
  const eventTransform = showEvent
    ? 'translate-x-0'
    : (ar ? 'translate-x-full' : '-translate-x-full');

  return (
    <section
      data-testid="dashboard-standby-bar"
      dir={ar ? 'rtl' : 'ltr'}
      className="relative rounded-[28px] border border-white/15 bg-black text-white shadow-[0_14px_38px_rgba(0,0,0,0.30)]"
    >
      <div className="dashboard-standby-viewport relative h-[238px] overflow-hidden rounded-[27px] bg-black sm:h-[220px] md:h-[190px]">
        <div className="pointer-events-none absolute inset-0 bg-black" />
        <div className="pointer-events-none absolute -end-10 -top-16 h-40 w-40 rounded-full bg-rose-500/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -start-10 h-44 w-44 rounded-full bg-cyan-400/10 blur-3xl" />

        <div
          aria-hidden={showEvent}
          className={`dashboard-standby-slide-layer absolute inset-0 grid h-full grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] grid-rows-[minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-4 transition-transform duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] sm:px-6 md:grid-cols-[minmax(220px,0.92fr)_minmax(300px,1.08fr)_minmax(235px,0.9fr)] md:grid-rows-1 md:gap-x-5 md:px-7 md:py-5 ${idleTransform} ${showEvent ? 'pointer-events-none' : ''}`}
        >
          <div className="flex min-w-0 items-center justify-center gap-3 border-white/15 md:h-full md:justify-start md:border-e md:pe-6">
            <div className="min-w-0 shrink">
              <p className="text-base font-black leading-tight text-[#ff6b8a] sm:text-lg md:text-xl">{weekday}</p>
              <p className="mt-1 text-xs font-black text-[#ff9bb0] sm:text-sm">{monthName}</p>
            </div>
            <div className="shrink-0 text-[72px] font-black leading-[0.85] tracking-[-0.055em] text-white drop-shadow-[0_0_18px_rgba(255,255,255,0.12)] sm:text-[84px] md:text-[100px]">{dayNumber}</div>
          </div>

          <div className="min-w-0 md:px-2">
            <MiniCalendar now={now} ar={ar} />
          </div>

          <div className="col-span-2 flex min-w-0 items-center justify-between gap-3 border-t border-white/15 pt-3 md:col-span-1 md:h-full md:border-s md:border-t-0 md:ps-6 md:pt-0">
            <div className="min-w-0 flex-1">
              <p className="max-w-full break-words text-[clamp(1.05rem,2vw,1.45rem)] font-black leading-[1.25] text-white">
                {ar ? `مرحباً، ${user?.full_name || 'مدير النظام'}` : `Welcome, ${user?.full_name || 'Admin'}`}
              </p>
              <p className="mt-1 text-xs font-bold text-[#ffd166]">{weekday} · {dayNumber} {monthName} {year}</p>
              {branchName && <p className="mt-1 max-w-full break-words text-xs font-bold leading-5 text-[#67e8f9]">{branchName}</p>}
              {canCreateSale && (
                <Link
                  to="/pos"
                  className="mt-3 inline-flex items-center gap-2 rounded-xl bg-[#2563eb] px-3.5 py-2 text-xs font-black text-white shadow-[0_6px_18px_rgba(37,99,235,0.30)] transition-colors hover:bg-[#3b82f6]"
                >
                  <ShoppingCart className="h-4 w-4" />
                  {ar ? 'إنشاء بيع' : 'New sale'}
                </Link>
              )}
            </div>

            {canViewAudit && (
              <button
                type="button"
                onClick={togglePanel}
                className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#101827] text-[#67e8f9] ring-1 ring-cyan-300/25 transition-colors hover:bg-[#162033]"
                aria-label={ar ? 'سجل العمليات' : 'Activity log'}
              >
                <Bell className="h-5 w-5" />
                {unread > 0 && <span className="absolute -end-1 -top-1 min-w-5 rounded-full bg-[#ff315f] px-1.5 text-[10px] font-black leading-5 text-white shadow-[0_0_14px_rgba(255,49,95,0.55)]">{Math.min(unread, 99)}</span>}
              </button>
            )}
          </div>
        </div>

        <div
          aria-live="polite"
          aria-hidden={!showEvent}
          className={`dashboard-standby-slide-layer absolute inset-0 flex h-full items-center gap-4 px-5 py-5 transition-transform duration-[280ms] ease-[cubic-bezier(0.22,1,0.36,1)] sm:gap-5 sm:px-7 ${eventTransform} ${showEvent ? '' : 'pointer-events-none'}`}
        >
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-3xl bg-[#ff315f] text-white shadow-[0_8px_28px_rgba(255,49,95,0.34)] sm:h-20 sm:w-20">
            <ActiveIcon className="h-8 w-8 sm:h-10 sm:w-10" />
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2 text-xs font-black text-[#ff8da6]">
              <span className="h-2 w-2 rounded-full bg-[#ff315f] shadow-[0_0_10px_rgba(255,49,95,0.75)]" />
              {ar ? 'نشاط مباشر' : 'Live activity'}
            </div>
            <h2 className="text-2xl font-black leading-tight text-white sm:text-3xl">{activePresentation?.title || (ar ? 'حركة جديدة' : 'New activity')}</h2>

            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm font-black sm:text-base">
              {activeDocument && <span className="text-[#ffd166]">{ar ? 'رقم' : '#'} {String(activeDocument)}</span>}
              {activeAmount !== null && <span className="text-[#67e8f9]">{money(activeAmount)}</span>}
              {activeActor && <span className="max-w-full break-words text-[#86efac]">{String(activeActor)}</span>}
              {!activeDocument && activeAmount === null && !activeActor && active && (
                <span className="max-w-full break-words text-[#e2e8f0]">{activitySummary(active, ar, money)}</span>
              )}
            </div>

            {active && (
              <p className="mt-2 text-xs font-bold text-[#c4b5fd]">
                {branchName ? `${branchName} · ` : ''}{new Date(active.created_at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}
              </p>
            )}
          </div>

          {queue.length > 0 && (
            <div className="hidden shrink-0 rounded-2xl bg-[#111827] px-4 py-3 text-center ring-1 ring-white/10 sm:block">
              <p className="text-[10px] font-bold text-[#a5b4fc]">{ar ? 'في الانتظار' : 'Queued'}</p>
              <p className="mt-1 text-xl font-black text-white">{queue.length}</p>
            </div>
          )}

          {canViewAudit && (
            <button
              type="button"
              onClick={togglePanel}
              className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#101827] text-[#67e8f9] ring-1 ring-cyan-300/25 transition-colors hover:bg-[#162033]"
              aria-label={ar ? 'سجل العمليات' : 'Activity log'}
            >
              <Bell className="h-5 w-5" />
              {unread > 0 && <span className="absolute -end-1 -top-1 min-w-5 rounded-full bg-[#ff315f] px-1.5 text-[10px] font-black leading-5 text-white shadow-[0_0_14px_rgba(255,49,95,0.55)]">{Math.min(unread, 99)}</span>}
            </button>
          )}
        </div>
      </div>

      {panelOpen && canViewAudit && (
        <div
          data-testid="dashboard-standby-log"
          className="absolute end-3 top-[calc(100%+10px)] z-[90] w-[min(92vw,430px)] overflow-hidden rounded-2xl border border-ui-border bg-ui-surface text-ui-text shadow-ui-lg"
        >
          <div className="flex items-center justify-between border-b border-ui-border px-4 py-3">
            <div>
              <p className="font-black">{ar ? 'سجل العمليات' : 'Activity log'}</p>
              <p className="text-xs text-ui-muted">{ar ? 'أحدث الحركات المسموح لك بعرضها' : 'Latest activity you are allowed to view'}</p>
            </div>
            <button type="button" onClick={() => setPanelOpen(false)} className="rounded-lg p-2 text-ui-muted hover:bg-ui-page-alt" aria-label={ar ? 'إغلاق' : 'Close'}>
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="max-h-[360px] overflow-y-auto p-2">
            {recent.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-ui-muted">{ar ? 'لا توجد حركات حديثة' : 'No recent activity'}</p>
            ) : recent.map((row) => {
              const item = presentationFor(row, ar);
              const Icon = item.icon;
              return (
                <div key={row.id} className="mb-1 flex items-start gap-3 rounded-xl p-3 hover:bg-ui-page-alt">
                  <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ui-primary-soft text-ui-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-black text-ui-text">{item.title}</p>
                    <p className="mt-0.5 truncate text-xs text-ui-muted">{activitySummary(row, ar, money)}</p>
                    <p className="mt-1 text-[10px] text-ui-subtle">{new Date(row.created_at).toLocaleString(locale, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="border-t border-ui-border p-2">
            <Link to="/audit-log" className="flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-ui-primary hover:bg-ui-primary-soft">
              <PackageSearch className="h-4 w-4" />
              {ar ? 'فتح سجل العمليات الكامل' : 'Open full activity log'}
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
