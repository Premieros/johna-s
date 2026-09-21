import { useEffect, useMemo, useState } from 'react';
import { Bike, Car, ListOrdered, Pencil, Search, ShoppingBag, Utensils } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { useCan } from '@/lib/permissions';
import * as api from '@/api';
import type { DiningArea, DiningTable, Order, OrderItem, RpcResult } from '@/lib/types';
import type { OrderKitchenSend } from '../../types';
import { TableCard } from './TableCard';

type TableFilter = 'all' | 'available' | 'occupied';

interface PosTablesSidebarProps {
  branchId: string;
  tables: DiningTable[];
  areas: DiningArea[];
  ordersByTable: Record<string, Order[]>;
  itemsByOrder: Record<string, OrderItem[]>;
  kitchenSendsByOrder: Record<string, OrderKitchenSend[]>;
  currency: string;
  activeTableId: string | null;
  activeOrderId: string | null;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onSelectTable: (table: DiningTable) => void;
  onTransferOrder?: (order: Order, table: DiningTable) => void;
  onStartQuick?: () => void;
  onStartDelivery?: () => void;
  onStartDriveThru?: () => void;
  onOpenActiveOrders?: () => void;
  onSelectTakeaway?: () => void;
  onSelectDelivery?: () => void;
  activeOrderType?: string;
}

export function PosTablesSidebar(props: PosTablesSidebarProps) {
  const {
    branchId,
    tables,
    areas,
    ordersByTable,
    itemsByOrder,
    kitchenSendsByOrder,
    currency,
    activeTableId,
    activeOrderId,
    collapsed,
    onToggleCollapse,
    onSelectTable,
    onTransferOrder,
    onStartQuick,
    onStartDelivery,
    onStartDriveThru,
    onOpenActiveOrders,
    onSelectTakeaway,
    onSelectDelivery,
  } = props;
  const { lang } = useLanguage();
  const { show } = useToast();
  const can = useCan();
  const isAr = lang === 'ar';
  const canManageFloorPlan = can('floor_plan.manage');
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<TableFilter>('all');
  const [flowStarted, setFlowStarted] = useState(false);
  const [selectedAreaId, setSelectedAreaId] = useState('');
  const [countModalOpen, setCountModalOpen] = useState(false);
  const [mainAreaCount, setMainAreaCount] = useState(50);
  const [savingCount, setSavingCount] = useState(false);

  useEffect(() => {
    const handleExternalFlowStart = () => setFlowStarted(true);
    const handleShowLanding = () => setFlowStarted(false);
    window.addEventListener('pos:order-flow-started', handleExternalFlowStart);
    window.addEventListener('pos:show-tables-landing', handleShowLanding);
    return () => {
      window.removeEventListener('pos:order-flow-started', handleExternalFlowStart);
      window.removeEventListener('pos:show-tables-landing', handleShowLanding);
    };
  }, []);

  const orderedAreas = useMemo(
    () => [...areas].sort((a, b) => Number(Boolean(b.is_default)) - Number(Boolean(a.is_default)) || a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
    [areas],
  );

  useEffect(() => {
    if (orderedAreas.length === 0) {
      setSelectedAreaId('');
      return;
    }
    setSelectedAreaId((current) => (
      current && orderedAreas.some((area) => area.id === current)
        ? current
        : (orderedAreas.find((area) => area.is_default)?.id || orderedAreas[0].id)
    ));
  }, [orderedAreas]);

  const areaTables = useMemo(
    () => selectedAreaId ? tables.filter((table) => table.area_id === selectedAreaId) : tables,
    [tables, selectedAreaId],
  );

  const occupiedCount = useMemo(
    () => areaTables.filter((table) => (ordersByTable[table.id] || []).length > 0 || table.status === 'occupied').length,
    [areaTables, ordersByTable],
  );
  const availableCount = Math.max(0, areaTables.length - occupiedCount);

  const filteredTables = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return areaTables.filter((table) => {
      const orders = ordersByTable[table.id] || [];
      const occupied = orders.length > 0 || table.status === 'occupied';
      if (filter === 'available' && occupied) return false;
      if (filter === 'occupied' && !occupied) return false;
      if (!q) return true;
      return table.name.toLowerCase().includes(q) || orders.some((order) => order.order_number?.toLowerCase().includes(q));
    });
  }, [areaTables, ordersByTable, searchQuery, filter]);

  const defaultArea = useMemo(() => orderedAreas.find((area) => area.is_default) || null, [orderedAreas]);
  const defaultAreaCount = useMemo(
    () => defaultArea ? tables.filter((table) => table.area_id === defaultArea.id).length : 0,
    [tables, defaultArea],
  );

  const openMainAreaCountEditor = () => {
    setMainAreaCount(Math.max(1, defaultAreaCount || 1));
    setCountModalOpen(true);
  };

  const saveMainAreaCount = async () => {
    const nextCount = Math.trunc(Number(mainAreaCount));
    if (!branchId || nextCount < 1 || nextCount > 50) {
      show(isAr ? 'عدد الطاولات يجب أن يكون من 1 إلى 50.' : 'Table count must be between 1 and 50.', 'error');
      return;
    }

    setSavingCount(true);
    try {
      const { data, error } = await api.floorPlan.setMainAreaTableCount({
        p_branch_id: branchId,
        p_count: nextCount,
      });
      if (error) {
        show(error.message, 'error');
        return;
      }

      const result = data as (RpcResult & { main_area_table_count?: number }) | null;
      if (!result?.success) {
        const message = result?.error === 'MAIN_AREA_TABLE_LIMIT_BUSY'
          ? (isAr
            ? 'لا يمكن تقليل العدد لأن هناك طاولة أعلى من العدد المطلوب مشغولة أو عليها طلب مفتوح.'
            : 'Cannot reduce the count because a table above the requested limit is occupied or has an open order.')
          : result?.error === 'PERMISSION_DENIED'
            ? (isAr ? 'لا تملك صلاحية إدارة مخطط الطاولات.' : 'You do not have floor-plan management permission.')
            : result?.detail || result?.error || (isAr ? 'تعذر تعديل عدد الطاولات.' : 'Could not update the table count.');
        show(message, 'error');
        return;
      }

      show(
        isAr ? `تم ضبط المنطقة الأساسية على ${nextCount} طاولة.` : `Main Area set to ${nextCount} tables.`,
        'success',
      );
      setCountModalOpen(false);
    } finally {
      setSavingCount(false);
    }
  };

  // The POS is tables-first. Once a real table/order is selected, or the
  // operator explicitly starts a quick non-table order, the landing disappears
  // and gives the entire selling area back to products + cart.
  if (activeTableId || activeOrderId || flowStarted) return null;

  if (collapsed) {
    return (
      <aside className="flex h-full w-14 shrink-0 flex-col items-center border-e border-ui-border bg-ui-surface py-3">
        <button type="button" onClick={onToggleCollapse} title={isAr ? 'إظهار الطاولات' : 'Show tables'} className="flex h-10 w-10 items-center justify-center rounded-xl border border-ui-border bg-ui-page text-ui-text"><Utensils className="h-5 w-5" /></button>
        <span className="mt-2 rounded-full bg-ui-primary px-1.5 text-[10px] font-black text-ui-primary-fg">{occupiedCount}</span>
      </aside>
    );
  }

  const filters: Array<{ id: TableFilter; ar: string; en: string; count: number }> = [
    { id: 'all', ar: 'الكل', en: 'All', count: areaTables.length },
    { id: 'available', ar: 'متاحة', en: 'Available', count: availableCount },
    { id: 'occupied', ar: 'مشغولة', en: 'Occupied', count: occupiedCount },
  ];

  const startQuick = () => {
    const action = onStartQuick || onSelectTakeaway;
    if (!action) return;
    action();
    setFlowStarted(true);
  };

  const startDelivery = () => {
    if (onStartDelivery) {
      onStartDelivery();
      return;
    }
    if (!onSelectDelivery) return;
    onSelectDelivery();
    setFlowStarted(true);
  };

  return (
    <aside data-testid="pos-tables-workspace" className="flex h-full min-h-0 w-screen min-w-0 max-w-full shrink-0 flex-col border-e border-ui-border bg-ui-surface lg:w-[calc(100vw-380px)] xl:w-[calc(100vw-410px)] 2xl:w-[calc(100vw-440px)]">
      <div className="shrink-0 border-b border-ui-border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-ui-text">{isAr ? 'الطاولات' : 'Tables'}</h2>
            <p className="mt-0.5 text-[11px] font-bold text-ui-subtle">{isAr ? 'اختر طاولة أو ابدأ نوع طلب من الاختصارات' : 'Choose a table or start an order from the shortcuts'}</p>
          </div>

          <div data-testid="pos-tables-landing-actions" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(onStartQuick || onSelectTakeaway) && (
              <button
                type="button"
                data-testid="pos-start-quick-order"
                onClick={startQuick}
                className="flex h-11 items-center justify-center gap-2 rounded-xl bg-ui-primary px-3 text-xs font-black text-ui-primary-fg shadow-ui-sm transition hover:bg-ui-primary-hover active:scale-[0.98]"
              >
                <ShoppingBag className="h-4 w-4" />
                {isAr ? 'طلب سريع' : 'Quick order'}
              </button>
            )}
            {(onStartDelivery || onSelectDelivery) && (
              <button
                type="button"
                data-testid="pos-tables-start-delivery"
                onClick={startDelivery}
                className="flex h-11 items-center justify-center gap-2 rounded-xl border border-ui-border bg-ui-page px-3 text-xs font-black text-ui-text transition hover:border-ui-primary hover:text-ui-primary active:scale-[0.98]"
              >
                <Bike className="h-4 w-4" />
                {isAr ? 'دليفري' : 'Delivery'}
              </button>
            )}
            {onStartDriveThru && (
              <button
                type="button"
                data-testid="pos-tables-start-drive-thru"
                onClick={onStartDriveThru}
                className="flex h-11 items-center justify-center gap-2 rounded-xl border border-ui-border bg-ui-page px-3 text-xs font-black text-ui-text transition hover:border-ui-primary hover:text-ui-primary active:scale-[0.98]"
              >
                <Car className="h-4 w-4" />
                {isAr ? 'درايف ثرو' : 'Drive thru'}
              </button>
            )}
            {onOpenActiveOrders && (
              <button
                type="button"
                data-testid="pos-tables-active-orders"
                onClick={onOpenActiveOrders}
                className="flex h-11 items-center justify-center gap-2 rounded-xl border border-ui-border bg-ui-page px-3 text-xs font-black text-ui-text transition hover:border-ui-primary hover:text-ui-primary active:scale-[0.98]"
              >
                <ListOrdered className="h-4 w-4" />
                {isAr ? 'الطلبات النشطة' : 'Active orders'}
              </button>
            )}
          </div>
        </div>

        {orderedAreas.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <div data-testid="pos-table-area-tabs" className="flex min-w-0 flex-1 gap-2 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {orderedAreas.map((area) => {
                const count = tables.filter((table) => table.area_id === area.id).length;
                const active = selectedAreaId === area.id;
                return (
                  <button
                    key={area.id}
                    type="button"
                    data-testid={`pos-table-area-${area.id}`}
                    onClick={() => setSelectedAreaId(area.id)}
                    className={`flex min-h-10 shrink-0 items-center gap-2 rounded-xl border px-4 py-2 text-xs font-black transition ${active ? 'border-ui-primary bg-ui-primary text-ui-primary-fg shadow-ui-sm' : 'border-ui-border bg-ui-page text-ui-muted hover:border-ui-primary hover:text-ui-text'}`}
                  >
                    <span>{area.name}</span>
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${active ? 'bg-white/20' : 'bg-ui-surface'}`}>{count}</span>
                  </button>
                );
              })}
            </div>
            {canManageFloorPlan && defaultArea && selectedAreaId === defaultArea.id && (
              <button
                type="button"
                data-testid="pos-main-area-count-edit"
                onClick={openMainAreaCountEditor}
                className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-ui-border bg-ui-page px-3 text-xs font-black text-ui-text transition hover:border-ui-primary hover:text-ui-primary"
              >
                <Pencil className="h-4 w-4" />
                {isAr ? 'تعديل العدد' : 'Edit count'}
              </button>
            )}
          </div>
        )}

        <div className="mt-3 flex flex-col gap-2 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ui-muted" />
            <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={isAr ? 'ابحث برقم الطاولة أو الطلب...' : 'Search table or order...'} className="h-11 w-full rounded-xl border border-ui-border bg-ui-page ps-10 pe-3 text-sm font-bold text-ui-text outline-none focus:border-ui-primary" />
          </div>

          <div className="grid min-w-[310px] grid-cols-3 gap-1.5" data-testid="pos-table-filters">
            {filters.map((item) => (
              <button key={item.id} type="button" onClick={() => setFilter(item.id)} className={`rounded-lg border px-3 py-2.5 text-[11px] font-black transition ${filter === item.id ? 'border-ui-primary bg-ui-primary text-ui-primary-fg' : 'border-ui-border bg-ui-page text-ui-muted hover:border-ui-primary'}`}>
                {isAr ? item.ar : item.en} <span className="ms-1 opacity-70">{item.count}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-4">
        {filteredTables.length > 0 ? (
          <div data-testid="pos-table-grid" className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3">
            {filteredTables.map((table) => (
              <TableCard
                key={table.id}
                table={table}
                orders={ordersByTable[table.id] || []}
                itemsByOrder={itemsByOrder}
                kitchenSendsByOrder={kitchenSendsByOrder}
                currency={currency}
                isSelected={activeTableId === table.id}
                onSelect={onSelectTable}
                onTransfer={onTransferOrder}
              />
            ))}
          </div>
        ) : <div className="py-16 text-center text-sm font-bold text-ui-muted">{isAr ? 'لا توجد طاولات مطابقة' : 'No matching tables'}</div>}
      </div>

      <Modal
        open={countModalOpen}
        onClose={() => setCountModalOpen(false)}
        title={isAr ? 'تعديل عدد طاولات المنطقة الأساسية' : 'Edit Main Area table count'}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm font-medium leading-6 text-ui-muted">
            {isAr
              ? 'حدد عدد الطاولات الظاهرة والنشطة في Main Area. الطاولات الأعلى من العدد ستبقى محفوظة في النظام ولكن لن تظهر للبيع.'
              : 'Choose how many Main Area tables are active and visible. Higher table numbers stay preserved but are hidden from selling.'}
          </p>
          <div>
            <label className="mb-1.5 block text-sm font-bold text-ui-text">
              {isAr ? 'عدد الطاولات' : 'Table count'}
            </label>
            <input
              data-testid="pos-main-area-count-input"
              type="number"
              min={1}
              max={50}
              value={mainAreaCount}
              onChange={(event) => setMainAreaCount(Math.max(1, Math.min(50, Number(event.target.value) || 1)))}
              className="w-full rounded-xl border border-ui-border bg-ui-surface-raised px-3 py-2.5 text-center text-lg font-black tabular-nums text-ui-text focus:ring-2 focus:ring-ui-ring"
            />
          </div>
          <Button
            data-testid="pos-main-area-count-save"
            className="w-full"
            disabled={savingCount}
            onClick={() => void saveMainAreaCount()}
          >
            {savingCount ? (isAr ? 'جارٍ الحفظ...' : 'Saving...') : (isAr ? 'حفظ العدد' : 'Save count')}
          </Button>
        </div>
      </Modal>
    </aside>
  );
}
