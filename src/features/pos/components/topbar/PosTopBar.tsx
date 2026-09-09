import { useEffect, useState, useCallback, useRef } from 'react';
import { Plus, Wifi, WifiOff, Timer, Moon, Sun, LogOut, Clock3, MoreHorizontal, ListOrdered, RefreshCw, CalendarCheck, ChefHat, Truck } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useLanguage } from '@/context/LanguageContext';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { Logo } from '@/components/Logo';
import type { Branch } from '@/lib/types';
import type { ActiveShiftInfo } from '../../hooks/usePosOrder';
import { usePosPermissions } from '../../hooks/usePosPermissions';
import { offlinePosManager } from '../../services/offlinePos';

export type PosPanelId = 'orders' | 'tables' | 'kitchen' | null;

interface PosTopBarProps {
  panel: PosPanelId;
  onPanel: (p: Exclude<PosPanelId, null>) => void;
  counts: {
    activeOrders: number;
    occupiedTables: number;
    kitchenOrders: number;
    heldOrders: number;
    deliveryOrders: number;
    takeawayOrders: number;
  };
  branchId: string;
  branches: Branch[];
  canChangeBranch: boolean;
  onBranchChange: (id: string) => void;
  shiftChecked: boolean;
  activeShift: ActiveShiftInfo | null;
  onNewOrder: () => void;
  onExit: () => void;
  onOpenShiftModal?: () => void;
}

export function PosTopBar({
  onPanel,
  counts,
  branchId,
  branches,
  canChangeBranch,
  onBranchChange,
  shiftChecked,
  activeShift,
  onNewOrder,
  onExit,
  onOpenShiftModal,
}: PosTopBarProps) {
  const { t, lang } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const { user, signOut } = useAuth();
  const perms = usePosPermissions();
  const navigate = useNavigate();
  const location = useLocation();
  const landingOpened = useRef(false);
  const isAr = lang === 'ar';

  const [now, setNow] = useState(() => new Date());
  const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [more, setMore] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshPending = useCallback(() => {
    setPendingCount(offlinePosManager.getPendingCount());
  }, []);

  const triggerSync = useCallback(async () => {
    if (syncing || !navigator.onLine) return;
    setSyncing(true);
    try {
      await offlinePosManager.syncAllPending();
    } finally {
      setSyncing(false);
      refreshPending();
    }
  }, [syncing, refreshPending]);

  useEffect(() => {
    if (landingOpened.current) return;
    if (location.pathname === '/pos' || location.pathname.endsWith('/pos')) {
      landingOpened.current = true;
      onNewOrder();
    }
  }, [location.pathname, onNewOrder]);

  useEffect(() => {
    refreshPending();
    const id = setInterval(() => setNow(new Date()), 30000);

    const on = () => {
      setOnline(true);
      void triggerSync();
    };
    const off = () => setOnline(false);

    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    window.addEventListener('storage', refreshPending);

    return () => {
      clearInterval(id);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.removeEventListener('storage', refreshPending);
    };
  }, [refreshPending, triggerSync]);

  const canManageCurrentShift = shiftChecked && (activeShift ? perms.canCloseShift : perms.canOpenShift);

  const openShiftManagement = () => {
    if (!canManageCurrentShift) return;
    if (activeShift && onOpenShiftModal) {
      onOpenShiftModal();
      return;
    }
    navigate('/shifts');
  };

  const counterButton = (
    key: string,
    labelAr: string,
    labelEn: string,
    value: number,
    icon: React.ReactNode,
    panel: Exclude<PosPanelId, null>,
  ) => (
    <button
      key={key}
      type="button"
      data-testid={`pos-counter-${key}`}
      onClick={() => onPanel(panel)}
      className="flex min-h-10 items-center gap-2 rounded-xl border border-ui-border bg-ui-surface px-2.5 text-ui-muted transition-colors hover:bg-ui-page-alt hover:text-ui-text"
      title={isAr ? labelAr : labelEn}
    >
      <span className="text-ui-primary">{icon}</span>
      <span className="hidden 2xl:inline text-[10px] font-bold">{isAr ? labelAr : labelEn}</span>
      <span className="min-w-5 rounded-full bg-ui-primary-soft px-1.5 py-0.5 text-center text-[10px] font-black text-ui-primary">{value}</span>
    </button>
  );

  return (
    <header className="sticky top-0 z-50 flex min-h-16 items-center gap-2 border-b border-ui-border bg-ui-surface px-3 shadow-ui-sm md:px-4">
      <div className="flex shrink-0 items-center gap-2">
        <Logo variant="mark" size={34} tone="auto" />
        <div className="hidden leading-tight sm:block">
          <p className="text-sm font-black text-ui-text">Premier</p>
          <p className="text-[9px] font-black uppercase tracking-[.16em] text-ui-accent">{t('pos')}</p>
        </div>
        {perms.canCreateOrder && (
          <button
            onClick={onNewOrder}
            data-testid="pos-action-new-order"
            className="flex min-h-10 items-center gap-1.5 rounded-xl bg-ui-primary px-3 text-xs font-black text-ui-primary-fg shadow-ui-sm transition active:scale-95 hover:bg-ui-primary-hover"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">{isAr ? 'الطاولات / طلب جديد' : 'Tables / New order'}</span>
          </button>
        )}
      </div>

      <div className="flex-1" />

      <div data-testid="pos-top-counters" className="hidden items-center gap-1 lg:flex">
        {counterButton('active-orders', 'الطلبات النشطة', 'Active orders', counts.activeOrders, <ListOrdered className="h-3.5 w-3.5" />, 'orders')}
        {counterButton('delivery', 'الدليفري', 'Delivery', counts.deliveryOrders, <Truck className="h-3.5 w-3.5" />, 'orders')}
        {counterButton('tables', 'الطاولات المشغولة', 'Occupied tables', counts.occupiedTables, <CalendarCheck className="h-3.5 w-3.5" />, 'tables')}
        {perms.canViewKitchen && counterButton('kds', 'طلبات المطبخ', 'Kitchen queue', counts.kitchenOrders, <ChefHat className="h-3.5 w-3.5" />, 'kitchen')}
      </div>

      {pendingCount > 0 && (
        <button
          onClick={triggerSync}
          disabled={syncing || !online}
          className={`flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-black transition animate-pulse ${online ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20' : 'border-ui-danger/40 bg-ui-danger/10 text-ui-danger'}`}
          title={isAr ? 'فواتير تم حفظها أثناء انقطاع النت في انتظار المزامنة' : 'Queued offline sales pending sync'}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
          <span>
            {pendingCount} {isAr ? 'فواتير أوفلاين معلقة' : 'offline sales queued'}
            {online && !syncing && ` (${isAr ? 'مزامنة' : 'Sync'})`}
          </span>
        </button>
      )}

      <div className={`hidden items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[10px] font-black xl:flex ${online ? 'border-ui-success/30 bg-ui-success/10 text-ui-success' : 'border-ui-danger/30 bg-ui-danger/10 text-ui-danger'}`}>
        {online ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
        {online ? t('online') : (isAr ? 'أوفلاين (جاهز)' : t('offline'))}
      </div>

      <div className="hidden items-center gap-1.5 rounded-xl border border-ui-border bg-ui-page-alt px-2.5 py-1.5 text-[10px] font-bold text-ui-muted lg:flex">
        <Clock3 className="h-3 w-3 text-ui-subtle" />
        {now.toLocaleTimeString(isAr ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
      </div>

      {canManageCurrentShift && (
        <button
          data-testid="pos-shift-button"
          onClick={openShiftManagement}
          className={`min-h-9 items-center gap-1.5 rounded-xl border px-3 text-[11px] font-black flex transition hover:shadow-ui-sm ${activeShift ? 'border-ui-success/40 bg-ui-success/10 text-ui-success hover:bg-ui-success/20' : 'border-ui-warning/40 bg-ui-warning/10 text-ui-warning hover:bg-ui-warning/20'}`}
          title={activeShift ? (isAr ? 'إدارة وإغلاق اليوم والوردية' : 'Manage Shift & Day Close') : (isAr ? 'فتح وردية' : 'Open Shift')}
        >
          <Timer className="h-3.5 w-3.5" />
          <span>{activeShift ? (isAr ? 'الوردية نشطة (إغلاق اليوم)' : t('open')) : t('noOpenShift')}</span>
        </button>
      )}

      <div className="relative">
        <button
          onClick={() => setMore((value) => !value)}
          aria-label={isAr ? 'المزيد' : 'More'}
          className="flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-ui-border bg-ui-surface text-ui-muted hover:bg-ui-page-alt"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>

        {more && (
          <div className="absolute end-0 top-12 z-50 w-64 rounded-2xl border border-ui-border bg-ui-surface p-2 shadow-ui-xl">
            <div className="mb-1 px-3 py-2 text-xs font-black text-ui-subtle">{isAr ? 'إجراءات إضافية' : 'More actions'}</div>
            <button
              onClick={() => { onPanel('orders'); setMore(false); }}
              className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold hover:bg-ui-page-alt"
            >
              <ListOrdered className="h-4 w-4" />
              {t('activeOrders')}
              {counts.activeOrders > 0 && <span className="ms-auto rounded-full bg-ui-primary px-2 py-0.5 text-[10px] text-ui-primary-fg">{counts.activeOrders}</span>}
            </button>
            {canManageCurrentShift && (
              <button
                onClick={() => { openShiftManagement(); setMore(false); }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-bold hover:bg-ui-page-alt"
              >
                <CalendarCheck className="h-4 w-4 text-ui-accent" />
                {activeShift ? (isAr ? 'إغلاق اليوم والوردية (Z-Report)' : 'Day & Shift Closing') : (isAr ? 'فتح وردية' : 'Open Shift')}
              </button>
            )}
            {perms.canChangeBranch && canChangeBranch && (
              <>
                <div className="my-1 h-px bg-ui-border" />
                <div className="px-3 py-1.5 text-[11px] text-ui-subtle">{isAr ? 'الفرع' : 'Branch'}</div>
                <select
                  value={branchId}
                  onChange={(event) => { onBranchChange(event.target.value); setMore(false); }}
                  className="w-full rounded-xl border border-ui-border bg-ui-page-alt px-3 py-2 text-sm font-bold text-ui-text"
                >
                  {branches.map((branch) => <option key={branch.id} value={branch.id}>{isAr ? branch.name : branch.name_en || branch.name}</option>)}
                </select>
              </>
            )}
          </div>
        )}
      </div>

      <div className="hidden items-center gap-2 lg:flex">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-ui-primary text-xs font-black text-ui-primary-fg ring-1 ring-ui-border-strong">
          {(user?.full_name || user?.email || '?')[0].toUpperCase()}
        </div>
        <div className="max-w-[120px] leading-tight">
          <p className="truncate text-[11px] font-black text-ui-text">{user?.full_name || user?.email}</p>
          <p className="text-[9px] text-ui-subtle">{user?.role}</p>
        </div>
      </div>

      <button onClick={toggleTheme} aria-label={isAr ? 'تغيير المظهر' : 'Toggle theme'} className="flex min-h-10 min-w-10 items-center justify-center rounded-xl text-ui-muted hover:bg-ui-page-alt">
        {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      </button>

      <button onClick={onExit} aria-label={isAr ? 'خروج' : 'Exit'} className="hidden min-h-10 min-w-10 items-center justify-center rounded-xl text-ui-muted hover:bg-ui-page-alt sm:flex">
        <LogOut className="h-4 w-4 rotate-180" />
      </button>

      <button onClick={() => void signOut()} aria-label={isAr ? 'تسجيل الخروج' : 'Sign out'} className="flex min-h-10 min-w-10 items-center justify-center rounded-xl text-ui-subtle hover:bg-ui-danger/10 hover:text-ui-danger">
        <LogOut className="h-4 w-4" />
      </button>
    </header>
  );
}
