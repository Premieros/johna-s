import { useState, useEffect, useLayoutEffect, useCallback, useRef } from 'react';
import { RefreshCw, ChefHat, CheckCircle2, UtensilsCrossed, Volume2, VolumeX, AlertTriangle, User } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { userFacingErrorMessage } from '@/lib/userFacingError';
import { DesignSurface, DesignPageHeader } from '@/components/design/DesignSurface';
import { Button } from '@/components/Button';
import { Select } from '@/components/Input';
import { supabase } from '@/api';
import { catalog } from '@/api/domains/catalog';
import { subscribePosRealtime } from '@/features/pos/services/posRealtime';
import type { KitchenQueueItem, KitchenStation } from '@/lib/types';
import { KitchenCompletedHistory } from '../components/KitchenCompletedHistory';
import { isKitchenQueueExpired, kitchenElapsedSeconds } from '../services/kitchenQueueAge';

function elapsedColor(seconds: number): string {
  if (seconds > 600) return 'text-ui-danger font-bold';
  if (seconds > 300) return 'text-ui-warning font-semibold';
  return 'text-ui-success';
}

function formatElapsed(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function statusBadge(s: string, ar: boolean) {
  if (s === 'cooking') return <span className="rounded-full bg-ui-warning-soft px-2 py-0.5 text-xs font-bold text-ui-warning">{ar ? 'جاري التحضير' : 'Cooking'}</span>;
  if (s === 'ready') return <span className="rounded-full bg-ui-success-soft px-2 py-0.5 text-xs font-bold text-ui-success">{ar ? 'جاهز' : 'Ready'}</span>;
  return <span className="rounded-full bg-ui-info-soft px-2 py-0.5 text-xs font-bold text-ui-info">{ar ? 'جديد' : 'New'}</span>;
}

function modifierText(value: unknown, ar: boolean): string {
  if (!value) return '';
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) return typeof value === 'string' ? value : '';
    return parsed
      .map((m: { option_name?: string; option_name_en?: string | null }) => ar ? (m.option_name || m.option_name_en || '') : (m.option_name_en || m.option_name || ''))
      .filter(Boolean)
      .join(' · ');
  } catch {
    return typeof value === 'string' ? value : '';
  }
}

export function KitchenDisplayPage() {
  const { lang } = useLanguage();
  const { user } = useAuth();
  const ar = lang === 'ar';
  const branchFilter = useBranchFilter();
  const can = useCan();
  const canViewKds = can('pos.kds_view');
  const canUpdateKds = can('pos.kds_update');
  const canFinishEmpty = canViewKds && canUpdateKds && can('settings.manage');
  const [finishingOrder, setFinishingOrder] = useState<string | null>(null);
  const [station, setStation] = useState('');
  const [view, setView] = useState<'active' | 'expired' | 'completed'>('active');
  const [now, setNow] = useState(Date.now);
  const [items, setItems] = useState<KitchenQueueItem[]>([]);
  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [orderContext, setOrderContext] = useState<Record<string, { table_name: string | null; operator_name: string | null }>>({});
  const prevCountRef = useRef(0);
  const scopeKey = `${branchFilter || ''}:${user?.id || ''}:${canViewKds}`;
  const scopeRef = useRef(scopeKey);
  const queueRead = useRef(0);
  const stationRead = useRef(0);
  useLayoutEffect(() => {
    scopeRef.current = scopeKey;
    ++queueRead.current;
    ++stationRead.current;
    setItems([]); setOrderContext({}); setStations([]); setStation(''); setLoadError('');
    prevCountRef.current = 0;
    return () => { scopeRef.current = ''; };
  }, [scopeKey]);
  const expiredItems = items.filter(item => isKitchenQueueExpired(item, now));
  const activeItems = items.filter(item => !isKitchenQueueExpired(item, now));
  const visibleItems = view === 'expired' ? expiredItems : activeItems;
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const loadStations = useCallback(async () => {
    if (scopeRef.current !== scopeKey) return;
    const token = ++stationRead.current;
    if (!branchFilter || !canViewKds) {
      setStations([]);
      setStation('');
      return;
    }
    try {
      const { data, error } = await supabase.rpc('get_my_kitchen_stations', { p_branch_id: branchFilter });
      if (token !== stationRead.current || scopeRef.current !== scopeKey) return;
      if (error) throw error;
      const allowed = (Array.isArray(data) ? data : []) as KitchenStation[];
      setStations(allowed);
      setStation((current) => current && allowed.some((s) => s.code === current) ? current : '');
    } catch (error) {
      if (token !== stationRead.current || scopeRef.current !== scopeKey) return;
      setStations([]);
      setLoadError(userFacingErrorMessage(error, ar ? 'ar' : 'en'));
    }
  }, [branchFilter, canViewKds, ar, scopeKey]);

  const load = useCallback(async () => {
    if (scopeRef.current !== scopeKey) return;
    const token = ++queueRead.current;
    setLoading(true);
    try {
      if (!branchFilter || !canViewKds) {
        setItems([]);
        setOrderContext({});
        prevCountRef.current = 0;
        setLoadError(userFacingErrorMessage(!canViewKds ? 'POS_KDS_VIEW_REQUIRED' : 'BRANCH_REQUIRED', ar ? 'ar' : 'en'));
        return;
      }
      const { data, error } = await supabase.rpc('get_kitchen_queue', {
        p_station: station || null,
        p_branch_id: branchFilter,
      });
      if (token !== queueRead.current || scopeRef.current !== scopeKey) return;
      if (error) throw error;
      const newItems = (data ?? []) as KitchenQueueItem[];
      if (soundEnabled && prevCountRef.current > 0 && newItems.length > prevCountRef.current) playBeep();
      prevCountRef.current = newItems.length;
      setNow(Date.now());
      setItems(newItems);

      const orderIds = [...new Set(newItems.map((item) => item.order_id).filter(Boolean))];
      if (orderIds.length === 0) {
        setOrderContext({});
        setLoadError('');
        return;
      }

      const { data: contextRows, error: contextError } = await catalog.getKitchenOrderContext({
        p_order_ids: orderIds,
        p_branch_id: branchFilter,
      });
      if (token !== queueRead.current || scopeRef.current !== scopeKey) return;
      if (contextError) {
        setOrderContext({});
        setLoadError(userFacingErrorMessage(contextError, ar ? 'ar' : 'en'));
        return;
      }

      const nextContext: Record<string, { table_name: string | null; operator_name: string | null }> = {};
      for (const row of (contextRows ?? []) as { order_id: string; table_name: string | null; operator_name: string | null }[]) {
        nextContext[row.order_id] = { table_name: row.table_name, operator_name: row.operator_name };
      }
      setOrderContext(nextContext);
      setLoadError('');
    } catch (error) {
      if (token !== queueRead.current || scopeRef.current !== scopeKey) return;
      // Never turn a KDS transport/permission failure into a fake empty queue.
      // Keep the last known cards visible and surface the error so staff can retry.
      setLoadError(userFacingErrorMessage(error, ar ? 'ar' : 'en'));
    } finally {
      if (token === queueRead.current && scopeRef.current === scopeKey) setLoading(false);
    }
  }, [branchFilter, station, soundEnabled, canViewKds, ar, scopeKey]);

  const playBeep = () => {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 800;
      gain.gain.value = 0.3;
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch { /* browser may block audio before user interaction */ }
  };

  useEffect(() => { void loadStations(); }, [loadStations]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!branchFilter || !canViewKds) return;
    const unsubscribe = subscribePosRealtime({ branchId: branchFilter, onEvent: () => { void load(); }, debounceMs: 500 });
    return unsubscribe;
  }, [branchFilter, canViewKds, load]);

  useEffect(() => {
    const id = setInterval(() => { void load(); }, 30000);
    return () => clearInterval(id);
  }, [load]);

  const handleKitchenStatus = async (orderId: string, status: string) => {
    if (!canUpdateKds) {
      setLoadError(userFacingErrorMessage('POS_KDS_UPDATE_REQUIRED', ar ? 'ar' : 'en'));
      return;
    }
    try {
      await catalog.setKitchenStatus(orderId, status);
      if (scopeRef.current !== scopeKey) return;
      setLoadError('');
      void load();
    } catch (error) {
      // Keep the last known KDS cards visible, but never make a failed action
      // look successful or silent.
      if (scopeRef.current !== scopeKey) return;
      setLoadError(userFacingErrorMessage(error, ar ? 'ar' : 'en'));
    }
  };

  const stationName = (v: string) => {
    const s = stations.find(st => st.code === v);
    if (s) return ar ? s.name_ar : s.name_en;
    return v;
  };

  const finishEmpty = async (orderId: string) => {
    if (!branchFilter || !canFinishEmpty || finishingOrder) return;
    setFinishingOrder(orderId);
    try {
      const { data, error } = await catalog.finishEmptyKitchenOrder({ p_order_id: orderId, p_branch_id: branchFilter });
      if (scopeRef.current !== scopeKey) return;
      if (error) throw error;
      if (!data?.success) throw new Error('EMPTY_KDS_ORDER_NOT_FINAL');
      setLoadError('');
      await load();
    } catch (error) {
      if (scopeRef.current !== scopeKey) return;
      setLoadError(userFacingErrorMessage(error, ar ? 'ar' : 'en'));
    } finally { setFinishingOrder(null); }
  };

  return (
    <DesignSurface testId="kitchen-display">
      <DesignPageHeader title={ar ? 'شاشة المطبخ' : 'Kitchen Display'} subtitle={ar ? 'الطلبات النشطة حسب المحطات المسموح بها للمستخدم' : 'Active orders for the stations assigned to this user'} />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Select value={station} onChange={e => setStation(e.target.value)} className="min-w-0 flex-1 sm:w-44 sm:flex-none" disabled={!canViewKds}>
            <option value="">{ar ? 'كل المحطات المسموح بها' : 'All Allowed Stations'}</option>
            {stations.filter(s => s.is_active).map(s => <option key={s.code} value={s.code}>{ar ? s.name_ar : s.name_en}</option>)}
          </Select>
          <Button onClick={() => void load()} variant="outline" disabled={!canViewKds}><RefreshCw className="h-4 w-4" /> {ar ? 'تحديث' : 'Refresh'}</Button>
          <button onClick={() => setSoundEnabled(!soundEnabled)} className="rounded-lg p-2 text-ui-muted hover:bg-ui-muted/10 transition" title={soundEnabled ? (ar ? 'كتم الصوت' : 'Mute') : (ar ? 'تشغيل الصوت' : 'Unmute')}>
            {soundEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          </button>
          <span className="w-full text-xs text-ui-muted sm:w-auto sm:text-sm"><span className="me-1 inline-block h-2 w-2 rounded-full bg-ui-success animate-pulse" />{activeItems.length} {ar ? 'طلب/محطة نشطة' : 'active order/station cards'}</span>
        </div>

        <div role="tablist" aria-label={ar ? 'عرض طلبات المطبخ' : 'Kitchen order views'} className="flex flex-wrap gap-2">
          <button role="tab" aria-selected={view === 'active'} onClick={() => setView('active')} className="rounded-lg border border-ui-border px-4 py-2 aria-selected:bg-ui-primary aria-selected:text-white">{ar ? 'نشطة' : 'Active'} ({activeItems.length})</button>
          <button role="tab" aria-selected={view === 'expired'} onClick={() => setView('expired')} className="rounded-lg border border-ui-border px-4 py-2 aria-selected:bg-ui-primary aria-selected:text-white">{ar ? 'تجاوزت 40 دقيقة' : 'Over 40 minutes'} ({expiredItems.length})</button>
          <button role="tab" aria-selected={view === 'completed'} onClick={() => setView('completed')} className="rounded-lg border border-ui-border px-4 py-2 aria-selected:bg-ui-primary aria-selected:text-white">{ar ? 'منتهية' : 'Completed'}</button>
        </div>
        {view === 'active' && <p className="text-xs text-ui-muted">{ar ? 'تنتقل الطلبات تلقائيًا إلى «تجاوزت 40 دقيقة» بعد 40 دقيقة من إرسالها للمطبخ.' : 'Orders move to Over 40 minutes after 40 minutes from kitchen dispatch.'}</p>}
        {view === 'expired' && <p className="text-sm text-ui-warning">{ar ? 'هذه الطلبات تجاوزت مدة العرض ولم يتم تسجيلها كمنتهية. يمكن إكمال تجهيزها من هنا.' : 'These orders exceeded the display window and remain unfinished. You can continue preparing them here.'}</p>}
        {view === 'completed' && branchFilter && canViewKds && <KitchenCompletedHistory key={`${branchFilter}:${station}`} branchId={branchFilter} station={station} ar={ar} />}

        {loadError && (
          <div data-testid="kds-load-error" className="flex flex-col gap-3 rounded-2xl border border-ui-danger/30 bg-ui-danger/10 p-4 text-ui-danger sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-2">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
              <div className="min-w-0">
                <p className="font-bold">{ar ? 'تعذر تحديث شاشة المطبخ' : 'Kitchen display could not refresh'}</p>
                <p className="break-words text-xs opacity-80">{loadError}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={!canViewKds || loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> {ar ? 'إعادة المحاولة' : 'Retry'}
            </Button>
          </div>
        )}

        {loading && !items.length && !loadError && <div className="text-ui-muted py-8 text-center">{ar ? 'جاري التحميل...' : 'Loading...'}</div>}

        {view !== 'completed' && <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleItems.map(item => {
            const context = orderContext[item.order_id];
            const isVoidedEmpty = !item.items.length && Boolean(item.notes?.includes('Kitchen void:'));
            const tableLabel = context?.table_name || (item.table_number ? `Table ${String(item.table_number).padStart(2, '0')}` : null);
            return (
            <div key={`${item.order_id}-${item.station}`} className={`rounded-2xl border bg-ui-surface p-3 sm:p-4 shadow-ui-sm transition-all ${item.kitchen_status === 'cooking' ? 'border-ui-warning/40 ring-1 ring-ui-warning' : item.kitchen_status === 'ready' ? 'border-ui-success/40 ring-1 ring-ui-success' : 'border-ui-border'}`}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="font-bold text-ui-text text-base sm:text-lg">#{item.order_number}</span>
                <div className="flex items-center gap-1.5">{statusBadge(item.kitchen_status, ar)}<span className={`text-xs sm:text-sm ${elapsedColor(kitchenElapsedSeconds(item, now))}`}>{formatElapsed(kitchenElapsedSeconds(item, now))}</span></div>
              </div>
              <div className="flex items-center gap-2 mb-3 text-xs sm:text-sm text-ui-muted flex-wrap">
                <span className="rounded bg-ui-primary-soft px-2 py-0.5 text-ui-primary font-semibold">{stationName(item.station)}</span>
                {tableLabel && (
                  <span data-testid="kds-table-name" className="inline-flex items-center gap-1 font-black text-ui-text">
                    <UtensilsCrossed className="h-3.5 w-3.5" />
                    {ar ? 'الطاولة:' : 'Table:'} {tableLabel}
                  </span>
                )}
                {context?.operator_name && (
                  <span data-testid="kds-operator-name" className="inline-flex items-center gap-1 font-black text-ui-text">
                    <User className="h-3.5 w-3.5" />
                    {ar ? 'المستخدم:' : 'User:'} {context.operator_name}
                  </span>
                )}
                {item.guest_count && <span>{ar ? 'ضيوف' : 'G'}: {item.guest_count}</span>}
              </div>
              <ul className="space-y-1.5 mb-3">
                {item.items.map((it, idx) => {
                  const mods = modifierText(it.modifiers, ar);
                  return (
                    <li key={idx} className="rounded-lg bg-ui-page-alt px-2.5 py-2">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 break-words text-ui-text font-bold">{it.product_name}</span>
                        <span className="shrink-0 text-ui-muted font-bold text-base">×{it.quantity}</span>
                      </div>
                      {mods && <div data-testid="kds-item-modifiers" className="mt-1 break-words text-[11px] font-semibold text-ui-primary sm:text-xs">{mods}</div>}
                      {it.notes && <div data-testid="kds-item-note" className="mt-1 break-words text-[11px] font-bold text-ui-danger sm:text-xs">{ar ? 'ملاحظة' : 'Note'}: {it.notes}</div>}
                    </li>
                  );
                })}
              </ul>
              {item.notes && <div className="text-xs text-ui-muted italic border-t border-ui-border pt-2 mb-3 break-words">{item.notes}</div>}

              {!item.items.length && <p className="mb-3 text-xs text-ui-muted">{ar ? 'لا توجد أصناف مطبخ متبقية في هذا الطلب' : 'No kitchen items remain in this order'}</p>}
              {isVoidedEmpty && canFinishEmpty && <button disabled={finishingOrder != null} onClick={() => void finishEmpty(item.order_id)} className="w-full rounded-xl bg-ui-muted px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50">{finishingOrder === item.order_id ? (ar ? 'جاري الإنهاء...' : 'Finishing...') : (ar ? 'إنهاء الطلب الملغي الخالي من الأصناف' : 'Finish empty voided order')}</button>}
              {canUpdateKds && !isVoidedEmpty && <div className="flex gap-2 border-t border-ui-border pt-3">
                {item.kitchen_status === 'sent' && <button onClick={() => void handleKitchenStatus(item.order_id, 'cooking')} className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-ui-warning text-white py-2.5 px-3 text-sm font-bold active:scale-95 transition-all min-h-11"><ChefHat className="h-5 w-5" /> {ar ? 'بدء التحضير' : 'Start Cooking'}</button>}
                {item.kitchen_status === 'cooking' && <button onClick={() => void handleKitchenStatus(item.order_id, 'ready')} className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-ui-success text-white py-2.5 px-3 text-sm font-bold active:scale-95 transition-all min-h-11"><CheckCircle2 className="h-5 w-5" /> {ar ? 'جاهز للتقديم' : 'Mark Ready'}</button>}
                {item.kitchen_status === 'ready' && <button onClick={() => void handleKitchenStatus(item.order_id, 'served')} className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-ui-info text-white py-2.5 px-3 text-sm font-bold active:scale-95 transition-all min-h-11"><UtensilsCrossed className="h-5 w-5" /> {ar ? 'تم التقديم' : 'Served'}</button>}
              </div>}
            </div>
            );
          })}
        </div>}

        {!loading && !items.length && !loadError && view !== 'completed' && <div className="text-center py-16 text-ui-muted"><ChefHat className="h-12 w-12 mx-auto mb-3 opacity-30" /><div className="text-lg">{ar ? 'لا توجد طلبات ضمن المحطات المسموح بها' : 'No orders in your allowed stations'}</div></div>}
        {!loading && items.length > 0 && !visibleItems.length && view !== 'completed' && <p className="py-8 text-center text-ui-muted">{view === 'active' ? (ar ? 'لا توجد طلبات نشطة خلال آخر 40 دقيقة' : 'No active orders within the last 40 minutes') : (ar ? 'لا توجد طلبات تجاوزت 40 دقيقة' : 'No orders over 40 minutes')}</p>}
      </div>
    </DesignSurface>
  );
}
