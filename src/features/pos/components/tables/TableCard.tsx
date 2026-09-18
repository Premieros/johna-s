import { useMemo } from 'react';
import { Users, Clock, ArrowRightLeft } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { formatCurrency } from '@/lib/format';
import type { DiningTable, Order, OrderItem } from '@/lib/types';
import type { OrderKitchenSend } from '../../types';
import { orderOperatorName } from '../../utils/operatorName';
import { usePosPermissions } from '../../hooks/usePosPermissions';

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
  const perms = usePosPermissions();
  const activeOrder = orders[0] || null;
  const operatorName = activeOrder ? orderOperatorName(activeOrder) : null;

  const statusInfo = useMemo(() => {
    if (!activeOrder || table.status === 'vacant') return { status: 'vacant' as TableOperationalStatus, label: isAr ? 'متاحة' : 'Available', tone: 'text-ui-success bg-ui-success-soft border-ui-success/35', cardTone: 'border-ui-success/45 bg-ui-success/10', elapsed: 0 };
    const orderItems = itemsByOrder[activeOrder.id] || [];
    const sends = kitchenSendsByOrder[activeOrder.id] || [];
    const sentIds = new Set(sends.map((s) => s.order_item_id));
    const sent = orderItems.filter((item) => sentIds.has(item.id)).length;
    const unsent = orderItems.length - sent;
    const elapsed = Math.max(1, Math.round((Date.now() - new Date(activeOrder.created_at).getTime()) / 60000));
    if (activeOrder.status === 'held') return { status: 'needs_action' as TableOperationalStatus, label: isAr ? 'معلقة' : 'Held', tone: 'text-ui-danger bg-ui-danger-soft border-ui-danger/35', cardTone: 'border-ui-danger/55 bg-ui-danger/10', elapsed };
    if (sent > 0 && unsent > 0) return { status: 'new_additions' as TableOperationalStatus, label: isAr ? 'إضافة جديدة' : 'New items', tone: 'text-ui-warning bg-ui-warning-soft border-ui-warning/35', cardTone: 'border-ui-warning/60 bg-ui-warning/12', elapsed };
    if (sent > 0) return { status: 'sent' as TableOperationalStatus, label: isAr ? 'بالمطبخ' : 'Kitchen', tone: 'text-ui-info bg-ui-info-soft border-ui-info/35', cardTone: 'border-ui-info/55 bg-ui-info/10', elapsed };
    return { status: 'open' as TableOperationalStatus, label: isAr ? 'مشغولة' : 'Occupied', tone: 'text-ui-warning bg-ui-warning-soft border-ui-warning/35', cardTone: 'border-ui-warning/60 bg-ui-warning/12', elapsed };
  }, [activeOrder, table.status, itemsByOrder, kitchenSendsByOrder, isAr]);

  const itemCount = activeOrder ? (itemsByOrder[activeOrder.id] || []).reduce((sum, item) => sum + (Number(item.quantity) || 0), 0) : 0;

  return (
    <div onClick={() => onSelect(table)} role="button" tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect(table)} className={`group relative min-h-[132px] cursor-pointer select-none rounded-xl border p-3 text-start shadow-ui-sm transition ${isSelected ? 'border-ui-primary bg-ui-primary/10 ring-2 ring-ui-primary shadow-ui-md' : `${statusInfo.cardTone} hover:border-ui-primary hover:shadow-ui-md`}`}>
      <div className="flex items-center justify-between gap-1">
        <span className="truncate text-[15px] font-black text-ui-text">{table.name}</span>
        <span className="flex shrink-0 items-center gap-0.5 rounded-md bg-ui-page-alt px-1.5 py-0.5 text-[10px] font-bold text-ui-muted"><Users className="h-2.5 w-2.5" />{table.capacity || 4}</span>
      </div>
      <div className="mt-2 flex items-center justify-between gap-1">
        <span className={`truncate rounded-md border px-1.5 py-0.5 text-[10px] font-black ${statusInfo.tone}`}>{statusInfo.label}</span>
        {activeOrder && <span className="truncate text-[10px] font-bold text-ui-muted">#{activeOrder.order_number}</span>}
      </div>
      {activeOrder ? (
        <div className="mt-2 border-t border-ui-border/70 pt-1.5">
          <div className="flex items-center justify-between gap-1 text-[10px]">
            <span className="font-bold text-ui-muted">{itemCount} {isAr ? 'صنف' : 'items'}</span>
            <span className="font-black text-ui-text">{formatCurrency(activeOrder.total, currency, lang)}</span>
          </div>
          <div className="mt-1 flex items-center gap-1 text-[10px] text-ui-muted">
            <span className="flex shrink-0 items-center gap-1"><Clock className="h-2.5 w-2.5" />{statusInfo.elapsed} {isAr ? 'د' : 'm'}</span>
          </div>
          {operatorName && (
            <div data-testid={`pos-table-operator-${table.id}`} className="mt-1 flex min-w-0 items-center gap-1 rounded-md bg-ui-page-alt px-1.5 py-1 text-[10px] font-black text-ui-text" title={operatorName}>
              <Users className="h-2.5 w-2.5 shrink-0 text-ui-primary" />
              <span className="truncate">{operatorName}</span>
            </div>
          )}
        </div>
      ) : <p className="mt-3 text-[10px] font-bold text-ui-muted">{isAr ? 'اضغط لفتح طلب' : 'Tap to open order'}</p>}
      {activeOrder && perms.canTransferOrder && onTransfer && <button type="button" onClick={(e) => { e.stopPropagation(); onTransfer(activeOrder, table); }} title={isAr ? 'نقل الطلب' : 'Transfer order'} className="absolute bottom-2 end-2 flex h-7 w-7 items-center justify-center rounded-md border border-ui-border-strong bg-ui-surface-raised text-ui-text transition hover:border-ui-primary hover:text-ui-primary"><ArrowRightLeft className="h-3.5 w-3.5" /></button>}
    </div>
  );
}
