import { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { ArrowLeft, Grid2X2 } from 'lucide-react';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useLatestRead } from '@/hooks/useLatestRead';
import type { Category } from '@/lib/types';

interface StationRow {
  id: string;
  branch_id: string;
  name_ar: string;
  name_en: string;
  is_active: boolean;
}
interface Props {
  branchId: string | null;
  userId: string | null;
  categories: Category[];
  selectedCategory: string;
  onSelectCategory: (id: string) => void;
}
const button = 'min-h-11 rounded-xl border px-3 py-2 text-xs font-black transition active:scale-[.98]';

/** Read existing branch stations; category_ids use the same categories FK as assignments. */
export function MobileStationCategories({ branchId, userId, categories, selectedCategory, onSelectCategory }: Props) {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const [selection, setSelection] = useState<string | null>(null);
  useLayoutEffect(() => { onSelectCategory(''); }, [branchId, userId, onSelectCategory]);
  const read = useCallback(async () => {
    if (!branchId || !userId || !navigator.onLine) return [] as StationRow[];
    const { data, error } = await supabase.from('kitchen_stations')
      .select('id,branch_id,name_ar,name_en,is_active,sort_order')
      .eq('branch_id', branchId).eq('is_active', true).order('sort_order');
    if (error) throw error;
    return ((data || []) as StationRow[]).filter((station) => station.branch_id === branchId && station.is_active);
  }, [branchId, userId]);
  const stationsRead = useLatestRead(read);
  const branchCategories = useMemo(() => categories.filter((category) => category.branch_id === branchId), [categories, branchId]);
  const stations = useMemo(() => (stationsRead.data || []).map((station) => ({
    ...station,
    category_ids: branchCategories.filter((category) => category.kitchen_station_id === station.id).map((category) => category.id),
  })).filter((station) => station.category_ids.length > 0), [stationsRead.data, branchCategories]);
  const selectedStation = stations.find((station) => station.id === selection);
  const allCategories = selection === 'all';
  const showCategories = allCategories || !!selectedStation || stations.length === 0;
  const visibleCategories = selectedStation
    ? branchCategories.filter((category) => selectedStation.category_ids.includes(category.id))
    : branchCategories;
  const reset = () => { setSelection(null); onSelectCategory(''); };

  return (
    <div data-testid="pos-mobile-station-navigation" className="space-y-2 sm:hidden">
      {!!stationsRead.error && (
        <div role="status" className="flex items-center justify-between gap-2 text-xs text-ui-muted">
          <span>{isAr ? 'تعذر تحميل المحطات؛ الفئات متاحة' : 'Stations unavailable; categories remain available'}</span>
          <button type="button" onClick={() => void stationsRead.reload()} className={`${button} shrink-0 border-ui-border`}>{isAr ? 'إعادة المحاولة' : 'Retry'}</button>
        </div>
      )}
      {!showCategories ? (
        <div data-testid="pos-station-cards" className="grid grid-cols-3 gap-2">
          <button type="button" data-testid="pos-station-all" onClick={() => { setSelection('all'); onSelectCategory(''); }} className={`${button} border-ui-primary bg-ui-primary-soft text-ui-accent`}>
            <Grid2X2 className="mx-auto mb-1 h-4 w-4" />{isAr ? 'الكل' : 'All'}
          </button>
          {stations.map((station) => (
            <button key={station.id} type="button" data-testid={`pos-station-${station.id}`} onClick={() => { setSelection(station.id); onSelectCategory(''); }} className={`${button} border-ui-border bg-ui-surface text-ui-text`}>
              {isAr ? station.name_ar : station.name_en || station.name_ar}
            </button>
          ))}
        </div>
      ) : (
        <>
          {stations.length > 0 && (
            <div className="flex items-center gap-2">
              <button type="button" data-testid="pos-station-back" onClick={reset} className={`${button} flex shrink-0 items-center gap-1 border-ui-border bg-ui-page-alt text-ui-text`}>
                <ArrowLeft className={`h-4 w-4 ${isAr ? 'rotate-180' : ''}`} />{isAr ? 'المحطات' : 'Stations'}
              </button>
              <span className="truncate text-xs font-black text-ui-muted">{selectedStation ? (isAr ? selectedStation.name_ar : selectedStation.name_en || selectedStation.name_ar) : (isAr ? 'كل الفئات' : 'All categories')}</span>
            </div>
          )}
          <div data-testid="pos-mobile-station-categories" className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
            <button type="button" data-testid="pos-station-category-all" onClick={() => { setSelection('all'); onSelectCategory(''); }} className={`${button} shrink-0 ${!selectedCategory ? 'border-ui-primary bg-ui-primary text-ui-primary-fg' : 'border-ui-border bg-ui-surface text-ui-muted'}`}>
              {isAr ? 'الكل' : 'All'}
            </button>
            {visibleCategories.map((category) => (
              <button key={category.id} type="button" data-testid={`pos-station-category-${category.id}`} onClick={() => onSelectCategory(selectedCategory === category.id ? '' : category.id)} className={`${button} shrink-0 ${selectedCategory === category.id ? 'border-ui-primary bg-ui-primary text-ui-primary-fg' : 'border-ui-border bg-ui-surface text-ui-muted'}`}>
                {isAr ? category.name : category.name_en || category.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
