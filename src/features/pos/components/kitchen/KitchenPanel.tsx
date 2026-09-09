import { useMemo } from 'react';
import { ChefHat, X, Clock, Send, User } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import type { DiningTable, Order, OrderItem } from '@/lib/types';
import type { OrderKitchenSend } from '../../types';
import { orderTypeLabel } from '../../utils/format';
import { deriveOrderState } from '../../utils/orderState';
import { formatClockTime, timeAgo } from '../../utils/timeAgo';
import { OrderStatusBadge } from '../order/OrderStatusBadge';
import { orderOperatorName } from '../../utils/operatorName';

interface KitchenPanelProps {
  open: boolean;
  onClose: () => void;
  orders: Order[];
  itemsByOrder: Record<string, OrderItem[]>;
  kitchenSendsByOrder: Record<string, OrderKitchenSend[]>;
  tableById: Record<string, DiningTable>;
  productNames: Record<string, string>;
}

export function KitchenPanel({ open, onClose, orders, itemsByOrder, kitchenSendsByOrder, tableById, productNames }: KitchenPanelProps) {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';

  const itemById = useMemo(() => {
    const map: Record<string, OrderItem> = {};
    for (const list of Object.values(itemsByOrder)) {
      for (const item of list) map[item.id] = item;
    }
    return map;
  }, [itemsByOrder]);

  // Kitchen is a sent-items view only. Open orders that have not been sent
  // remain in POS/Active Orders and must not be duplicated here.
  const kitchenOrders = useMemo(
    () => orders.filter((order) => (kitchenSendsByOrder[order.id]?.length || 0) > 0),
    [orders, kitchenSendsByOrder],
  );

  const renderOrder = (order: Order) => {
    const sends = kitchenSendsByOrder[order.id] || [];
    const firstSent = sends.length > 0 ? sends.map((send) => send.sent_at).sort()[0] : null;
    const ago = firstSent ? timeAgo(firstSent) : null;
    const operatorName = orderOperatorName(order);

    return (
      <div key={order.id} className="space-y-2 rounded-xl border border-ui-border bg-ui-page-alt p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-xs font-black text-ui-text">{order.order_number}</span>
            <span className="shrink-0 rounded-full bg-ui-page-alt px-1.5 py-0.5 text-[10px] font-bold text-ui-muted">
              {orderTypeLabel(t, order.order_type)}
            </span>
            {order.table_id && tableById[order.table_id] && (
              <span className="shrink-0 text-[11px] font-semibold text-ui-success">
                {tableById[order.table_id].name}
              </span>
            )}
          </div>
          <OrderStatusBadge state={deriveOrderState(order, true)} />
        </div>

        {firstSent && ago && (
          <div className="flex items-center gap-1.5 text-[11px] text-ui-subtle">
            <Clock className="h-3 w-3" />
            {isAr
              ? `أُرسل ${ago.n != null ? `${ago.n} ${t(ago.key)}` : t(ago.key)}`
              : `Sent ${ago.n != null ? `${ago.n} ${t(ago.key)}` : t(ago.key)}`}
          </div>
        )}

        {operatorName && <div className="flex items-center gap-1.5 text-[11px] font-bold text-ui-muted"><User className="h-3 w-3" /><span>{isAr ? 'المستخدم:' : 'User:'} {operatorName}</span></div>}

        <div className="space-y-1.5">
          {sends.map((send) => {
            const item = itemById[send.order_item_id];
            const name = item?.product_id ? (productNames[item.product_id] || '—') : '—';
            const modifiers = item?.modifiers_snapshot || [];
            return (
              <div key={send.id} className="space-y-1 rounded-lg bg-ui-surface/60 px-2.5 py-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ui-warning" />
                    <span className="truncate font-medium text-ui-text">{name}</span>
                    <span className="shrink-0 text-[11px] font-bold text-ui-warning">× {Number(send.sent_quantity ?? 0)}</span>
                  </span>
                  <span className="shrink-0 text-[11px] tabular-nums text-ui-subtle">{formatClockTime(send.sent_at, lang)}</span>
                </div>
                {modifiers.length > 0 && (
                  <div className="flex flex-wrap gap-1 ps-3.5" data-testid={`kitchen-item-modifiers-${send.order_item_id}`}>
                    {modifiers.map((modifier) => (
                      <span
                        key={`${modifier.group_id}-${modifier.option_id}`}
                        className="inline-flex items-center rounded-md border border-ui-warning/25 bg-ui-warning/10 px-1.5 py-0.5 text-[10px] font-bold text-ui-warning"
                      >
                        {isAr ? modifier.option_name : modifier.option_name_en || modifier.option_name}
                      </span>
                    ))}
                  </div>
                )}
                {item?.notes && (
                  <div className="ps-3.5 text-[10px] font-semibold text-ui-danger">
                    {isAr ? 'ملاحظة' : 'Note'}: {item.notes}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <>
      {open && <div className="fixed inset-0 top-16 z-40 bg-ui-text/40 backdrop-blur-[1px]" onClick={onClose} />}
      <aside
        className={`fixed bottom-0 end-0 top-16 z-50 flex w-[360px] max-w-[88vw] flex-col border-s border-ui-border bg-ui-surface shadow-ui-xl transition-transform duration-300 ${
          open ? 'translate-x-0' : isAr ? '-translate-x-full' : 'translate-x-full'
        }`}
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-ui-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-bold text-ui-text">
            <ChefHat className="h-4 w-4 text-ui-warning" />
            {t('kitchen')}
            <span className="rounded-full bg-ui-warning/10 px-2 py-0.5 text-[11px] font-bold text-ui-warning">{kitchenOrders.length}</span>
          </h2>
          <button
            onClick={onClose}
            aria-label={isAr ? 'إغلاق لوحة المطبخ' : 'Close kitchen panel'}
            title={isAr ? 'إغلاق لوحة المطبخ' : 'Close kitchen panel'}
            className="rounded-lg p-2 text-ui-muted transition-colors hover:bg-ui-page-alt"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2.5">
          <section className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-ui-subtle">
              <Send className="h-3.5 w-3.5" /> {t('inKitchen')} ({kitchenOrders.length})
            </h3>
            {kitchenOrders.length === 0 ? (
              <div className="py-8 text-center text-ui-subtle">
                <ChefHat className="mx-auto mb-2 h-10 w-10 opacity-30" />
                <p className="text-sm">{isAr ? 'لا توجد طلبات مرسلة للمطبخ' : 'No orders sent to the kitchen'}</p>
              </div>
            ) : (
              kitchenOrders.map(renderOrder)
            )}
          </section>
        </div>
      </aside>
    </>
  );
}
