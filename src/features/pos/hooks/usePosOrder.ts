import { useMemo, useState, useCallback } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { cartToItems } from '../utils/cart';
import { nextInvoiceNumber, processSaleForOrder } from '../services/payment';
import {
  usePosOrder as usePosOrderBase,
  type ActiveShiftInfo,
  type UsePosOrderInput,
} from './usePosOrderBase';

export type { ActiveShiftInfo, UsePosOrderInput } from './usePosOrderBase';

/**
 * POS wrapper for unconditional quantity sell-through.
 *
 * Stock quantity is informational/accounting state, not a saleability gate.
 * Physical raw-material deduction remains server-owned at send_to_kitchen and
 * may take inventory negative according to the established inventory contract.
 * Configuration, branch, permission, shift and order-state checks remain intact.
 */
export function usePosOrder(input: UsePosOrderInput) {
  const sellThroughInput = useMemo<UsePosOrderInput>(() => ({
    ...input,
    // usePosOrderBase historically uses this map only to bypass client-side
    // quantity guards. Mark every visible product eligible here without
    // changing the real raw-shortage signal or any server inventory behavior.
    rawShortageOnly: Object.fromEntries(input.products.map((product) => [product.id, true])),
  }), [input]);

  const base = usePosOrderBase(sellThroughInput);
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const { show } = useToast();
  const [offlineCompleting, setOfflineCompleting] = useState(false);

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

    // Offline quantity availability is not a saleability gate. Reconciliation
    // remains server-authoritative; no cached-stock rejection is performed here.
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
  }, [base, input.activeShift?.id, input.branchId, isAr, offlineCompleting, show]);

  return {
    ...base,
    completing: base.completing || offlineCompleting,
    completeSale,
  };
}

export type UsePosOrder = ReturnType<typeof usePosOrder>;

// Keep these names visible from the public hook module for existing imports.
void (null as unknown as ActiveShiftInfo | UsePosOrderInput);
