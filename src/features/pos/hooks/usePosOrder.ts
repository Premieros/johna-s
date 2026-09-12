import { useCallback, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { cartLineKey, cartToItems } from '../utils/cart';
import { nextInvoiceNumber, processSaleForOrder } from '../services/payment';
import { useCartAwareAvailability } from './useCartAwareAvailability';
import {
  usePosOrder as usePosOrderBase,
  type ActiveShiftInfo,
  type UsePosOrderInput,
} from './usePosOrderBase';

export type { ActiveShiftInfo, UsePosOrderInput } from './usePosOrderBase';

/**
 * Safety wrapper around the proven online POS hook.
 *
 * Online checkout is delegated unchanged to usePosOrderBase. The additional
 * online cart guard is read-only: it projects only unsent cart demand against
 * canonical warehouse/BOM availability. Physical deduction remains owned by
 * send_to_kitchen / the server sale path.
 *
 * Explicit offline checkout keeps the existing durable-outbox behavior.
 */
export function usePosOrder(input: UsePosOrderInput) {
  const base = usePosOrderBase(input);
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const { show } = useToast();
  const [offlineCompleting, setOfflineCompleting] = useState(false);
  const kitchenRefreshKey = base.kitchenSentItems
    .map((item) => `${item.order_item_id}:${Number(item.quantity || 0)}`)
    .sort()
    .join('|');
  const cartAvailability = useCartAwareAvailability({
    branchId: input.branchId,
    activeOrderId: base.activeOrderId,
    cart: base.cart,
    refreshKey: kitchenRefreshKey,
  });

  const showAvailabilityBlocked = useCallback((productName?: string) => {
    show(
      isAr
        ? `${productName ? `${productName}: ` : ''}الكمية غير متاحة بعد احتساب مكونات الطلب الحالي.`
        : `${productName ? `${productName}: ` : ''}Insufficient availability after accounting for the current order components.`,
      'error',
    );
  }, [isAr, show]);

  const showPhysicalStockBlocked = useCallback((productName: string, stock: number) => {
    show(`${productName}: ${isAr ? 'المخزون غير كافٍ' : 'Insufficient stock'} (${stock})`, 'error');
  }, [isAr, show]);

  const addToCart = useCallback((...args: Parameters<typeof base.addToCart>) => {
    const product = args[0];
    const quantity = Number(args[1] ?? 1);
    if (!cartAvailability.canAdd(product.id, quantity)) {
      showAvailabilityBlocked(product.name);
      return;
    }
    const currentQty = base.cart
      .filter((item) => item.product.id === product.id)
      .reduce((sum, item) => sum + item.quantity, 0);
    const physicalStock = Number(input.stockMap[product.id] || 0);
    if (currentQty + quantity > physicalStock) {
      showPhysicalStockBlocked(product.name, physicalStock);
      return;
    }
    cartAvailability.markMutationPending();
    base.addToCart(...args);
  }, [base, cartAvailability, input.stockMap, showAvailabilityBlocked, showPhysicalStockBlocked]);

  const updateQty = useCallback((...args: Parameters<typeof base.updateQty>) => {
    const [lineKey, delta] = args;
    const target = base.cart.find((item) => cartLineKey(item) === lineKey);
    if (!target) return;
    if (delta > 0 && !cartAvailability.canAdd(target.product.id, delta)) {
      showAvailabilityBlocked(target.product.name);
      return;
    }
    if (delta > 0) {
      const currentQty = base.cart
        .filter((item) => item.product.id === target.product.id)
        .reduce((sum, item) => sum + item.quantity, 0);
      const physicalStock = Number(input.stockMap[target.product.id] || 0);
      if (currentQty + delta > physicalStock) {
        showPhysicalStockBlocked(target.product.name, physicalStock);
        return;
      }
      cartAvailability.markMutationPending();
    }
    base.updateQty(...args);
  }, [base, cartAvailability, input.stockMap, showAvailabilityBlocked, showPhysicalStockBlocked]);

  const setQty = useCallback((...args: Parameters<typeof base.setQty>) => {
    const [lineKey, qty] = args;
    const target = base.cart.find((item) => cartLineKey(item) === lineKey);
    if (!target) return;
    const delta = Number(qty) - target.quantity;
    if (delta > 0 && !cartAvailability.canAdd(target.product.id, delta)) {
      showAvailabilityBlocked(target.product.name);
      return;
    }
    if (delta > 0) {
      const otherQty = base.cart
        .filter((item) => item.product.id === target.product.id && cartLineKey(item) !== lineKey)
        .reduce((sum, item) => sum + item.quantity, 0);
      const physicalStock = Number(input.stockMap[target.product.id] || 0);
      if (otherQty + Number(qty) > physicalStock) {
        showPhysicalStockBlocked(target.product.name, physicalStock);
        return;
      }
      cartAvailability.markMutationPending();
    }
    base.setQty(...args);
  }, [base, cartAvailability, input.stockMap, showAvailabilityBlocked, showPhysicalStockBlocked]);

  const replaceCartLine = useCallback((...args: Parameters<typeof base.replaceCartLine>) => {
    const [lineKey, nextItem] = args;
    const current = base.cart.find((item) => cartLineKey(item) === lineKey);
    if (!current) return false;

    const positiveDemand = current.product.id === nextItem.product.id
      ? Math.max(nextItem.quantity - current.quantity, 0)
      : nextItem.quantity;
    if (positiveDemand > 0 && !cartAvailability.canAdd(nextItem.product.id, positiveDemand)) {
      showAvailabilityBlocked(nextItem.product.name);
      return false;
    }

    const otherQty = base.cart
      .filter((item) => item.product.id === nextItem.product.id && cartLineKey(item) !== lineKey)
      .reduce((sum, item) => sum + item.quantity, 0);
    const physicalStock = Number(input.stockMap[nextItem.product.id] || 0);
    if (otherQty + nextItem.quantity > physicalStock) {
      showPhysicalStockBlocked(nextItem.product.name, physicalStock);
      return false;
    }

    if (positiveDemand > 0) cartAvailability.markMutationPending();
    return base.replaceCartLine(...args);
  }, [base, cartAvailability, input.stockMap, showAvailabilityBlocked, showPhysicalStockBlocked]);

  const removeFromCart = useCallback((...args: Parameters<typeof base.removeFromCart>) => {
    base.removeFromCart(...args);
    cartAvailability.markMutationPending();
  }, [base, cartAvailability]);

  const clearCart = useCallback(() => {
    base.clearCart();
    cartAvailability.markMutationPending();
  }, [base, cartAvailability]);

  const completeSale = useCallback(async (): Promise<boolean> => {
    const explicitlyOffline = typeof navigator !== 'undefined' && !navigator.onLine;
    if (!explicitlyOffline) return base.completeSale();

    if (base.cart.length === 0 || base.completing || offlineCompleting) return false;
    if (!input.branchId) {
      show(isAr ? 'اختر الفرع أولاً' : 'Select a branch first', 'error');
      return false;
    }
    if (!input.activeShift?.id) {
      show(isAr ? 'يجب وجود وردية مفتوحة' : 'An open shift is required', 'error');
      return false;
    }
    if (base.orderType === 'dine_in' && !base.tableId) {
      show(isAr ? 'اختر طاولة لطلب داخل الصالة' : 'Select a table for dine-in orders', 'error');
      return false;
    }

    // Direct offline sales rely on the last branch-scoped cached stock view.
    // Linked kitchen orders already crossed the authoritative inventory boundary.
    if (!base.activeOrderId) {
      for (const item of base.cart) {
        const cachedStock = Number(input.stockMap[item.product.id] || 0);
        const negativeEligible = input.rawShortageOnly?.[item.product.id] === true;
        if (!negativeEligible && cachedStock < item.quantity) {
          show(
            isAr
              ? `${item.product.name}: المخزون المحلي غير كافٍ (${cachedStock})`
              : `${item.product.name}: cached stock is insufficient (${cachedStock})`,
            'error',
          );
          return false;
        }
      }
    }

    setOfflineCompleting(true);
    try {
      const invoiceNumber = await nextInvoiceNumber();
      const paidAmountToUse = base.paymentMethod === 'credit' ? 0 : base.paidAmount || base.total;
      const { result, error } = await processSaleForOrder({
        p_invoice_number: invoiceNumber,
        p_branch_id: input.branchId,
        p_shift_id: input.activeShift.id,
        // Warehouse resolution is server-authoritative on reconciliation. An
        // offline client must not invent a warehouse it cannot verify.
        p_warehouse_id: null,
        p_customer_id: base.customerId || null,
        p_salesperson_id: null,
        p_subtotal: base.subtotal,
        p_discount_amount: base.discountValue,
        p_discount_type: base.discountType === 'percent' ? 'percent' : 'amount',
        p_tax_amount: base.taxAmount,
        p_bonus_amount: 0,
        p_total: base.total,
        p_paid_amount: paidAmountToUse,
        p_payment_method: base.paymentMethod,
        p_status: 'completed',
        p_items: cartToItems(base.cart),
        p_order_type: base.orderType,
        p_table_id: base.orderType === 'dine_in' ? base.tableId : null,
        p_order_id: base.activeOrderId,
        p_guest_count: base.guestCount,
      });

      if (error || !result?.success || !result.offline || !result.pending_sync) {
        show(error || result?.detail || result?.error || (isAr ? 'تعذر حفظ البيع دون اتصال بأمان' : 'Could not safely queue the offline sale'), 'error');
        return false;
      }

      // Intentionally no receiptSaleId, no saleCompleted toast, no audit write,
      // no receipt auto-print, and no cash-drawer kick. The server has not yet
      // confirmed a financial sale/payment.
      base.resetWorkspace();
      show(
        isAr
          ? 'تم حفظ العملية محليًا كمعلّقة للمزامنة. لم يتم تسجيل البيع أو الدفع نهائيًا بعد.'
          : 'Saved locally as pending sync. The sale/payment is not final until the server confirms it.',
        'warning',
      );
      return true;
    } catch (error) {
      show(
        error instanceof Error ? error.message : (isAr ? 'تعذر حفظ البيع دون اتصال بأمان' : 'Could not safely queue the offline sale'),
        'error',
      );
      return false;
    } finally {
      setOfflineCompleting(false);
    }
  }, [base, input.activeShift?.id, input.branchId, input.stockMap, input.rawShortageOnly, isAr, offlineCompleting, show]);

  return {
    ...base,
    addToCart,
    updateQty,
    setQty,
    replaceCartLine,
    removeFromCart,
    clearCart,
    completing: base.completing || offlineCompleting,
    completeSale,
  };
}

export type UsePosOrder = ReturnType<typeof usePosOrder>;

// Keep these names visible from the public hook module for existing imports.
void (null as unknown as ActiveShiftInfo | UsePosOrderInput);
