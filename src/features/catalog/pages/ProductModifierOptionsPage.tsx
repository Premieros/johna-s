import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Search } from 'lucide-react';
import { Link } from 'react-router-dom';
import * as api from '@/api';
import { APP_ROUTES } from '@/core/navigation/routes';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import type { InventoryUnit } from '@/lib/types';

type InventoryEffect = {
  target_type: 'raw_material' | 'inventory_unit';
  target_id: string;
  quantity_delta: number;
};

type AdminGroupsResponse = {
  success?: boolean;
  error?: string;
  detail?: string;
  groups?: Array<{
    id?: string;
    name?: string;
    options?: Array<{
      id?: string;
      name?: string;
      price_delta?: number;
      inventory_effects?: InventoryEffect[];
    }>;
  }>;
};

export function ProductModifierOptionsPage() {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const branchFilter = useBranchFilter();
  const { show } = useToast();
  const [units, setUnits] = useState<InventoryUnit[]>([]);
  const [usage, setUsage] = useState<Record<string, { count: number; prices: number[] }>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!branchFilter) {
      setUnits([]);
      setUsage({});
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [componentUnits, groupsResult] = await Promise.all([
        api.catalog.listInventoryUnits({ branch_id: branchFilter, unit_type: 'manufactured', is_active: true }),
        api.catalog.listModifierGroupsAdmin(branchFilter),
      ]);
      if (groupsResult.error) throw groupsResult.error;
      const groups = (groupsResult.data || {}) as AdminGroupsResponse;
      if (!groups.success) throw new Error(groups.detail || groups.error || 'LOAD_MODIFIER_OPTIONS_FAILED');

      const nextUsage: Record<string, { count: number; prices: number[] }> = {};
      for (const group of groups.groups || []) {
        for (const option of group.options || []) {
          const effect = (option.inventory_effects || []).find((candidate) => candidate.target_type === 'inventory_unit' && Number(candidate.quantity_delta) === 1);
          if (!effect) continue;
          const current = nextUsage[effect.target_id] || { count: 0, prices: [] };
          current.count += 1;
          current.prices.push(Number(option.price_delta || 0));
          nextUsage[effect.target_id] = current;
        }
      }
      setUnits((componentUnits || []) as InventoryUnit[]);
      setUsage(nextUsage);
    } catch (err) {
      show(err instanceof Error ? err.message : 'Failed to load options', 'error');
    } finally {
      setLoading(false);
    }
  }, [branchFilter, show]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return units;
    return units.filter((unit) => `${unit.name} ${unit.name_en || ''} ${unit.code || ''} ${unit.sku || ''}`.toLowerCase().includes(q));
  }, [units, search]);

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-black text-ui-text">{isAr ? 'الخيارات' : 'Options'}</h1>
          <p className="mt-1 text-sm text-ui-muted">{isAr ? 'كل اختيار يأتي من مجموعة مكونات بنفس الاسم؛ لا توجد عملية تصنيع أو إنتاج هنا.' : 'Each option comes from a same-name component group; no production workflow is involved.'}</p>
        </div>
        <div className="flex gap-2">
          <Link to={APP_ROUTES.productModifiers} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-ui-border bg-ui-surface px-4 font-bold text-ui-text"><ArrowLeft className="h-4 w-4" />{isAr ? 'المجموعات' : 'Groups'}</Link>
          <Link to={APP_ROUTES.inventoryUnits} className="inline-flex min-h-11 items-center rounded-xl bg-ui-primary px-4 font-bold text-ui-primary-fg">{isAr ? 'إدارة المكونات' : 'Manage components'}</Link>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ui-subtle" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={isAr ? 'بحث في الخيارات' : 'Search options'} className="min-h-11 w-full rounded-xl border border-ui-border bg-ui-surface ps-9 pe-3" />
      </div>

      {!branchFilter ? (
        <div className="rounded-2xl border border-ui-border bg-ui-surface p-6 text-center text-ui-muted">{isAr ? 'اختر الفرع أولًا.' : 'Select the active branch first.'}</div>
      ) : loading ? (
        <div className="py-16 text-center text-ui-muted">{isAr ? 'جاري التحميل…' : 'Loading…'}</div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-ui-border bg-ui-surface">
          <div className="hidden grid-cols-[2fr_1fr_1fr] gap-3 border-b border-ui-border bg-ui-page-alt px-4 py-3 text-xs font-black text-ui-muted md:grid">
            <span>{isAr ? 'الخيار' : 'Option'}</span><span>{isAr ? 'الاستخدام' : 'Usage'}</span><span>{isAr ? 'فرق السعر' : 'Price deltas'}</span>
          </div>
          {visible.map((unit) => {
            const info = usage[unit.id];
            const prices = Array.from(new Set((info?.prices || []).map((price) => Number(price.toFixed(2)))));
            return (
              <div key={unit.id} className="grid gap-1 border-b border-ui-border px-4 py-3 last:border-b-0 md:grid-cols-[2fr_1fr_1fr] md:items-center md:gap-3">
                <div className="min-w-0"><p className="truncate font-black text-ui-text">{isAr ? unit.name : unit.name_en || unit.name}</p><p className="text-xs text-ui-muted">{unit.code}</p></div>
                <p className="text-sm text-ui-muted">{info?.count || 0} {isAr ? 'مجموعة' : 'groups'}</p>
                <p className="text-sm font-bold text-ui-text">{prices.length ? prices.map((price) => price > 0 ? `+${price}` : String(price)).join(' / ') : '—'}</p>
              </div>
            );
          })}
          {visible.length === 0 && <div className="p-10 text-center text-ui-muted">{isAr ? 'لا توجد خيارات مطابقة.' : 'No matching options.'}</div>}
        </div>
      )}
    </div>
  );
}
