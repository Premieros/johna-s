import { useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Check,
  Clock,
  Minus,
  Percent,
  Plus,
  ShoppingCart,
  Trash2,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { formatCurrency } from '@/lib/format';
import type { CartItem, Customer, DiningTable, OrderItem, OrderType } from '@/lib/types';
import type { KitchenSendItem } from '../../types';
import { computeSentState } from '../../utils/sentState';
import { cartLineKey, orderItemLineKey } from '../../utils/cart';
import { formatClockTime, timeAgo } from '../../utils/timeAgo';
import { deriveCartStage } from '../../utils/orderStage';
import { ORDER_TYPES } from '../../utils/orderTypes';
import { orderTypeLabel } from '../../utils/format';
import { usePosPermissions, type PosPermissions } from '../../hooks/usePosPermissions';
import { OrderTypePill } from './OrderTypePill';
import { OrderStageBadge } from './OrderStageBadge';
import { TransferItemModal } from '../tables/TransferItemModal';

interface CurrentOrderPanelProps {
  cart: CartItem[];
  currency: string;
  subtotal: number;
  discountValue: number;
  discountType: 'amount' | 'percent';
  discountAmount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
  completing: boolean;
  orderLoading: boolean;
  kitchenSending: boolean;
  orderType: OrderType;
  activeOrderNumber: string | null;
  activeOrderId: string | null;
  activeTable: DiningTable | null;
  guestCount: number | null;
  customerId: string;
  customerById: Record<string, Customer>;
  orderNotes: string;
  activeOrderCreatedAt: string | null;
  orderItems: OrderItem[];
  sentOrderItemIds: Set<string>;
  sessionSent: KitchenSendItem[];
  canDiscount?: boolean;
  canDeleteItem?: boolean;
  perms?: PosPermissions;
  onSwitchOrderType: (ot: OrderType) => void;
  onGuestCountChange: (n: number | null) => void;
  onDiscountTypeChange: (v: 'amount' | 'percent') => void;
  onDiscountAmountChange: (v: number) => void;
  onUpdateQty: (lineKey: string, delta: number) => void;
  onSetQty: (lineKey: string, qty: number) => void;
  onRemove: (lineKey: string) => void;
  onClear: () => void;
  onSetItemDiscount: (lineKey: string, discount: number) => void;
  onHold: () => void;
  onSendKitchen: () => void;
  onPrint: () => void;
  onPay: () => void;
  onAddItem?: () => void;
  onConfigureItem?: (item: CartItem) => void;
  onOpenCustomerModal?: () => void;
  onOpenTableModal?: () => void;
  onVoidItem?: (item: CartItem, sentQty: number) => void;
}

export function CurrentOrderPanel({
  cart,
  currency,
  subtotal,
  discountValue,
  discountType,
  discountAmount,
  total,
  orderType,
  activeOrderNumber,
  activeOrderId,
  activeTable,
  guestCount,
  orderNotes,
  activeOrderCreatedAt,
  orderItems,
  sentOrderItemIds,
  sessionSent,
  canDiscount = true,
  canDeleteItem = true,
  perms: permissionOverride,
  onSwitchOrderType,
  onGuestCountChange,
  onDiscountTypeChange,
  onDiscountAmountChange,
  onUpdateQty,
  onRemove,
  onAddItem,
  onConfigureItem,
  onOpenTableModal,
  onVoidItem,
}: CurrentOrderPanelProps) {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const resolvedPermissions = usePosPermissions();
  const perms = permissionOverride ?? resolvedPermissions;
  const [showDiscount, setShowDiscount] = useState(false);
  const [splitItem, setSplitItem] = useState<CartItem | null>(null);
  const [selectedLineKey, setSelectedLineKey] = useState<string | null>(null);

  const sentState = computeSentState(cart, orderItems, sentOrderItemIds, sessionSent);
  const ago = activeOrderCreatedAt ? timeAgo(activeOrderCreatedAt) : null;
  const stage = deriveCartStage(cart, sentState, false);
  const empty = cart.length === 0;

  const selectedItem = useMemo(
    () => (selectedLineKey ? cart.find((item) => cartLineKey(item) === selectedLineKey) || null : null),
    [cart, selectedLineKey],
  );
  const selectedSent = selectedItem ? sentState[cartLineKey(selectedItem)] : null;
  const selectedMatches = selectedItem
    ? orderItems.filter((row) => orderItemLineKey(row) === cartLineKey(selectedItem))
    : [];
  const selectedCanSplit = perms.canSplitOrder && !!activeOrderId && !!selectedItem && (selectedSent?.sentQty || 0) === 0 && selectedMatches.length === 1;

  const splitLineKey = splitItem ? cartLineKey(splitItem) : null;
  const splitOrderItemMatches = splitLineKey ? orderItems.filter((row) => orderItemLineKey(row) === splitLineKey) : [];
  const splitOrderItemId = splitOrderItemMatches.length === 1 ? splitOrderItemMatches[0].id : null;

  const applyCompletedSplit = (quantity: number) => {
    if (!splitItem) return;
    const lineKey = cartLineKey(splitItem);
    if (quantity >= splitItem.quantity) onRemove(lineKey);
    else onUpdateQty(lineKey, -quantity);
    setSplitItem(null);
    setSelectedLineKey(null);
  };

  const handleSelectedVoid = () => {
    if (!selectedItem || !canDeleteItem) return;
    const lineKey = cartLineKey(selectedItem);
    const sentQty = selectedSent?.sentQty || 0;
    if (sentQty > 0 && onVoidItem) onVoidItem(selectedItem, sentQty);
    else onRemove(lineKey);
    setSelectedLineKey(null);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-ui-surface text-ui-text">
      <div className="shrink-0 border-b border-ui-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-ui-primary-soft">
            <ShoppingCart className="h-4 w-4 text-ui-accent" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-black text-ui-text">{activeOrderNumber ? `#${activeOrderNumber}` : t('newOrder')}</p>
              <OrderStageBadge stage={stage} />
            </div>
            <p className="text-[11px] font-bold text-ui-muted">{cart.length} {isAr ? 'صنف' : 'items'}</p>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {activeOrderNumber ? (
            <OrderTypePill type={orderType} />
          ) : (
            <div className="flex items-center gap-1 rounded-xl bg-ui-page-alt p-1">
              {ORDER_TYPES.map((type) => (
                <button
                  key={type}
                  type="button"
                  data-testid={`pos-switch-type-${type}`}
                  aria-pressed={type === orderType}
                  onClick={() => onSwitchOrderType(type)}
                  disabled={!perms.canEditOrder}
                  className={`rounded-lg px-2.5 py-1 text-[10px] font-black transition disabled:cursor-not-allowed disabled:opacity-40 ${type === orderType ? 'bg-ui-primary text-ui-primary-fg shadow-ui-sm' : 'text-ui-muted hover:text-ui-text'}`}
                >
                  {orderTypeLabel(t, type)}
                </button>
              ))}
            </div>
          )}

          {orderType === 'dine_in' && (
            <button type="button" disabled={!perms.canEditOrder} onClick={onOpenTableModal} className="flex items-center gap-1 rounded-lg bg-ui-page-alt px-2 py-1 text-[10px] font-black text-ui-muted transition hover:text-ui-text disabled:cursor-not-allowed disabled:opacity-40">
              <UtensilsCrossed className="h-3 w-3 text-ui-success" />
              <span className="max-w-[100px] truncate">{activeTable?.name || (isAr ? 'اختر طاولة' : 'Select table')}</span>
            </button>
          )}

          {orderType === 'dine_in' && (
            <label className="flex items-center gap-1 text-[10px] font-bold text-ui-muted">
              {isAr ? 'أفراد' : 'Guests'}
              <input type="number" min={1} disabled={!perms.canEditOrder} value={guestCount || ''} onChange={(event) => onGuestCountChange(parseInt(event.target.value) || null)} className="w-12 rounded-lg border border-ui-border bg-ui-surface-raised px-1.5 py-1 text-center text-xs font-black text-ui-text outline-none focus:border-ui-primary disabled:cursor-not-allowed disabled:opacity-40" />
            </label>
          )}

          {canDiscount && !empty && (
            <button
              data-testid="pos-action-discount"
              type="button"
              onClick={() => setShowDiscount((value) => !value)}
              className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-[10px] font-black transition ${showDiscount ? 'border-ui-primary bg-ui-primary text-ui-primary-fg' : 'border-ui-border bg-ui-page-alt text-ui-text'}`}
            >
              <Percent className="h-3 w-3" />
              <span>{isAr ? 'خصم' : 'Discount'}</span>
            </button>
          )}

          {activeOrderCreatedAt && (
            <span className="ms-auto flex items-center gap-1 text-[10px] font-bold text-ui-subtle">
              <Clock className="h-3 w-3" />
              {formatClockTime(activeOrderCreatedAt, lang)}
              {ago && <span className="hidden 2xl:inline">· {ago.n != null ? `${ago.n} ${t(ago.key)}` : t(ago.key)}</span>}
            </span>
          )}
        </div>

        {selectedItem && (
          <div className="mt-2 flex items-center gap-2 rounded-xl border border-ui-primary/30 bg-ui-primary-soft p-2">
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold text-ui-muted">{isAr ? 'الصنف المحدد' : 'Selected item'}</p>
              <p className="truncate text-xs font-black text-ui-text">{selectedItem.product.name} × {selectedItem.quantity}</p>
            </div>
            {perms.canSplitOrder && (
              <button
                type="button"
                data-testid={`pos-selected-split-${selectedItem.product.id}`}
                disabled={!selectedCanSplit}
                onClick={() => setSplitItem(selectedItem)}
                className="flex h-9 items-center gap-1 rounded-lg border border-ui-primary/30 bg-ui-surface px-2.5 text-[10px] font-black text-ui-accent disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" /> Split
              </button>
            )}
            {canDeleteItem && (
              <button
                type="button"
                data-testid={`pos-selected-void-${selectedItem.product.id}`}
                onClick={handleSelectedVoid}
                className="flex h-9 items-center gap-1 rounded-lg border border-ui-danger/30 bg-ui-surface px-2.5 text-[10px] font-black text-ui-danger"
              >
                <Trash2 className="h-3.5 w-3.5" /> {selectedSent?.sentQty ? 'Void' : (isAr ? 'حذف' : 'Remove')}
              </button>
            )}
            <button type="button" onClick={() => setSelectedLineKey(null)} className="flex h-9 w-9 items-center justify-center rounded-lg text-ui-subtle hover:bg-ui-surface">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {showDiscount && !empty && (
          <div data-testid="pos-discount-editor" className="mt-2 rounded-xl border border-ui-border bg-ui-page-alt p-2">
            <div className="flex gap-2">
              <button data-testid="pos-discount-percent" type="button" onClick={() => onDiscountTypeChange('percent')} className={`flex-1 rounded-lg p-2 text-xs font-black ${discountType === 'percent' ? 'bg-ui-primary text-ui-primary-fg' : 'bg-ui-surface text-ui-muted'}`}>%</button>
              <button data-testid="pos-discount-amount" type="button" onClick={() => onDiscountTypeChange('amount')} className={`flex-1 rounded-lg p-2 text-xs font-black ${discountType === 'amount' ? 'bg-ui-primary text-ui-primary-fg' : 'bg-ui-surface text-ui-muted'}`}>{currency}</button>
              <input data-testid="pos-discount-input" aria-label={isAr ? 'قيمة الخصم' : 'Discount value'} type="number" min={0} value={discountAmount || ''} onChange={(event) => onDiscountAmountChange(parseFloat(event.target.value) || 0)} className="w-24 rounded-lg border border-ui-border bg-ui-surface p-2 text-center text-xs font-black text-ui-text" />
            </div>
          </div>
        )}

        {orderNotes && <p className="mt-2 truncate rounded-lg bg-ui-page-alt px-2 py-1 text-[10px] font-bold text-ui-subtle">{orderNotes}</p>}
      </div>

      <div className={`min-h-0 flex-1 overflow-y-auto ${empty ? 'p-3' : 'p-2.5'}`}>
        {empty ? (
          <div data-testid="pos-empty-cart-state" className="rounded-2xl border border-dashed border-ui-border bg-ui-page-alt/60 px-4 py-5 text-center text-ui-subtle">
            <div className="mx-auto mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-ui-surface"><ShoppingCart className="h-5 w-5 opacity-40" /></div>
            <p className="text-sm font-black text-ui-text">{t('emptyCart')}</p>
            <p className="mt-1 text-[10px] font-bold">{isAr ? 'اختر منتجًا من القائمة لبدء الطلب' : 'Choose a product to start the order'}</p>
            {onAddItem && perms.canEditOrder && (
              <button
                type="button"
                data-testid="pos-empty-cart-add-item"
                onClick={onAddItem}
                className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-ui-primary px-3 py-2 text-[11px] font-black text-ui-primary-fg shadow-ui-xs transition hover:bg-ui-primary-hover active:scale-95"
              >
                <Plus className="h-3.5 w-3.5" />
                {isAr ? 'إضافة صنف' : 'Add item'}
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-2">
            {cart.map((item) => {
              const lineKey = cartLineKey(item);
              const sent = sentState[lineKey] || { sentQty: 0, newQty: item.quantity, sent: false, partial: false };
              const selected = selectedLineKey === lineKey;
              const sentLineLocked = sent.sentQty > 0 && item.quantity <= sent.sentQty && !canDeleteItem;
              return (
                <div
                  key={lineKey}
                  data-testid={`pos-cart-line-${item.product.id}`}
                  className={`rounded-2xl border p-2.5 transition ${selected ? 'border-ui-primary bg-ui-primary-soft shadow-ui-sm' : 'border-ui-border bg-ui-page-alt hover:border-ui-border-strong'}`}
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSelectedLineKey(selected ? null : lineKey)}
                      aria-pressed={selected}
                      className="min-w-0 flex-1 text-start"
                    >
                      <div className="flex items-center gap-1.5">
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${selected ? 'border-ui-primary bg-ui-primary text-ui-primary-fg' : 'border-ui-border bg-ui-surface'}`}>
                          {selected && <Check className="h-3 w-3" />}
                        </span>
                        <p className="truncate text-xs font-black text-ui-text">{item.product.name}</p>
                        {sent.sent && <Check className="h-3 w-3 shrink-0 text-ui-success" />}
                      </div>
                      {item.modifiers?.length ? <p className="mt-0.5 truncate ps-5 text-[10px] font-bold text-ui-muted">{item.modifiers.map((modifier) => modifier.name).join(' · ')}</p> : null}
                      {item.item_note ? <p className="mt-0.5 truncate ps-5 text-[10px] font-bold text-ui-muted">📝 {item.item_note}</p> : null}
                    </button>
                    {perms.canEditOrder && (
                      <button
                        type="button"
                        onClick={() => onConfigureItem?.(item)}
                        disabled={sent.sentQty > 0}
                        title={sent.sentQty > 0
                          ? (isAr ? 'الصنف مُرسل للمطبخ؛ استخدم Void للتقليل أو التغيير' : 'Sent item: use Void to reduce or change it')
                          : undefined}
                        className="shrink-0 rounded-lg border border-ui-border px-2 py-1 text-[10px] font-bold text-ui-muted hover:border-ui-primary hover:bg-ui-surface hover:text-ui-text disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {sent.sentQty > 0 ? (isAr ? 'مرسل' : 'Sent') : (isAr ? 'تعديل' : 'Edit')}
                      </button>
                    )}
                    <span className="shrink-0 text-xs font-black text-ui-accent">{formatCurrency(item.quantity * item.unit_price - (item.discount_amount || 0), currency, lang)}</span>
                  </div>

                  <div className="mt-2 flex items-center gap-1.5 border-t border-ui-border/70 pt-2">
                    <button
                      data-testid={`pos-cart-qty-decrease-${item.product.id}`}
                      aria-label={isAr ? `تقليل كمية ${item.product.name}` : `Decrease quantity ${item.product.name}`}
                      disabled={!perms.canEditOrder || sentLineLocked}
                      onClick={() => sent.sentQty > 0 && item.quantity <= sent.sentQty && onVoidItem ? onVoidItem(item, sent.sentQty) : onUpdateQty(lineKey, -1)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg border border-ui-border bg-ui-surface text-ui-text disabled:cursor-not-allowed disabled:opacity-40"
                    ><Minus className="h-3.5 w-3.5" /></button>
                    <span data-testid={`pos-cart-qty-${item.product.id}`} className="w-7 text-center text-xs font-black text-ui-text">{item.quantity}</span>
                    <button data-testid={`pos-cart-qty-increase-${item.product.id}`} aria-label={isAr ? `زيادة كمية ${item.product.name}` : `Increase quantity ${item.product.name}`} disabled={!perms.canEditOrder} onClick={() => onUpdateQty(lineKey, 1)} className="flex h-7 w-7 items-center justify-center rounded-lg bg-ui-primary text-ui-primary-fg disabled:cursor-not-allowed disabled:opacity-40"><Plus className="h-3.5 w-3.5" /></button>
                    <span className="ms-auto text-[10px] font-bold text-ui-muted">
                      {sent.sentQty > 0 ? (isAr ? `مرسل ${sent.sentQty}` : `Sent ${sent.sentQty}`) : (isAr ? 'غير مرسل' : 'Unsent')}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {!empty && (
        <div className="shrink-0 border-t border-ui-border p-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-ui-border bg-ui-page-alt p-2"><p className="text-[10px] font-bold text-ui-muted">{t('subtotal')}</p><p className="mt-0.5 truncate text-xs font-black text-ui-text">{formatCurrency(subtotal, currency, lang)}</p></div>
            <div className="rounded-xl bg-ui-page-alt p-2"><p className="text-[9px] font-bold text-ui-subtle">{t('discount')}</p><p data-testid="pos-discount-value" className="mt-0.5 truncate text-xs font-black text-ui-text">{formatCurrency(discountValue, currency, lang)}</p></div>
            <div className="rounded-xl border border-ui-primary/30 bg-ui-primary-soft p-2"><p className="text-[10px] font-bold text-ui-muted">{t('total')}</p><p data-testid="pos-total-value" className="mt-0.5 truncate text-sm font-black text-ui-accent">{formatCurrency(total, currency, lang)}</p></div>
          </div>
        </div>
      )}

      {perms.canSplitOrder && (
        <TransferItemModal
          open={!!splitItem}
          onClose={() => setSplitItem(null)}
          item={splitItem}
          orderId={activeOrderId}
          orderItemId={splitOrderItemId}
          sourceTable={activeTable}
          onCompleted={applyCompletedSplit}
        />
      )}
    </div>
  );
}