import { useEffect, useState } from 'react';
import { Plus, Play, CheckCircle2, XCircle, Trash2, Factory, PackageOpen } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useCan } from '@/lib/permissions';
import { useAuth } from '@/context/AuthContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useHistoryAccess } from '@/lib/useHistoryAccess';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel, DesignPagination } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatNumber, formatDate } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { ProductionOrder, Product, Warehouse, Branch, Recipe, RecipeItem, RpcResult } from '@/lib/types';

interface WasteForm {
  raw_material_id: string;
  quantity: number;
  reason: string;
}

const EMPTY_WASTE: WasteForm = { raw_material_id: '', quantity: 0, reason: '' };

export function ProductionOrdersPage() {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const can = useCan();
  const { user } = useAuth();
  const branchFilter = useBranchFilter();
  const history = useHistoryAccess();
  const isAr = lang === 'ar';

  const { rows: orders, loading, error, total, hasMore, loadMore, loadingMore, refresh: reloadOrders } = usePaginatedRows<ProductionOrder>({
    table: 'production_orders',
    select: '*, product:products(*), warehouse:warehouses(*), branch:branches(*), creator:users(id, full_name, email)',
    order: { column: 'created_at', ascending: false },
    or: history.minIso ? `created_at.gte.${history.minIso},status.in.(planned,in_progress)` : undefined,
    pageSize: 100,
  });
  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [recipeItems, setRecipeItems] = useState<RecipeItem[]>([]);
  const [search, setSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({
    product_id: '', branch_id: '', warehouse_id: '',
    quantity: 1, batch_number: '', planned_at: '', notes: '',
  });

  const [completeTarget, setCompleteTarget] = useState<ProductionOrder | null>(null);
  const [wasteItems, setWasteItems] = useState<WasteForm[]>([]);
  const [cancelTarget, setCancelTarget] = useState<ProductionOrder | null>(null);
  const [cancelReason, setCancelReason] = useState('');

  async function loadMeta() {
    const [pr, w, br, r] = await Promise.all([
      supabase.from('products').select('*').eq('product_type', 'manufactured').eq('is_active', true).order('name'),
      supabase.from('warehouses').select('*').eq('is_active', true).order('name'),
      supabase.from('branches').select('*').eq('is_active', true).order('name'),
      supabase.from('recipes').select('*').eq('is_active', true),
    ]);
    setProducts((pr.data as Product[]) || []);
    setWarehouses((w.data as Warehouse[]) || []);
    setBranches((br.data as Branch[]) || []);
    setRecipes((r.data as Recipe[]) || []);
  }
  useEffect(() => { loadMeta(); }, []);

  const filtered = orders.filter((o) => {
    if (branchFilter && o.branch_id !== branchFilter) return false;
    if (!search) return true;
    return o.order_number.toLowerCase().includes(search.toLowerCase()) || (o.product?.name || '').toLowerCase().includes(search.toLowerCase());
  });

  const manufacturedWithRecipe = products.filter((p) => recipes.some((r) => r.product_id === p.id));

  const openAdd = () => {
    const today = new Date().toISOString().slice(0, 10);
    setForm({ product_id: '', branch_id: user?.branch_id || branchFilter || '', warehouse_id: '', quantity: 1, batch_number: '', planned_at: today, notes: '' });
    setModalOpen(true);
  };

  const createOrder = async () => {
    if (!form.product_id) { show(t('required') + ': ' + t('selectProduct'), 'error'); return; }
    if (!form.branch_id) { show(t('required') + ': ' + t('branch'), 'error'); return; }
    if (form.quantity <= 0) { show(t('required') + ': ' + t('outputQuantity'), 'error'); return; }
    const { data, error } = await api.manufacturing.createOrder({
      p_product_id: form.product_id,
      p_branch_id: form.branch_id,
      p_warehouse_id: form.warehouse_id || null,
      p_quantity: form.quantity,
      p_batch_number: form.batch_number || null,
      p_planned_at: form.planned_at || null,
      p_notes: form.notes || null,
    });
    if (error) { show(error.message, 'error'); return; }
    const result = data as RpcResult | null;
    if (!result?.success) { show(result?.detail || result?.error || t('error'), 'error'); return; }
    await logAudit('create', 'production_orders', result.order_id, { number: result.order_number });
    show(t('saveSuccess'), 'success');
    setModalOpen(false);
    reloadOrders();
  };

  const startOrder = async (o: ProductionOrder) => {
    const { data, error } = await api.manufacturing.startOrder({ p_order_id: o.id });
    if (error) { show(error.message, 'error'); return; }
    const result = data as RpcResult | null;
    if (!result?.success) { show(result?.detail || result?.error || t('error'), 'error'); return; }
    await logAudit('update', 'production_orders', o.id, { action: 'start' });
    show(t('saveSuccess'), 'success');
    reloadOrders();
  };

  const openComplete = async (o: ProductionOrder) => {
    const recipe = recipes.find((r) => r.product_id === o.product_id && r.branch_id === o.branch_id);
    if (recipe) {
      const { data } = await supabase.from('recipe_items')
        .select('*, raw_material:raw_materials(*)')
        .eq('recipe_id', recipe.id);
      setRecipeItems(((data as RecipeItem[]) || []).map((it) => ({
        ...it,
        quantity: Number(it.quantity),
        raw_material: it.raw_material,
      })));
    } else {
      setRecipeItems([]);
    }
    setCompleteTarget(o);
    setWasteItems([]);
  };

  const completeOrder = async () => {
    if (!completeTarget) return;
    const p_waste = wasteItems.filter((w) => w.raw_material_id && w.quantity > 0).map((w) => ({
      raw_material_id: w.raw_material_id,
      quantity: w.quantity,
      reason: w.reason || null,
    }));
    const { data, error } = await api.manufacturing.completeOrder({
      p_order_id: completeTarget.id,
      p_waste: p_waste.length ? p_waste : null,
    });
    if (error) { show(error.message, 'error'); return; }
    const result = data as RpcResult | null;
    if (!result?.success) { show(result?.detail || result?.error || t('error'), 'error'); return; }
    await logAudit('update', 'production_orders', completeTarget.id, { action: 'complete', total_cost: result.total_cost });
    show(t('productionCompleted'), 'success');
    setCompleteTarget(null);
    reloadOrders();
  };

  const openCancel = (o: ProductionOrder) => { setCancelTarget(o); setCancelReason(''); };

  const doCancel = async () => {
    if (!cancelTarget) return;
    const { data, error } = await api.manufacturing.cancelOrder({
      p_order_id: cancelTarget.id,
      p_reason: cancelReason || null,
    });
    if (error) { show(error.message, 'error'); return; }
    const result = data as RpcResult | null;
    if (!result?.success) { show(result?.detail || result?.error || t('error'), 'error'); return; }
    await logAudit('update', 'production_orders', cancelTarget.id, { action: 'cancel', reason: cancelReason });
    show(t('saveSuccess'), 'success');
    setCancelTarget(null);
    reloadOrders();
  };

  const statusPill = (status: string) => {
    const map: Record<string, string> = {
      planned: 'bg-ui-page-alt/70 text-ui-muted border border-ui-border',
      in_progress: 'bg-ui-warning-soft text-ui-warning border border-ui-warning/30 shadow-[0_0_12px_rgba(245,158,11,0.15)]',
      completed: 'bg-ui-success-soft text-ui-success border border-ui-success/30 shadow-[0_0_12px_rgba(16,185,129,0.15)]',
      cancelled: 'bg-ui-danger-soft text-ui-danger border border-ui-danger/30',
    };
    const label: Record<string, string> = {
      planned: t('statusPlanned'),
      in_progress: t('statusInProgress'),
      completed: t('statusCompleted'),
      cancelled: t('statusCancelled'),
    };
    return <span className={`px-2.5 py-1 rounded-full text-xs font-semibold backdrop-blur-sm transition-all ${map[status] || map.planned}`}>{label[status] || status}</span>;
  };

  const columns: Column<ProductionOrder>[] = [
    { key: 'order_number', header: t('orderNumber'), render: (o) => (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-ui-info-soft flex items-center justify-center text-ui-info">
          <Factory className="w-4 h-4" />
        </div>
        <div>
          <p className="font-semibold text-ui-text">{o.order_number}</p>
          {o.batch_number && <p className="text-xs text-ui-subtle">{t('batchNumber')}: {o.batch_number}</p>}
        </div>
      </div>
    )},
    { key: 'product', header: t('product'), render: (o) => o.product?.name || '-' },
    { key: 'warehouse', header: t('outputWarehouse'), render: (o) => o.warehouse?.name || '-' },
    { key: 'quantity', header: t('quantity'), render: (o) => formatNumber(Number(o.quantity)) },
    { key: 'total_cost', header: t('totalCost'), render: (o) => o.status === 'completed' ? formatNumber(Number(o.total_cost), 2) : '-' },
    { key: 'status', header: t('status'), render: (o) => statusPill(o.status) },
    { key: 'planned_at', header: t('plannedAt'), render: (o) => o.planned_at ? formatDate(o.planned_at, lang) : '-' },
    { key: 'actions', header: t('actions'), render: (o) => (
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        {can('production.manage') && o.status === 'planned' && (
          <button onClick={() => startOrder(o)} className="p-1.5 rounded-md hover:bg-ui-warning-soft text-ui-warning" title={t('startProduction')}>
            <Play className="w-4 h-4" />
          </button>
        )}
        {can('production.manage') && (o.status === 'planned' || o.status === 'in_progress') && (
          <button onClick={() => openComplete(o)} className="p-1.5 rounded-md hover:bg-ui-success-soft text-ui-success" title={t('completeProduction')}>
            <CheckCircle2 className="w-4 h-4" />
          </button>
        )}
        {can('production.manage') && (o.status === 'planned' || o.status === 'in_progress') && (
          <button onClick={() => openCancel(o)} className="p-1.5 rounded-md hover:bg-ui-danger-soft text-ui-danger" title={t('cancelProduction')}>
            <XCircle className="w-4 h-4" />
          </button>
        )}
      </div>
    )},
  ];

  const factor = completeTarget && Number(completeTarget.quantity) > 0
    ? Number(completeTarget.quantity) / Math.max(Number(recipes.find((r) => r.product_id === completeTarget.product_id)?.yield_quantity || 1), 1e-9)
    : 0;

  return (
    <DesignSurface testId="production-orders-page">
      <DesignPageHeader title={t('productionOrders')} subtitle={isAr ? 'تخطيط وتنفيذ أوامر التصنيع من المواد الخام' : 'Plan and execute manufacturing orders from raw materials'} actions={
        can('production.manage') ? (
          <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4" /> {t('newProductionOrder')}</Button>
        ) : undefined
      } />

      <DesignPanel testId="production-orders-search-panel">
        <DesignSearch value={search} onChange={setSearch} label={t('search')} placeholder={t('search')} testId="production-orders-search" />
      </DesignPanel>

      <DesignPanel testId="production-orders-table-panel">
        <DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')} />
        <DesignPagination loaded={orders.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t('newProductionOrder')} size="lg">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select label={t('product')} value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })}>
            <option value="">{t('selectProduct')}</option>
            {manufacturedWithRecipe.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Select label={t('branch')} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })} disabled={!!branchFilter}>
            <option value="">{t('branch')}</option>
            {branches.map((br) => <option key={br.id} value={br.id}>{br.name}</option>)}
          </Select>
          <Select label={t('outputWarehouse')} value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}>
            <option value="">-</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
          <Input label={t('outputQuantity')} type="number" step="0.0001" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: parseFloat(e.target.value) || 0 })} />
          <Input label={t('batchNumber')} value={form.batch_number} onChange={(e) => setForm({ ...form, batch_number: e.target.value })} />
          <Input label={t('plannedAt')} type="date" value={form.planned_at} onChange={(e) => setForm({ ...form, planned_at: e.target.value })} />
          <div className="sm:col-span-2">
            <Input label={t('notes')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button>
          <Button onClick={createOrder}>{t('save')}</Button>
        </div>
      </Modal>

      <Modal open={!!completeTarget} onClose={() => setCompleteTarget(null)} title={`${t('completeProduction')} — ${completeTarget?.order_number || ''}`} size="lg">
        {completeTarget && (
          <div className="space-y-4">
            <div className="rounded-xl bg-ui-page-alt dark:bg-navy-800/50 p-4">
              <p className="text-sm font-bold text-ui-muted mb-2">{t('consumedMaterials')}</p>
              {recipeItems.length === 0 && <p className="text-sm text-ui-subtle">{t('noData')}</p>}
              <div className="space-y-1.5">
                {recipeItems.map((it) => (
                  <div key={it.id} className="flex items-center justify-between text-sm">
                    <span className="text-ui-muted">{it.raw_material?.name || '-'}</span>
                    <span className="font-semibold text-ui-text">
                      {formatNumber(Number(it.quantity) * factor)} {it.wastage_percent > 0 && <span className="text-ui-warning">+{it.wastage_percent}%</span>}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {(can('production.waste') || can('production.manage')) && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm font-bold text-ui-muted">{t('waste')}</p>
                  <Button variant="outline" size="sm" onClick={() => setWasteItems([...wasteItems, { ...EMPTY_WASTE }])}><Plus className="w-4 h-4" /> {t('addWaste')}</Button>
                </div>
                <div className="space-y-2">
                  {wasteItems.map((w, idx) => (
                    <div key={idx} className="grid grid-cols-[1fr_90px_1fr_36px] gap-2 items-end">
                      <Select value={w.raw_material_id} onChange={(e) => setWasteItems(wasteItems.map((x, i) => i === idx ? { ...x, raw_material_id: e.target.value } : x))}>
                        <option value="">{t('selectRawMaterial')}</option>
                        {recipeItems.map((it) => it.raw_material && (
                          <option key={it.id} value={it.raw_material!.id}>{it.raw_material!.name}</option>
                        ))}
                      </Select>
                      <Input type="number" step="0.0001" value={w.quantity} onChange={(e) => setWasteItems(wasteItems.map((x, i) => i === idx ? { ...x, quantity: parseFloat(e.target.value) || 0 } : x))} />
                      <Input value={w.reason} onChange={(e) => setWasteItems(wasteItems.map((x, i) => i === idx ? { ...x, reason: e.target.value } : x))} placeholder={isAr ? 'السبب' : 'Reason'} />
                      <button onClick={() => setWasteItems(wasteItems.filter((_, i) => i !== idx))} className="p-2 rounded-lg text-ui-danger hover:bg-ui-danger-soft" title={t('delete')}>
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center gap-2 text-sm text-ui-subtle">
              <PackageOpen className="w-4 h-4" />
              <span>{t('outputQuantity')}: <b className="text-ui-text">{formatNumber(Number(completeTarget.quantity))}</b></span>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setCompleteTarget(null)}>{t('cancel')}</Button>
              <Button variant="success" onClick={completeOrder}><CheckCircle2 className="w-4 h-4" /> {t('completeProduction')}</Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!cancelTarget} onClose={() => setCancelTarget(null)} onConfirm={doCancel} title={t('cancelProduction')} message={t('confirmCancelProduction')} confirmLabel={t('delete')} cancelLabel={t('cancel')} />
    </DesignSurface>
  );
}
