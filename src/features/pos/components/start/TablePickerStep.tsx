import { useEffect, useMemo, useState } from 'react';
import { Search, Users } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { formatCurrency } from '@/lib/format';
import type { DiningTable, Order, OrderItem } from '@/lib/types';
import type { OrderKitchenSend } from '../../types';
import { STATUS_STYLES } from '../../utils/orderTypes';
import { stageOfOrder } from '../../utils/orderStage';
import { OrderStageBadge } from '../order/OrderStageBadge';
import { TableActionModal } from './TableActionModal';
import { orderOperatorName } from '../../utils/operatorName';

interface TablePickerStepProps {
  tables: DiningTable[];
  ordersByTable: Record<string, Order[]>;
  itemsByOrder: Record<string, OrderItem[]>;
  kitchenSendsByOrder: Record<string, OrderKitchenSend[]>;
  currency: string;
  preselectedTableId: string | null;
  onStart: (table: DiningTable, guests: number) => void;
  onResume: (order: Order) => void;
  onPay: (order: Order) => void;
}

type StatusFilter = 'all' | 'vacant' | 'occupied' | 'reserved';

export function TablePickerStep({
  tables,
  ordersByTable,
  itemsByOrder,
  kitchenSendsByOrder,
  currency,
  preselectedTableId,
  onStart,
  onResume,
  onPay,
}: TablePickerStepProps) {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selected, setSelected] = useState<DiningTable | null>(null);

  useEffect(() => {
    if (!preselectedTableId) return;
    const table = tables.find((item) => item.id === preselectedTableId);
    if (!table) return;
    if (table.status === 'vacant') {
      onStart(table, 1);
      return;
    }
    setSelected(table);
  }, [preselectedTableId, tables, onStart]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tables.filter((table) => {
      if (statusFilter !== 'all' && table.status !== statusFilter) return false;
      if (!q) return true;
      const orders = ordersByTable[table.id] || [];
      return table.name.toLowerCase().includes(q) || orders.some((order) => (
        order.order_number.toLowerCase().includes(q) || orderOperatorName(order)?.toLowerCase().includes(q)
      ));
    });
  }, [tables, ordersByTable, statusFilter, query]);

  const chips: Array<{ id: StatusFilter; label: string }> = [
    { id: 'all', label: isAr ? 'الكل' : 'All' },
    { id: 'vacant', label: t('vacant') },
    { id: 'occupied', label: t('occupied') },
    { id: 'reserved', label: t('reserved') },
  ];

  const chooseTable = (table: DiningTable) => {
    if (table.status === 'closed') return;
    const activeOrder = (ordersByTable[table.id] || [])[0];
    if (!activeOrder && table.status === 'vacant') {
      onStart(table, 1);
      return;
    }
    setSelected(table);
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto max-w-5xl space-y-4">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ui-subtle" />
            <input
              data-testid="pos-table-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('searchTable')}
              className="w-full rounded-xl border border-ui-border bg-ui-surface-raised py-2.5 pe-3 ps-9 text-sm text-ui-text placeholder:text-ui-subtle focus:outline-none focus:ring-2 focus:ring-ui-ring"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto">
            {chips.map((chip) => (
              <button
                key={chip.id}
                data-testid={`pos-table-filter-${chip.id}`}
                onClick={() => setStatusFilter(chip.id)}
                className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-bold transition-all ${statusFilter === chip.id ? 'bg-ui-primary text-ui-primary-fg shadow-ui-sm' : 'bg-ui-page-alt text-ui-muted hover:bg-ui-page-alt'}`}
              >
                {chip.label}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="py-16 text-center text-ui-subtle">
              <Search className="mx-auto mb-2 h-10 w-10 opacity-30" />
              <p className="text-sm">{isAr ? 'لا توجد طاولات مطابقة' : 'No matching tables'}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
              {filtered.map((table) => {
                const style = STATUS_STYLES[table.status] || STATUS_STYLES.vacant;
                const tableOrders = ordersByTable[table.id] || [];
                const order = tableOrders[0];
                const operatorName = order ? orderOperatorName(order) : null;
                const stage = order ? stageOfOrder(order, itemsByOrder, kitchenSendsByOrder) : null;
                return (
                  <button
                    key={table.id}
                    data-testid={`pos-table-${table.id}`}
                    onClick={() => chooseTable(table)}
                    className={`relative min-h-28 rounded-2xl border-2 p-3.5 text-start transition-all active:scale-[0.98] ${style.card} ${table.status === 'closed' ? 'cursor-not-allowed opacity-60' : 'hover:-translate-y-0.5 hover:shadow-ui-lg'}`}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate text-sm font-black text-ui-text">{table.name}</span>
                      <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${style.badge}`}>{t(style.label)}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-[11px] text-ui-muted">
                      <Users className="h-3 w-3" /> {table.capacity}
                    </div>
                    {order ? (
                      <div className="mt-2 space-y-1 border-t border-ui-border/50 pt-2">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[11px] font-black text-ui-text">{order.order_number}</span>
                          <span className="text-[11px] font-bold text-ui-accent">{formatCurrency(order.total, currency, lang)}</span>
                        </div>
                        {stage && <OrderStageBadge stage={stage} className="origin-start scale-90" />}
                        {operatorName && <p className="flex items-center gap-1 truncate text-[10px] font-bold text-ui-muted"><Users className="h-3 w-3 shrink-0" /><span className="truncate">{operatorName}</span></p>}
                      </div>
                    ) : (
                      <p className="mt-3 text-[10px] font-black text-ui-success">{isAr ? 'اضغط لفتح المنتجات' : 'Tap to open products'}</p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <TableActionModal
        table={selected}
        onClose={() => setSelected(null)}
        orders={selected ? ordersByTable[selected.id] || [] : []}
        itemsByOrder={itemsByOrder}
        kitchenSendsByOrder={kitchenSendsByOrder}
        currency={currency}
        onStart={(guests) => selected && onStart(selected, guests)}
        onResume={onResume}
        onPay={onPay}
      />
    </>
  );
}
