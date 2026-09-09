import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, ChefHat, CheckCircle2, UtensilsCrossed, Volume2, VolumeX } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { DesignSurface, DesignPageHeader } from '@/components/design/DesignSurface';
import { Button } from '@/components/Button';
import { Select } from '@/components/Input';
import { supabase } from '@/api';
import { catalog } from '@/api/domains/catalog';
import { subscribePosRealtime } from '@/features/pos/services/posRealtime';
import type { KitchenQueueItem, KitchenStation } from '@/lib/types';

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
  const ar = lang === 'ar';
  const branchFilter = useBranchFilter();
  const can = useCan();
  const canUpdateKds = can('pos.kds_update');
  const [station, setStation] = useState('');
  const [items, setItems] = useState<KitchenQueueItem[]>([]);
  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const prevCountRef = useRef(0);

  const loadStations = useCallback(async () => {
    if (!branchFilter) {
      setStations([]);
      setStation('');
      return;
    }
    try {
      const { data, error } = await supabase.rpc('get_my_kitchen_stations', { p_branch_id: branchFilter });
      if (error) throw error;
      const allowed = (Array.isArray(data) ? data : []) as KitchenStation[];
      setStations(allowed);
      setStation((current) => current && allowed.some((s) => s.code === current) ? current : '');
    } catch {
      setStations([]);
    }
  }, [branchFilter]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      if (!branchFilter) {
        setItems([]);
        prevCountRef.current = 0;
        return;
      }
      const { data, error } = await supabase.rpc('get_kitchen_queue', {
        p_station: station || null,
        p_branch_id: branchFilter,
      });
      if (error) throw error;
      const newItems = (data ?? []) as KitchenQueueItem[];
      if (soundEnabled && prevCountRef.current > 0 && newItems.length > prevCountRef.current) playBeep();
      prevCountRef.current = newItems.length;
      setItems(newItems);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [branchFilter, station, soundEnabled]);

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
    if (!branchFilter) return;
    const unsubscribe = subscribePosRealtime({ branchId: branchFilter, onEvent: () => { void load(); }, debounceMs: 500 });
    return unsubscribe;
  }, [branchFilter, load]);

  useEffect(() => {
    const id = setInterval(() => { void load(); }, 30000);
    return () => clearInterval(id);
  }, [load]);

  const handleKitchenStatus = async (orderId: string, status: string) => {
    if (!canUpdateKds) return;
    try {
      await catalog.setKitchenStatus(orderId, status);
      void load();
    } catch { /* keep KDS interaction quiet */ }
  };

  const stationName = (v: string) => {
    const s = stations.find(st => st.code === v);
    if (s) return ar ? s.name_ar : s.name_en;
    return v;
  };

  return (
    <DesignSurface testId="kitchen-display">
      <DesignPageHeader title={ar ? 'شاشة المطبخ' : 'Kitchen Display'} subtitle={ar ? 'الطلبات النشطة حسب المحطات المسموح بها للمستخدم' : 'Active orders for the stations assigned to this user'} />
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <Select value={station} onChange={e => setStation(e.target.value)} className="min-w-0 flex-1 sm:w-44 sm:flex-none">
            <option value="">{ar ? 'كل المحطات المسموح بها' : 'All Allowed Stations'}</option>
            {stations.filter(s => s.is_active).map(s => <option key={s.code} value={s.code}>{ar ? s.name_ar : s.name_en}</option>)}
          </Select>
          <Button onClick={() => void load()} variant="outline"><RefreshCw className="h-4 w-4" /> {ar ? 'تحديث' : 'Refresh'}</Button>
          <button onClick={() => setSoundEnabled(!soundEnabled)} className="rounded-lg p-2 text-ui-muted hover:bg-ui-muted/10 transition" title={soundEnabled ? (ar ? 'كتم الصوت' : 'Mute') : (ar ? 'تشغيل الصوت' : 'Unmute')}>
            {soundEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          </button>
          <span className="w-full text-xs text-ui-muted sm:w-auto sm:text-sm"><span className="me-1 inline-block h-2 w-2 rounded-full bg-ui-success animate-pulse" />{items.length} {ar ? 'طلب/محطة نشطة' : 'active order/station cards'}</span>
        </div>

        {loading && !items.length && <div className="text-ui-muted py-8 text-center">{ar ? 'جاري التحميل...' : 'Loading...'}</div>}

        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {items.map(item => (
            <div key={`${item.order_id}-${item.station}`} className={`rounded-2xl border bg-ui-surface p-3 sm:p-4 shadow-ui-sm transition-all ${item.kitchen_status === 'cooking' ? 'border-ui-warning/40 ring-1 ring-ui-warning' : item.kitchen_status === 'ready' ? 'border-ui-success/40 ring-1 ring-ui-success' : 'border-ui-border'}`}>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="font-bold text-ui-text text-base sm:text-lg">#{item.order_number}</span>
                <div className="flex items-center gap-1.5">{statusBadge(item.kitchen_status, ar)}<span className={`text-xs sm:text-sm ${elapsedColor(item.elapsed_seconds)}`}>{formatElapsed(item.elapsed_seconds)}</span></div>
              </div>
              <div className="flex items-center gap-2 mb-3 text-xs sm:text-sm text-ui-muted flex-wrap">
                <span className="rounded bg-ui-primary-soft px-2 py-0.5 text-ui-primary font-semibold">{stationName(item.station)}</span>
                {item.table_number && <span>{ar ? 'طاولة' : 'T'} {item.table_number}</span>}
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

              {canUpdateKds && <div className="flex gap-2 border-t border-ui-border pt-3">
                {item.kitchen_status === 'sent' && <button onClick={() => void handleKitchenStatus(item.order_id, 'cooking')} className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-ui-warning text-white py-2.5 px-3 text-sm font-bold active:scale-95 transition-all min-h-11"><ChefHat className="h-5 w-5" /> {ar ? 'بدء التحضير' : 'Start Cooking'}</button>}
                {item.kitchen_status === 'cooking' && <button onClick={() => void handleKitchenStatus(item.order_id, 'ready')} className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-ui-success text-white py-2.5 px-3 text-sm font-bold active:scale-95 transition-all min-h-11"><CheckCircle2 className="h-5 w-5" /> {ar ? 'جاهز للتقديم' : 'Mark Ready'}</button>}
                {item.kitchen_status === 'ready' && <button onClick={() => void handleKitchenStatus(item.order_id, 'served')} className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-ui-info text-white py-2.5 px-3 text-sm font-bold active:scale-95 transition-all min-h-11"><UtensilsCrossed className="h-5 w-5" /> {ar ? 'تم التقديم' : 'Served'}</button>}
              </div>}
            </div>
          ))}
        </div>

        {!loading && !items.length && <div className="text-center py-16 text-ui-muted"><ChefHat className="h-12 w-12 mx-auto mb-3 opacity-30" /><div className="text-lg">{ar ? 'لا توجد طلبات نشطة ضمن المحطات المسموح بها' : 'No active orders in your allowed stations'}</div></div>}
      </div>
    </DesignSurface>
  );
}
