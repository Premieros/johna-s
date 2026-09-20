import { useEffect, useMemo, useState } from 'react';
import { Minus, Plus, X, Check, Tag } from 'lucide-react';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { formatCurrency } from '@/lib/format';
import { ProductImage } from '@/features/catalog/components/ProductImage';
import type { CartItem, Product, ProductModifierGroup } from '@/lib/types';

interface ProductConfigModalProps {
  product: Product | null;
  initialItem?: CartItem | null;
  currency: string;
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (item: CartItem) => void;
  canDiscount?: boolean;
}

interface ModifierResponse {
  success?: boolean;
  error?: string;
  groups?: ProductModifierGroup[];
}

export function ProductConfigModal({
  product,
  initialItem,
  currency,
  isOpen,
  onClose,
  onConfirm,
  canDiscount = true,
}: ProductConfigModalProps) {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const [quantity, setQuantity] = useState(1);
  const [groups, setGroups] = useState<ProductModifierGroup[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [itemNotes, setItemNotes] = useState('');
  const [itemDiscount, setItemDiscount] = useState(0);
  const [loadingModifiers, setLoadingModifiers] = useState(false);
  const [modifierError, setModifierError] = useState('');

  useEffect(() => {
    if (!isOpen || !product) return;
    let cancelled = false;
    setQuantity(initialItem?.quantity || 1);
    setSelectedIds(initialItem?.modifier_option_ids || []);
    setItemNotes(initialItem?.item_note || '');
    setItemDiscount(initialItem?.discount_amount || 0);
    setModifierError('');
    setLoadingModifiers(true);

    api.catalog.getProductModifiers(product.id).then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setGroups([]);
        setModifierError(error.message);
        return;
      }
      const res = (data || {}) as ModifierResponse;
      if (!res.success) {
        setGroups([]);
        setModifierError(res.error || (isAr ? 'تعذر تحميل التعديلات' : 'Could not load modifiers'));
        return;
      }
      const loaded = Array.isArray(res.groups) ? res.groups : [];
      setGroups(loaded);
      if (!initialItem?.modifier_option_ids?.length) {
        const defaults: string[] = [];
        for (const group of loaded) {
          const defaultOptions = group.options.filter((o) => o.is_default).slice(0, group.max_selections);
          defaults.push(...defaultOptions.map((o) => o.id));
        }
        setSelectedIds(defaults);
      }
    }).finally(() => {
      if (!cancelled) setLoadingModifiers(false);
    });

    return () => { cancelled = true; };
  }, [isOpen, product, initialItem, isAr]);

  const optionById = useMemo(() => {
    const map = new Map<string, { group: ProductModifierGroup; option: ProductModifierGroup['options'][number] }>();
    for (const group of groups) for (const option of group.options) map.set(option.id, { group, option });
    return map;
  }, [groups]);

  if (!isOpen || !product) return null;

  const toggleOption = (group: ProductModifierGroup, optionId: string) => {
    setModifierError('');
    setSelectedIds((prev) => {
      const groupOptionIds = new Set(group.options.map((o) => o.id));
      const selectedInGroup = prev.filter((id) => groupOptionIds.has(id));
      if (prev.includes(optionId)) return prev.filter((id) => id !== optionId);
      if (group.max_selections === 1) return [...prev.filter((id) => !groupOptionIds.has(id)), optionId];
      if (selectedInGroup.length >= group.max_selections) return prev;
      return [...prev, optionId];
    });
  };

  const modifierExtra = selectedIds.reduce((sum, id) => sum + Number(optionById.get(id)?.option.price_delta || 0), 0);
  const unitPrice = Math.max(0, Number(product.sale_price || 0) + modifierExtra);
  const lineSubtotal = unitPrice * quantity;
  const lineTotal = Math.max(0, lineSubtotal - itemDiscount);

  const handleSave = () => {
    for (const group of groups) {
      const ids = new Set(group.options.map((o) => o.id));
      const count = selectedIds.filter((id) => ids.has(id)).length;
      if (count < group.min_selections) {
        setModifierError(isAr ? `يجب اختيار ${group.min_selections} على الأقل من ${group.name}` : `Choose at least ${group.min_selections} from ${group.name_en || group.name}`);
        return;
      }
      if (count > group.max_selections) {
        setModifierError(isAr ? `الحد الأقصى ${group.max_selections} في ${group.name}` : `Maximum ${group.max_selections} in ${group.name_en || group.name}`);
        return;
      }
    }

    const modifiers = selectedIds.flatMap((id) => {
      const found = optionById.get(id);
      if (!found) return [];
      return [{
        id,
        group_name: isAr ? found.group.name : found.group.name_en || found.group.name,
        name: isAr ? found.option.name : found.option.name_en || found.option.name,
        price_delta: Number(found.option.price_delta || 0),
      }];
    });

    onConfirm({
      product,
      unit_name: initialItem?.unit_name || 'piece',
      quantity,
      unit_price: unitPrice,
      discount_amount: Math.min(Math.max(itemDiscount, 0), lineSubtotal),
      bonus_quantity: initialItem?.bonus_quantity || 0,
      modifier_option_ids: selectedIds,
      modifiers,
      item_note: itemNotes.trim() || undefined,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ui-text/50 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <div className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-ui-border bg-ui-surface pb-[env(safe-area-inset-bottom)] shadow-ui-2xl sm:max-h-[86vh] sm:max-w-lg sm:rounded-2xl sm:pb-0">
        <div className="flex items-center justify-between border-b border-ui-border px-3 py-2.5 sm:px-5 sm:py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            {product.image_url ? (
              <ProductImage src={product.image_url} name={product.name} className="h-9 w-9 shrink-0 rounded-xl bg-white sm:h-10 sm:w-10" imgClassName="h-9 w-9 shrink-0 rounded-xl bg-white object-contain p-0.5 sm:h-10 sm:w-10" />
            ) : (
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ui-primary-soft text-ui-accent sm:h-10 sm:w-10"><Tag className="h-5 w-5" /></div>
            )}
            <div className="min-w-0">
              <h3 className="truncate text-sm font-black text-ui-text sm:text-base">{isAr ? product.name : product.name_en || product.name}</h3>
              <p className="text-[11px] font-bold text-ui-accent sm:text-xs">{formatCurrency(product.sale_price, currency, lang)}</p>
            </div>
          </div>
          <button onClick={onClose} aria-label={isAr ? 'إغلاق' : 'Close'} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-ui-subtle hover:bg-ui-page-alt hover:text-ui-text"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 sm:space-y-4 sm:p-5">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-ui-border bg-ui-page-alt px-3 py-2">
            <label className="text-xs font-black text-ui-muted">{isAr ? 'الكمية' : 'Quantity'}</label>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label={isAr ? 'تقليل' : 'Decrease'} className="flex h-9 w-9 items-center justify-center rounded-lg border border-ui-border bg-ui-surface text-ui-text active:scale-95"><Minus className="h-4 w-4" /></button>
              <span className="w-10 text-center text-lg font-black text-ui-text">{quantity}</span>
              <button type="button" onClick={() => setQuantity((q) => q + 1)} aria-label={isAr ? 'زيادة' : 'Increase'} className="flex h-9 w-9 items-center justify-center rounded-lg bg-ui-accent text-ui-primary-fg active:scale-95"><Plus className="h-4 w-4" /></button>
            </div>
          </div>

          {loadingModifiers && <p className="text-xs font-bold text-ui-muted">{isAr ? 'جاري تحميل الاختيارات...' : 'Loading options...'}</p>}

          {!loadingModifiers && groups.map((group) => {
            const selectedCount = selectedIds.filter((id) => group.options.some((o) => o.id === id)).length;
            return (
              <div key={group.id} data-testid={`modifier-group-${group.id}`} className="rounded-xl border border-ui-border/70 p-2.5">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <label className="text-[11px] font-black text-ui-muted sm:text-xs">{isAr ? group.name : group.name_en || group.name}</label>
                  <span className="text-[9px] font-bold text-ui-subtle sm:text-[10px]">{group.min_selections > 0 ? (isAr ? 'مطلوب' : 'Required') : (isAr ? 'اختياري' : 'Optional')} · {selectedCount}/{group.max_selections}</span>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {group.options.map((option) => {
                    const active = selectedIds.includes(option.id);
                    const delta = Number(option.price_delta || 0);
                    return (
                      <button key={option.id} type="button" data-testid={`modifier-option-${option.id}`} aria-pressed={active} onClick={() => toggleOption(group, option.id)} className={`flex min-h-10 min-w-0 items-center justify-between gap-1 rounded-lg border px-2 py-1.5 text-[11px] font-bold transition sm:text-xs ${active ? 'border-ui-primary bg-ui-primary-soft text-ui-accent' : 'border-ui-border bg-ui-page-alt text-ui-muted hover:bg-ui-surface'}`}>
                        <span className="flex min-w-0 items-center gap-1 text-start leading-tight">{active && <Check className="h-3 w-3 shrink-0 text-ui-accent" />}<span className="break-words">{isAr ? option.name : option.name_en || option.name}</span></span>
                        {delta !== 0 && <span className="shrink-0 text-[9px] font-black opacity-80 sm:text-[10px]">{delta > 0 ? '+' : ''}{formatCurrency(delta, currency, lang)}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] font-black text-ui-muted">{isAr ? 'ملاحظات الصنف' : 'Item Notes'}</label>
              <input type="text" value={itemNotes} onChange={(e) => setItemNotes(e.target.value)} placeholder={isAr ? 'مثال: بدون صوص...' : 'e.g., no sauce...'} className="h-10 w-full rounded-lg border border-ui-border bg-ui-page-alt px-3 text-xs font-bold text-ui-text outline-none focus:border-ui-primary focus:ring-2 focus:ring-ui-ring" />
            </div>
            {canDiscount && (
              <div>
                <label className="mb-1 block text-[11px] font-black text-ui-muted">{isAr ? 'خصم الصنف' : 'Item Discount'} ({currency})</label>
                <input type="number" min={0} max={lineSubtotal} value={itemDiscount || ''} onChange={(e) => setItemDiscount(parseFloat(e.target.value) || 0)} placeholder="0" className="h-10 w-full rounded-lg border border-ui-border bg-ui-page-alt px-3 text-xs font-bold text-ui-text outline-none focus:border-ui-primary focus:ring-2 focus:ring-ui-ring" />
              </div>
            )}
          </div>

          {modifierError && <div className="rounded-lg border border-ui-danger/30 bg-ui-danger/10 px-3 py-2 text-xs font-bold text-ui-danger">{modifierError}</div>}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-ui-border bg-ui-page-alt px-3 py-2.5 sm:px-5 sm:py-3">
          <div className="min-w-0">
            <p className="text-[9px] font-bold text-ui-subtle sm:text-[10px]">{isAr ? 'الإجمالي' : 'Total'}</p>
            <p className="truncate text-base font-black text-ui-accent sm:text-lg">{formatCurrency(lineTotal, currency, lang)}</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onClose} className="min-h-10 rounded-lg border border-ui-border bg-ui-surface px-3 text-[11px] font-black text-ui-muted">{t('cancel')}</button>
            <button type="button" disabled={loadingModifiers} onClick={handleSave} className="min-h-10 rounded-lg bg-ui-primary px-4 text-[11px] font-black text-ui-primary-fg shadow-ui-sm disabled:opacity-50 sm:px-5 sm:text-xs">{initialItem ? (isAr ? 'تحديث' : 'Update') : (isAr ? 'إضافة' : 'Add')}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
