import { useMemo, useState } from 'react';
import { Banknote, Search, UtensilsCrossed, Users, X } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { formatCurrency } from '@/lib/format';
import type { DiningTable, Order } from '@/lib/types';
import { orderOperatorName } from '../../utils/operatorName';

type TableFilter = 'all' | 'available' | 'occupied';

interface TablesPanelProps {
  open: boolean;
  onClose: () => void;
  tables: DiningTable[];
  ordersByTable: Record<string, Order[]>;
  currency: string;
  onResume: (order: Order) => void;
  onPay: (order: Order) => void;
  onStart: (table: DiningTable, guests: number) => void;
}

export function TablesPanel({ open, onClose, tables, ordersByTable, currency, onResume, onPay, onStart }: TablesPanelProps) {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<TableFilter>('all');
  const [selected, setSelected] = useState<DiningTable | null>(null);
  const [guests, setGuests] = useState(2);

  const occupiedCount = useMemo(
    () => tables.filter((table) => (ordersByTable[table.id] || []).length > 0 || table.status === 'occupied').length,
    [tables, ordersByTable],
  );
  const availableCount = Math.max(0, tables.length - occupiedCount);

  const visibleTables = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tables.filter((table) => {
      const orders = ordersByTable[table.id] || [];
      const occupied = orders.length > 0 || table.status === 'occupied';
      if (filter === 'available' && occupied) return false;
      if (filter === 'occupied' && !occupied) return false;
      if (!q) return true;
      return table.name.toLowerCase().includes(q) || orders.some((order) => (
        order.order_number?.toLowerCase().includes(q) || orderOperatorName(order)?.toLowerCase().includes(q)
      ));
    });
  }, [tables, ordersByTable, search, filter]);

  const chooseTable = (table: DiningTable) => {
    setSelected(table);
    setGuests(Math.max(1, table.capacity || 2));
  };

  if (!open) return null;

  const filters: Array<{ id: TableFilter; label: string; count: number }> = [
    { id: 'all', label: isAr ? 'الكل' : 'All', count: tables.length },
    { id: 'available', label: isAr ? 'متاحة' : 'Available', count: availableCount },
    { id: 'occupied', label: isAr ? 'مشغولة' : 'Occupied', count: occupiedCount },
  ];

  return (
    <>
      <div className="fixed inset-0 top-16 z-40 bg-ui-text/40 backdrop-blur-[1px]" onClick={onClose} />
      <aside data-testid="pos-tables-drawer" className="fixed bottom-0 end-0 top-16 z-50 flex w-[430px] max-w-[96vw] flex-col border-s border-ui-border bg-ui-surface shadow-ui-xl">
        <div className="shrink-0 border-b border-ui-border p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-black text-ui-text">{isAr ? 'الطاولات' : 'Tables'}</h2>
              <p className="mt-0.5 text-[10px] font-bold text-ui-subtle">
                {isAr ? 'نفس واجهة الطاولات في شاشة البيع' : 'The same table workspace used by POS'}
              </p>
            </div>
            <button type="button" onClick={onClose} aria-label={isAr ? 'إغلاق' : 'Close'} className="rounded-lg border border-ui-border bg-ui-page p-2 text-ui-muted hover:text-ui-text">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="relative mt-3">
            <Search className="absolute start-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ui-muted" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={isAr ? 'ابحث برقم الطاولة أو الطلب...' : 'Search table or order...'} className="h-10 w-full rounded-xl border border-ui-border bg-ui-page ps-9 pe-3 text-xs font-bold text-ui-text outline-none focus:border-ui-primary" />
          </div>

          <div className="mt-2 grid grid-cols-3 gap-1.5" data-testid="pos-table-drawer-filters">
            {filters.map((item) => (
              <button key={item.id} type="button" onClick={() => setFilter(item.id)} className={`rounded-lg border px-2 py-2 text-[10px] font-black transition ${filter === item.id ? 'border-ui-primary bg-ui-primary text-ui-primary-fg' : 'border-ui-border bg-ui-page text-ui-muted hover:border-ui-primary'}`}>
                {item.label} <span className="ms-1 opacity-70">{item.count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-3">
          {visibleTables.length > 0 ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {visibleTables.map((table) => {
                const order = (ordersByTable[table.id] || [])[0];
                const occupied = !!order || table.status === 'occupied';
                const operatorName = order ? orderOperatorName(order) : null;
                return (
                  <button
                    key={table.id}
                    type="button"
                    data-testid={`pos-table-drawer-${table.id}`}
                    onClick={() => chooseTable(table)}
                    className={`min-h-24 rounded-2xl border p-3 text-start shadow-ui-sm transition hover:-translate-y-0.5 ${occupied ? 'border-ui-warning/30 bg-ui-warning/5' : 'border-ui-border bg-ui-surface hover:border-ui-primary'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="truncate text-xs font-black text-ui-text">{table.name}</span>
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${occupied ? 'bg-ui-warning' : 'bg-ui-success'}`} />
                    </div>
                    <p className="mt-2 flex items-center gap-1 text-[10px] font-bold text-ui-subtle"><Users className="h-3 w-3" /> {table.capacity}</p>
                    {order ? (
                      <div className="mt-2 space-y-0.5">
                        <p className="truncate text-[10px] font-black text-ui-text">#{order.order_number}</p>
                        <p className="truncate text-[10px] font-black text-ui-accent">{formatCurrency(order.total, currency, lang)}</p>
                        {operatorName && <p className="flex items-center gap-1 truncate text-[10px] font-bold text-ui-muted"><Users className="h-3 w-3 shrink-0" /><span className="truncate">{operatorName}</span></p>}
                      </div>
                    ) : (
                      <p className="mt-2 text-[10px] font-black text-ui-success">{isAr ? 'متاحة' : 'Available'}</p>
                    )}
                  </button>
                );
              })}
            </div>
          ) : tables.length === 0 ? (
            <div data-testid="pos-tables-empty-setup" className="rounded-2xl border border-ui-warning/30 bg-ui-warning/5 px-5 py-10 text-center">
              <UtensilsCrossed className="mx-auto mb-3 h-10 w-10 text-ui-warning opacity-70" />
              <p className="text-sm font-black text-ui-text">{isAr ? 'لا توجد طاولات معدّة لهذا الفرع' : 'No tables are configured for this branch'}</p>
              <p className="mx-auto mt-2 max-w-xs text-xs font-bold leading-5 text-ui-subtle">
                {isAr ? 'أكمل إعداد الصالات والطاولات لهذا الفرع أولًا. لم يتم إنشاء أي بيانات تلقائيًا.' : 'Complete dining-area and table setup for this branch first. No data was created automatically.'}
              </p>
            </div>
          ) : (
            <div className="py-12 text-center text-xs font-bold text-ui-muted">{isAr ? 'لا توجد طاولات مطابقة للبحث أو الفلتر' : 'No tables match the current search or filter'}</div>
          )}
        </div>
      </aside>

      <Modal open={!!selected} onClose={() => setSelected(null)} title={selected?.name || ''} size="sm">
        {selected && (() => {
          const tableOrders = ordersByTable[selected.id] || [];
          const order = tableOrders[0];
          const operatorName = order ? orderOperatorName(order) : null;
          if (order) {
            return (
              <div className="space-y-3">
                <div className="rounded-xl border border-ui-border bg-ui-page-alt p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-black text-ui-text">#{order.order_number}</span>
                    <span className="text-sm font-black text-ui-accent">{formatCurrency(order.total, currency, lang)}</span>
                  </div>
                  {operatorName && <p className="mt-2 flex items-center gap-1 text-xs font-bold text-ui-muted"><Users className="h-3.5 w-3.5" />{isAr ? 'المستخدم:' : 'User:'} {operatorName}</p>}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" onClick={() => { setSelected(null); onClose(); onResume(order); }}>
                    <UtensilsCrossed className="h-4 w-4" /> {isAr ? 'فتح الطلب' : 'Open order'}
                  </Button>
                  <Button variant="success" onClick={() => { setSelected(null); onClose(); onPay(order); }}>
                    <Banknote className="h-4 w-4" /> {isAr ? 'الدفع' : 'Pay'}
                  </Button>
                </div>
              </div>
            );
          }
          return (
            <div className="space-y-3">
              <label className="flex items-center justify-between gap-3 text-sm font-bold text-ui-muted">
                <span>{isAr ? 'عدد الأفراد' : 'Guests'}</span>
                <input type="number" min={1} value={guests} onChange={(event) => setGuests(Math.max(1, Number(event.target.value) || 1))} className="w-24 rounded-xl border border-ui-border bg-ui-surface px-3 py-2 text-center font-black text-ui-text" />
              </label>
              <Button className="w-full" onClick={() => { setSelected(null); onClose(); onStart(selected, guests); }}>
                <UtensilsCrossed className="h-4 w-4" /> {isAr ? 'فتح طلب على الطاولة' : 'Start table order'}
              </Button>
            </div>
          );
        })()}
      </Modal>
    </>
  );
}
