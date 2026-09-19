import { useEffect, useMemo, useState } from 'react';
import { BadgeDollarSign, Boxes, Package, RefreshCw, Save } from 'lucide-react';
import { costing, supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/Button';
import { DesignPanel, DesignPageHeader, DesignSearch, DesignSurface } from '@/components/design';
import { useCan } from '@/lib/permissions';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useBranches } from '@/hooks/useBranches';
import { logAudit } from '@/lib/audit';
import { formatNumber } from '@/lib/format';

type PricingTab = 'raw' | 'manufactured' | 'products';

type RawPriceRow = {
  id: string;
  code: string | null;
  name: string;
  branch_id: string | null;
  default_cost: number | null;
  is_active: boolean;
};

type ManufacturedPriceRow = {
  id: string;
  code: string | null;
  name: string;
  branch_id: string | null;
  cost_price: number | null;
  sale_price: number | null;
  is_active: boolean;
};

type ProductPriceRow = {
  id: string;
  sku: string | null;
  name: string;
  branch_id: string | null;
  cost_price: number | null;
  sale_price: number | null;
  wholesale_price: number | null;
  is_active: boolean;
};

type RawDraft = { default_cost: number };
type ManufacturedDraft = { cost_price: number; sale_price: number };
type ProductDraft = { cost_price: number; sale_price: number; wholesale_price: number };

const safePrice = (value: number | string | null | undefined) => {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

export function PricingPage() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const { show } = useToast();
  const can = useCan();
  const branchId = useBranchFilter();
  const { branches } = useBranches();

  const canRawView = can('raw_materials.view');
  const canRawEdit = can('raw_materials.manage');
  const canProductsView = can('products.view');
  const canProductsEdit = can('products.edit');

  const visibleTabs = useMemo(() => {
    const tabs: PricingTab[] = [];
    if (canRawView) tabs.push('raw', 'manufactured');
    if (canProductsView) tabs.push('products');
    return tabs;
  }, [canProductsView, canRawView]);

  const [tab, setTab] = useState<PricingTab>('products');
  const [search, setSearch] = useState('');
  const [rawRows, setRawRows] = useState<RawPriceRow[]>([]);
  const [manufacturedRows, setManufacturedRows] = useState<ManufacturedPriceRow[]>([]);
  const [productRows, setProductRows] = useState<ProductPriceRow[]>([]);
  const [rawDrafts, setRawDrafts] = useState<Record<string, RawDraft>>({});
  const [manufacturedDrafts, setManufacturedDrafts] = useState<Record<string, ManufacturedDraft>>({});
  const [productDrafts, setProductDrafts] = useState<Record<string, ProductDraft>>({});
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const branchName = branches.find((branch) => branch.id === branchId)?.name || (ar ? 'الفرع الحالي' : 'Current branch');

  useEffect(() => {
    if (!visibleTabs.length) return;
    if (!visibleTabs.includes(tab)) setTab(visibleTabs[0]);
  }, [tab, visibleTabs]);

  async function load() {
    if (!branchId) {
      setRawRows([]);
      setManufacturedRows([]);
      setProductRows([]);
      return;
    }

    setLoading(true);
    try {
      const [rawResult, manufacturedResult, productResult] = await Promise.all([
        canRawView
          ? supabase
              .from('raw_materials')
              .select('id,code,name,branch_id,default_cost,is_active')
              .eq('branch_id', branchId)
              .order('name')
          : Promise.resolve({ data: [], error: null }),
        canRawView
          ? supabase
              .from('inventory_units')
              .select('id,code,name,branch_id,cost_price,sale_price,is_active')
              .eq('branch_id', branchId)
              .eq('unit_type', 'manufactured')
              .order('name')
          : Promise.resolve({ data: [], error: null }),
        canProductsView
          ? supabase
              .from('products')
              .select('id,sku,name,branch_id,cost_price,sale_price,wholesale_price,is_active')
              .eq('branch_id', branchId)
              .order('name')
          : Promise.resolve({ data: [], error: null }),
      ]);

      const firstError = rawResult.error || manufacturedResult.error || productResult.error;
      if (firstError) {
        show(firstError.message, 'error');
        return;
      }

      const nextRaw = (rawResult.data || []) as RawPriceRow[];
      const nextManufactured = (manufacturedResult.data || []) as ManufacturedPriceRow[];
      const nextProducts = (productResult.data || []) as ProductPriceRow[];

      setRawRows(nextRaw);
      setManufacturedRows(nextManufactured);
      setProductRows(nextProducts);
      setRawDrafts(Object.fromEntries(nextRaw.map((row) => [row.id, { default_cost: safePrice(row.default_cost) }])));
      setManufacturedDrafts(Object.fromEntries(nextManufactured.map((row) => [row.id, {
        cost_price: safePrice(row.cost_price),
        sale_price: safePrice(row.sale_price),
      }])));
      setProductDrafts(Object.fromEntries(nextProducts.map((row) => [row.id, {
        cost_price: safePrice(row.cost_price),
        sale_price: safePrice(row.sale_price),
        wholesale_price: safePrice(row.wholesale_price),
      }])));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // The active branch is the operational scope. Permission changes cause a new
    // session/context load and therefore a fresh page mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId]);

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const matches = (name: string, code?: string | null) =>
    !normalizedSearch ||
    name.toLocaleLowerCase().includes(normalizedSearch) ||
    (code || '').toLocaleLowerCase().includes(normalizedSearch);

  const visibleRaw = rawRows.filter((row) => matches(row.name, row.code));
  const visibleManufactured = manufacturedRows.filter((row) => matches(row.name, row.code));
  const visibleProducts = productRows.filter((row) => matches(row.name, row.sku));

  async function saveRaw(row: RawPriceRow) {
    if (!branchId || !canRawEdit) return;
    const draft = rawDrafts[row.id];
    if (!draft) return;
    setSavingId(row.id);
    const nextCost = safePrice(draft.default_cost);
    const { data, error } = await costing.setRawMaterialPrice({
      p_raw_material_id: row.id,
      p_branch_id: branchId,
      p_unit_cost: nextCost,
      p_note: ar ? 'تسعير يدوي من شاشة التسعير' : 'Manual price from pricing workspace',
    });
    if (error) {
      show(error.message, 'error');
      setSavingId(null);
      return;
    }
    if (!data?.success) {
      show(data?.error || (ar ? 'تعذر حفظ سعر الخامة' : 'Could not save raw-material price'), 'error');
      setSavingId(null);
      return;
    }
    await logAudit('update', 'raw_materials', row.id, {
      pricing: { default_cost: { from: safePrice(row.default_cost), to: nextCost } },
    });
    setRawRows((rows) => rows.map((item) => item.id === row.id ? { ...item, default_cost: nextCost } : item));
    show(ar ? 'تم حفظ سعر الخامة' : 'Raw-material price saved', 'success');
    setSavingId(null);
  }

  async function saveManufactured(row: ManufacturedPriceRow) {
    if (!branchId || !canRawEdit) return;
    const draft = manufacturedDrafts[row.id];
    if (!draft) return;
    setSavingId(row.id);
    const nextCost = safePrice(draft.cost_price);
    const nextSale = safePrice(draft.sale_price);
    const { error } = await supabase
      .from('inventory_units')
      .update({ cost_price: nextCost, sale_price: nextSale })
      .eq('id', row.id)
      .eq('branch_id', branchId)
      .eq('unit_type', 'manufactured');
    if (error) {
      show(error.message, 'error');
      setSavingId(null);
      return;
    }
    await logAudit('update', 'inventory_units', row.id, {
      pricing: {
        cost_price: { from: safePrice(row.cost_price), to: nextCost },
        sale_price: { from: safePrice(row.sale_price), to: nextSale },
      },
    });
    setManufacturedRows((rows) => rows.map((item) => item.id === row.id ? { ...item, cost_price: nextCost, sale_price: nextSale } : item));
    show(ar ? 'تم حفظ تسعير المصنع' : 'Manufactured-item pricing saved', 'success');
    setSavingId(null);
  }

  async function saveProduct(row: ProductPriceRow) {
    if (!branchId || !canProductsEdit) return;
    const draft = productDrafts[row.id];
    if (!draft) return;
    setSavingId(row.id);
    const nextCost = safePrice(draft.cost_price);
    const nextSale = safePrice(draft.sale_price);
    const nextWholesale = safePrice(draft.wholesale_price);
    const { error } = await supabase
      .from('products')
      .update({ cost_price: nextCost, sale_price: nextSale, wholesale_price: nextWholesale })
      .eq('id', row.id)
      .eq('branch_id', branchId);
    if (error) {
      show(error.message, 'error');
      setSavingId(null);
      return;
    }
    await logAudit('update', 'products', row.id, {
      pricing: {
        cost_price: { from: safePrice(row.cost_price), to: nextCost },
        sale_price: { from: safePrice(row.sale_price), to: nextSale },
        wholesale_price: { from: safePrice(row.wholesale_price), to: nextWholesale },
      },
    });
    setProductRows((rows) => rows.map((item) => item.id === row.id ? {
      ...item,
      cost_price: nextCost,
      sale_price: nextSale,
      wholesale_price: nextWholesale,
    } : item));
    show(ar ? 'تم حفظ تسعير المنتج' : 'Product pricing saved', 'success');
    setSavingId(null);
  }

  const priceInput = (
    value: number,
    onChange: (value: number) => void,
    disabled: boolean,
    label: string,
  ) => (
    <input
      type="number"
      min="0"
      step="0.01"
      value={value}
      onChange={(event) => onChange(safePrice(event.target.value))}
      disabled={disabled}
      aria-label={label}
      className="w-28 rounded-lg border border-ui-border bg-ui-surface px-2.5 py-2 text-end text-sm tabular-nums text-ui-text outline-none focus:border-ui-primary focus:ring-2 focus:ring-ui-ring disabled:cursor-not-allowed disabled:bg-ui-page-alt disabled:text-ui-subtle"
    />
  );

  const tabMeta: Record<PricingTab, { label: string; icon: React.ReactNode }> = {
    raw: { label: ar ? 'الخامات' : 'Raw materials', icon: <Boxes className="h-4 w-4" /> },
    manufactured: { label: ar ? 'المصنعات' : 'Manufactured items', icon: <Package className="h-4 w-4" /> },
    products: { label: ar ? 'المنتجات' : 'Products', icon: <BadgeDollarSign className="h-4 w-4" /> },
  };

  const currentCount = tab === 'raw'
    ? visibleRaw.length
    : tab === 'manufactured'
      ? visibleManufactured.length
      : visibleProducts.length;

  return (
    <DesignSurface testId="pricing-page">
      <DesignPageHeader
        title={ar ? 'التسعير' : 'Pricing'}
        subtitle={ar
          ? `تسعير الخامات والمصنعات والمنتجات داخل ${branchName}. تسعير الخامة يدخل تاريخ مركز التكلفة ويصبح السعر المعتمد حتى حدث أحدث، بدون تغيير متوسط المخزون.`
          : `Manage pricing for ${branchName}. Raw-material pricing enters Costing Center history and stays authoritative until a newer pricing, purchase, or stock-count event, without changing inventory average cost.`}
        actions={(
          <Button size="sm" variant="secondary" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {ar ? 'تحديث' : 'Refresh'}
          </Button>
        )}
      />

      <div className="flex flex-wrap gap-2" data-testid="pricing-tabs">
        {visibleTabs.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition ${tab === key ? 'bg-ui-primary text-ui-primary-fg shadow-ui-sm' : 'border border-ui-border bg-ui-surface text-ui-muted hover:bg-ui-page-alt'}`}
          >
            {tabMeta[key].icon}
            {tabMeta[key].label}
          </button>
        ))}
      </div>

      <DesignPanel testId="pricing-search-panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <DesignSearch
            value={search}
            onChange={setSearch}
            label={ar ? 'بحث في التسعير' : 'Search pricing'}
            placeholder={ar ? 'ابحث بالاسم أو الكود...' : 'Search by name or code...'}
            testId="pricing-search"
            className="flex-1"
          />
          <div className="shrink-0 rounded-xl border border-ui-border bg-ui-page-alt px-3 py-2 text-sm text-ui-muted">
            {ar ? `${currentCount} عنصر` : `${currentCount} items`}
          </div>
        </div>
      </DesignPanel>

      <DesignPanel testId="pricing-table-panel">
        {!branchId ? (
          <div className="py-12 text-center text-sm text-ui-muted">{ar ? 'اختر فرعًا أولًا.' : 'Select a branch first.'}</div>
        ) : loading ? (
          <div className="py-12 text-center text-sm text-ui-muted">{ar ? 'جاري تحميل الأسعار...' : 'Loading prices...'}</div>
        ) : (
          <div className="max-h-[65vh] overflow-auto rounded-xl border border-ui-border">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-ui-surface-raised text-ui-muted shadow-ui-xs">
                <tr>
                  <th className="px-4 py-3 text-start">{ar ? 'الصنف' : 'Item'}</th>
                  <th className="px-4 py-3 text-start">{ar ? 'الكود' : 'Code'}</th>
                  {tab === 'raw' ? (
                    <th className="px-4 py-3 text-end">{ar ? 'سعر التسعير' : 'Pricing cost'}</th>
                  ) : (
                    <>
                      <th className="px-4 py-3 text-end">{ar ? 'التكلفة' : 'Cost'}</th>
                      <th className="px-4 py-3 text-end">{ar ? 'سعر البيع' : 'Sale price'}</th>
                      {tab === 'products' && <th className="px-4 py-3 text-end">{ar ? 'سعر الجملة' : 'Wholesale'}</th>}
                    </>
                  )}
                  <th className="px-4 py-3 text-center">{ar ? 'الحالة' : 'Status'}</th>
                  <th className="px-4 py-3 text-center">{ar ? 'حفظ' : 'Save'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ui-border bg-ui-surface">
                {tab === 'raw' && visibleRaw.map((row) => {
                  const draft = rawDrafts[row.id] || { default_cost: safePrice(row.default_cost) };
                  return (
                    <tr key={row.id} className="hover:bg-ui-page-alt/70">
                      <td className="px-4 py-3 font-semibold text-ui-text">{row.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-ui-muted">{row.code || '-'}</td>
                      <td className="px-4 py-3 text-end">
                        {priceInput(draft.default_cost, (value) => setRawDrafts((state) => ({ ...state, [row.id]: { default_cost: value } })), !canRawEdit, `${row.name} ${ar ? 'سعر الخامة' : 'raw price'}`)}
                      </td>
                      <td className="px-4 py-3 text-center"><Status active={row.is_active} ar={ar} /></td>
                      <td className="px-4 py-3 text-center">
                        {canRawEdit && <SaveButton loading={savingId === row.id} onClick={() => saveRaw(row)} ar={ar} />}
                      </td>
                    </tr>
                  );
                })}

                {tab === 'manufactured' && visibleManufactured.map((row) => {
                  const draft = manufacturedDrafts[row.id] || { cost_price: safePrice(row.cost_price), sale_price: safePrice(row.sale_price) };
                  return (
                    <tr key={row.id} className="hover:bg-ui-page-alt/70">
                      <td className="px-4 py-3 font-semibold text-ui-text">{row.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-ui-muted">{row.code || '-'}</td>
                      <td className="px-4 py-3 text-end">
                        {priceInput(draft.cost_price, (value) => setManufacturedDrafts((state) => ({ ...state, [row.id]: { ...draft, cost_price: value } })), !canRawEdit, `${row.name} ${ar ? 'التكلفة' : 'cost'}`)}
                      </td>
                      <td className="px-4 py-3 text-end">
                        {priceInput(draft.sale_price, (value) => setManufacturedDrafts((state) => ({ ...state, [row.id]: { ...draft, sale_price: value } })), !canRawEdit, `${row.name} ${ar ? 'سعر البيع' : 'sale price'}`)}
                      </td>
                      <td className="px-4 py-3 text-center"><Status active={row.is_active} ar={ar} /></td>
                      <td className="px-4 py-3 text-center">
                        {canRawEdit && <SaveButton loading={savingId === row.id} onClick={() => saveManufactured(row)} ar={ar} />}
                      </td>
                    </tr>
                  );
                })}

                {tab === 'products' && visibleProducts.map((row) => {
                  const draft = productDrafts[row.id] || {
                    cost_price: safePrice(row.cost_price),
                    sale_price: safePrice(row.sale_price),
                    wholesale_price: safePrice(row.wholesale_price),
                  };
                  return (
                    <tr key={row.id} className="hover:bg-ui-page-alt/70">
                      <td className="px-4 py-3 font-semibold text-ui-text">{row.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-ui-muted">{row.sku || '-'}</td>
                      <td className="px-4 py-3 text-end">
                        {priceInput(draft.cost_price, (value) => setProductDrafts((state) => ({ ...state, [row.id]: { ...draft, cost_price: value } })), !canProductsEdit, `${row.name} ${ar ? 'التكلفة' : 'cost'}`)}
                      </td>
                      <td className="px-4 py-3 text-end">
                        {priceInput(draft.sale_price, (value) => setProductDrafts((state) => ({ ...state, [row.id]: { ...draft, sale_price: value } })), !canProductsEdit, `${row.name} ${ar ? 'سعر البيع' : 'sale price'}`)}
                      </td>
                      <td className="px-4 py-3 text-end">
                        {priceInput(draft.wholesale_price, (value) => setProductDrafts((state) => ({ ...state, [row.id]: { ...draft, wholesale_price: value } })), !canProductsEdit, `${row.name} ${ar ? 'سعر الجملة' : 'wholesale price'}`)}
                      </td>
                      <td className="px-4 py-3 text-center"><Status active={row.is_active} ar={ar} /></td>
                      <td className="px-4 py-3 text-center">
                        {canProductsEdit && <SaveButton loading={savingId === row.id} onClick={() => saveProduct(row)} ar={ar} />}
                      </td>
                    </tr>
                  );
                })}

                {currentCount === 0 && (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-ui-muted">{ar ? 'لا توجد نتائج مطابقة.' : 'No matching results.'}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-3 text-xs text-ui-subtle">
          {ar
            ? `ملاحظة: حفظ سعر الخامة يسجل حدث «تسعير» في تاريخ مركز التكلفة ويصبح آخر سعر معتمد حتى شراء أو جرد أو تسعير أحدث. كمية المخزون ومتوسط التكلفة الفعلي لا يتغيران. مثال عرض: ${formatNumber(0, 2)}`
            : `Note: saving a raw-material price records a Pricing event in Costing Center history and remains the latest costing price until a newer purchase, stock count, or pricing event. Inventory quantity and calculated average cost are unchanged. Example: ${formatNumber(0, 2)}`}
        </p>
      </DesignPanel>
    </DesignSurface>
  );
}

function Status({ active, ar }: { active: boolean; ar: boolean }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-1 text-xs font-bold ${active ? 'bg-ui-success-soft text-ui-success' : 'bg-ui-page-alt text-ui-subtle'}`}>
      {active ? (ar ? 'نشط' : 'Active') : (ar ? 'متوقف' : 'Inactive')}
    </span>
  );
}

function SaveButton({ loading, onClick, ar }: { loading: boolean; onClick: () => void; ar: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-lg bg-ui-primary px-3 py-2 text-xs font-bold text-ui-primary-fg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Save className="h-3.5 w-3.5" />
      {loading ? (ar ? 'حفظ...' : 'Saving...') : (ar ? 'حفظ' : 'Save')}
    </button>
  );
}
