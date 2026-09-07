import { useMemo } from 'react';
import { Users, Clock, ArrowRightLeft } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { formatCurrency } from '@/lib/format';
import type { DiningTable, Order, OrderItem } from '@/lib/types';
import type { OrderKitchenSend } from '../../types';

export type TableOperationalStatus = 'vacant' | 'open' | 'sent' | 'new_additions' | 'needs_action';

interface TableCardProps {
  table: DiningTable;
  orders: Order[];
  itemsByOrder: Record<string, OrderItem[]>;
  kitchenSendsByOrder: Record<string, OrderKitchenSend[]>;
  currency: string;
  isSelected: boolean;
  onSelect: (table: DiningTable) => void;
  onTransfer?: (order: Order, table: DiningTable) => void;
}

export function TableCard({ table, orders, itemsByOrder, kitchenSendsByOrder, currency, isSelected, onSelect, onTransfer }: TableCardProps) {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const activeOrder = orders[0] || null;
  const operatorName = activeOrder?.cashier?.full_name || activeOrder?.cashier?.email || null;

  const statusInfo = useMemo(() => {
    if (!activeOrder || table.status === 'vacant') return { status: 'vacant' as TableOperationalStatus, label: isAr ? 'متاحة' : 'Available', tone: 'text-ui-success bg-ui-success-soft border-ui-success/20', elapsed: 0 };
    const orderItems = itemsByOrder[activeOrder.id] || [];
    const sends = kitchenSendsByOrder[activeOrder.id] || [];
    const sentIds = new Set(sends.map((s) => s.order_item_id));
    const sent = orderItems.filter((item) => sentIds.has(item.id)).length;
    const unsent = orderItems.length - sent;
    const elapsed = Math.max(1, Math.round((Date.now() - new Date(activeOrder.created_at).getTime()) / 60000));
    if (activeOrder.status === 'held') return { status: 'needs_action' as TableOperationalStatus, label: isAr ? 'معلقة' : 'Held', tone: 'text-ui-danger bg-ui-danger-soft border-ui-danger/20', elapsed };
    if (sent > 0 && unsent > 0) return { status: 'new_additions' as TableOperationalStatus, label: isAr ? 'إضافة جديدة' : 'New items', tone: 'text-ui-warning bg-ui-warning-soft border-ui-warning/20', elapsed };
    if (sent > 0) return { status: 'sent' as TableOperationalStatus, label: isAr ? 'بالمطبخ' : 'Kitchen', tone: 'text-ui-info bg-ui-info-soft border-ui-info/20', elapsed };
    return { status: 'open' as TableOperationalStatus, label: isAr ? 'مشغولة' : 'Occupied', tone: 'text-ui-warning bg-ui-warning-soft border-ui-warning/20', elapsed };
  }, [activeOrder, table.status, itemsByOrder, kitchenSendsByOrder, isAr]);

  const itemCount = activeOrder ? (itemsByOrder[activeOrder.id] || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) : 0;

  return (
    <div onClick={() => onSelect(table)} role="button" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(table)} className={`group relative min-h-[108px] cursor-pointer select-none rounded-xl border p-2.5 text-start transition ${isSelected ? 'border-ui-primary bg-ui-primary/5 ring-2 ring-ui-primary shadow-ui-sm' : 'border-ui-border bg-ui-surface hover:border-ui-primary hover:shadow-ui-sm'}`}>
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-sm font-black text-ui-text">{table.name}</span>
        <span className="flex shrink-0 items-center gap-0.5 rounded-md bg-ui-page-alt px-1.5 py-0.5 text-[9px] font-bold text-ui-muted"><Users className="h-2.5 w-2.5" />{table.capacity || 4}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-1">
        <span className={`truncate rounded-md border px-1.5 py-0.5 text-[9px] font-black ${statusInfo.tone}`}>{statusInfo.label}</span>
        {activeOrder && <span className="truncate text-[9px] font-bold text-ui-subtle">#{activeOrder.order_number}</span>}
      </div>
      {activeOrder ? (
        <div className="mt-2 border-t border-ui-border/70 pt-1.5">
          <div className="flex items-center justify-between gap-1 text-[9px]">
            <span className="font-bold text-ui-muted">{itemCount} {isAr ? 'صنف' : 'items'}</span>
            <span className="font-black text-ui-text">{formatCurrency(activeOrder.total, currency, lang)}</span>
          </div>
          <div className="mt-1 flex min-w-0 items-center justify-between gap-1 text-[9px] text-ui-subtle">
            <span className="flex shrink-0 items-center gap-1"><Clock className="h-2.5 w-2.5" />{statusInfo.elapsed} {isAr ? 'د' : 'm'}</span>
            {operatorName && (
              <span className="flex min-w-0 items-center gap-1 font-bold text-ui-muted" title={operatorName}>
                <Users className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{operatorName}</span>
              </span>
            )}
          </div>
        </div>
      ) : <p className="mt-3 text-[9px] font-bold text-ui-subtle">{isAr ? 'اضغط لفتح طلب' : 'Tap to open order'}</p>}
      {activeOrder && onTransfer && <button type="button" onClick={(e) => { e.stopPropagation(); onTransfer(activeOrder, table); }} title={isAr ? 'نقل الطلب' : 'Transfer order'} className="absolute bottom-2 end-2 flex h-6 w-6 items-center justify-center rounded-md border border-ui-border bg-ui-page text-ui-muted opacity-0 transition hover:text-ui-primary group-hover:opacity-100"><ArrowRightLeft className="h-3 w-3" /></button>}
    </div>
  );
}
