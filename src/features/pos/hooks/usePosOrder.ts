import { useMemo, useRef, useState, useCallback } from 'react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { cartToItems, type ItemPayload } from '../utils/cart';
import { createSaleOperationKey, nextInvoiceNumber, processSaleForOrder } from '../services/payment';
import type { OrderSettlementPreview } from '../services/settlementPreview';
import { useScopedSettlementPreview } from './useScopedSettlementPreview';
import { APPROVED_FIXED_THERMAL_WIDTH_MM, buildReceiptFixedTemplate, buildReceiptHtml, buildReceiptThermalText, enqueueAutomaticReceiptPrint, openPrintWindow, type ReceiptData } from '../utils/printing';
import { enqueueCloudOpenOrderPrint } from '../services/cloudPrint';
import { ORDER_TYPE_KEY } from '../utils/orderTypes';
import { resolveOrderBindingForSave } from '../utils/orderBinding';
import { usePosPermissions } from './usePosPermissions';
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
    rawShortageOnly: Object.fromEntries(input.products.map((product) => [product.id, true])),
  }), [input]);

  const base = usePosOrderBase(sellThroughInput);
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const { show } = useToast();
  const perms = usePosPermissions();
  const [offlineCompleting, setOfflineCompleting] = useState(false);
  const saleMutationLockRef = useRef(false);
  const saleAttemptRef = useRef<{ fingerprint: string; operationKey: string } | null>(null);
  const { preview: settlementPreview, load: loadScopedSettlementPreview, clear: clearSettlementPreview, isCurrent: isCurrentSettlementPreview } = useScopedSettlementPreview(base.activeOrderId, input.branchId);
  const [settlementReceipt, setSettlementReceipt] = useState<ReceiptData | null>(null);
  const [settlementReceiptSaleId, setSettlementReceiptSaleId] = useState<string | null>(null);
  const [settlementReceiptOrderCompleted, setSettlementReceiptOrderCompleted] = useState<boolean | null>(null);
  const [openCheckPrintLockedOrderId, setOpenCheckPrintLockedOrderId] = useState<string | null>(null);

  const findCartSource = useCallback((item: ItemPayload) => {
    const wanted = [...(item.modifier_option_ids || [])].sort().join(',');
    return base.cart.find((entry) => {
      if (entry.product.id !== item.product_id) return false;
      const ids = [...(entry.modifier_option_ids || entry.modifiers?.flatMap((m) => m.id ? [m.id] : []) || [])]
        .sort()
        .join(',');
      return ids === wanted && (entry.item_note || '') === (item.notes || '');
    }) || base.cart.find((entry) => entry.product.id === item.product_id);
  }, [base.cart]);

  const buildSettlementReceipt = useCallback((
    preview: OrderSettlementPreview,
    invoice: string,
    paid: number,
    payments: Array<{ payment_method: string; amount: number }> = [],
  ): ReceiptData => ({
    invoice,
    branchName: input.branchName,
    items: preview.items.map((item) => {
      const source = findCartSource(item);
      return {
        name: source
          ? [source.product.name, source.modifiers?.map((m) => m.name).join(' · ')].filter(Boolean).join(' — ')
          : item.product_id,
        qty: Number(item.quantity),
        price: Number(item.unit_price),
        total: Number(item.total),
      };
    }),
    subtotal: preview.subtotal,
    discount: preview.discount_amount,
    tax: preview.tax_amount,
    total: preview.total,
    paid,
    change: Math.max(paid - preview.total, 0),
    date: new Date().toISOString(),
    customerName: input.customers.find((c) => c.id === base.customerId)?.name || '',
    orderNumber: base.activeOrderNumber || undefined,
    tableName: base.activeTable?.name || undefined,
    orderTypeLabel: t(ORDER_TYPE_KEY[base.orderType]),
    guestCount: base.guestCount || undefined,
    operatorName: null,
    payments: payments.map((payment) => ({
      method: payment.payment_method,
      amount: Number(payment.amount || 0),
    })),
  }), [base.activeOrderNumber, base.activeTable?.name, base.customerId, base.guestCount, base.orderType, findCartSource, input.branchName, input.customers, t]);

  const saveOpenOrderSnapshot = useCallback(async (): Promise<boolean> => {
    if (!base.activeOrderId || !perms.canEditOrder) return true;

    const { data: currentOrder, error: currentOrderError } = await supabase
      .from('orders')
      .select('status')
      .eq('id', base.activeOrderId)
      .eq('branch_id', input.branchId)
      .maybeSingle();

    if (currentOrderError) {
      show(currentOrderError.message, 'error');
      return false;
    }

    const status = (currentOrder as { status?: 'open' | 'held' } | null)?.status;
    if (status !== 'open' && status !== 'held') {
      show(isAr ? 'الطلب لم يعد مفتوحًا للتحصيل' : 'The order is no longer open for settlement', 'error');
      return false;
    }

    const binding = resolveOrderBindingForSave({
      activeOrderId: base.activeOrderId,
      orderType: base.orderType,
      tableId: base.tableId,
      activeTableId: base.activeTable?.id ?? null,
    });
    const { data, error } = await api.floorPlan.updateOrder({
      p_order_id: base.activeOrderId,
      p_order_type: binding.orderType,
      p_table_id: binding.tableId,
      p_customer_id: base.customerId || null,
      p_guest_count: base.guestCount,
      p_notes: base.orderNotes || null,
      p_items: cartToItems(base.cart),
      p_subtotal: base.subtotal,
      p_discount_amount: base.discountValue,
      p_discount_type: base.discountType === 'percent' ? 'percent' : 'amount',
      p_tax_amount: base.taxAmount,
      p_total: base.total,
      p_status: status,
    });

    const result = data as { success?: boolean; error?: string; detail?: string } | null;
    if (error || !result?.success) {
      show(error?.message || result?.detail || result?.error || (isAr ? 'تعذر حفظ الإضافات قبل التحصيل' : 'Could not save order additions before settlement'), 'error');
      return false;
    }

    return true;
  }, [base, input.branchId, isAr, perms.canEditOrder, show]);

  const loadSettlementPreview = useCallback(async (saveSnapshot: boolean): Promise<OrderSettlementPreview | null> => {
    if (!base.activeOrderId) return null;
    if (saveSnapshot && !(await saveOpenOrderSnapshot())) return null;

    const { preview, error } = await loadScopedSettlementPreview();
    // A superseded or closed checkout read must not open another order checkout.
    if (!preview && !error) return null;
    if (error || !preview?.has_payable_items) {
      show(error || (isAr ? 'لا توجد أصناف مرسلة للمطبخ جاهزة للتحصيل' : 'No sent kitchen items are ready for settlement'), 'error');
      return null;
    }

    return preview;
  }, [base.activeOrderId, isAr, loadScopedSettlementPreview, saveOpenOrderSnapshot, show]);

  const transferOrderToTable = useCallback(async (
    targetOrderId: string,
    _fromTableId: string,
    toTableId: string,
  ): Promise<boolean> => {
    try {
      const { data, error } = await supabase.rpc('transfer_order_to_table', {
        p_order_id: targetOrderId,
        p_target_table_id: toTableId,
      });

      if (error) {
        show(error.message, 'error');
        return false;
      }

      const result = data as { success?: boolean; error?: string; detail?: string } | null;
      if (!result?.success) {
        const message = result?.error === 'TARGET_TABLE_OCCUPIED'
          ? (isAr ? 'الطاولة المستهدفة عليها طلب نشط بالفعل.' : 'The target table already has an active order.')
          : result?.detail || result?.error || (isAr ? 'تعذر تحويل الطلب' : 'Order transfer failed');
        show(message, 'error');
        return false;
      }

      if (base.activeOrderId === targetOrderId) base.setTableId(toTableId);
      show(isAr ? 'تم تحويل الطلب إلى الطاولة الجديدة بنجاح' : 'Order transferred successfully', 'success');
      return true;
    } catch (error) {
      show(error instanceof Error ? error.message : (isAr ? 'تعذر تحويل الطلب' : 'Order transfer failed'), 'error');
      return false;
    }
  }, [base.activeOrderId, base.setTableId, isAr, show]);

  const setCheckoutOpen = useCallback((open: boolean) => {
    if (!open) {
      clearSettlementPreview();
      base.setCheckoutOpen(false);
      return;
    }

    if (!base.activeOrderId) {
      base.setCheckoutOpen(true);
      return;
    }

    void (async () => {
      const preview = await loadSettlementPreview(false);
      if (!preview) return;
      if (preview.unsent_quantity > 0) {
        show(
          isAr
            ? `تنبيه: يوجد ${preview.unsent_quantity} من الأصناف غير المرسلة. التحصيل الحالي سيغطي الأصناف المرسلة فقط ولن يغلق الطلب.`
            : `Warning: ${preview.unsent_quantity} unsent item(s) remain. This payment will settle sent items only and will not close the order.`,
          'warning',
        );
      }
      base.setPaidAmount(base.paymentMethod === 'credit' ? 0 : preview.total);
      base.setCheckoutOpen(true);
    })();
  }, [base, clearSettlementPreview, isAr, loadSettlementPreview, show]);

  const completeSale = useCallback(async (): Promise<boolean> => {
    const explicitlyOffline = typeof navigator !== 'undefined' && !navigator.onLine;

    if (explicitlyOffline) {
      if (saleMutationLockRef.current || base.cart.length === 0 || base.completing || offlineCompleting) return false;
      if (!input.branchId) {
        show(isAr ? 'اختر الفرع أولاً' : 'Select a branch first', 'error');
        return false;
      }
      if (!input.activeShift?.id) {
        show(isAr ? 'يجب وجود وردية مفتوحة' : 'An open shift is required', 'error');
        return false;
      }

      // Hold a synchronous mutex before the first await; React's completing
      // state is not synchronous enough to stop a same-tick duplicate submit.
      saleMutationLockRef.current = true;
      setOfflineCompleting(true);
      try {
        const invoiceNumber = await nextInvoiceNumber();
        const paidAmountToUse = base.paymentMethod === 'credit' ? 0 : base.paidAmount || base.total;
        const itemsPayload = cartToItems(base.cart);
        const binding = resolveOrderBindingForSave({
          activeOrderId: base.activeOrderId,
          orderType: base.orderType,
          tableId: base.tableId,
          activeTableId: base.activeTable?.id ?? null,
        });
        const attemptFingerprint = JSON.stringify({
          mode: 'offline',
          branchId: input.branchId,
          shiftId: input.activeShift.id,
          customerId: base.customerId || null,
          subtotal: base.subtotal,
          discountValue: base.discountValue,
          discountType: base.discountType,
          taxAmount: base.taxAmount,
          total: base.total,
          paidAmountToUse,
          paymentMethod: base.paymentMethod,
          items: itemsPayload,
          orderType: binding.orderType,
          tableId: binding.tableId,
          orderId: base.activeOrderId,
          guestCount: base.guestCount,
        });
        if (!saleAttemptRef.current || saleAttemptRef.current.fingerprint !== attemptFingerprint) {
          saleAttemptRef.current = {
            fingerprint: attemptFingerprint,
            operationKey: createSaleOperationKey(),
          };
        }
        const { result, error } = await processSaleForOrder({
          p_client_operation_key: saleAttemptRef.current.operationKey,
          p_invoice_number: invoiceNumber,
          p_branch_id: input.branchId,
          p_shift_id: input.activeShift.id,
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
          p_items: itemsPayload,
          p_order_type: binding.orderType,
          p_table_id: binding.tableId,
          p_order_id: base.activeOrderId,
          p_guest_count: base.guestCount,
        });

        if (error || !result?.success || !result.offline || !result.pending_sync) {
          show(error || result?.detail || result?.error || (isAr ? 'تعذر حفظ البيع دون اتصال بأمان' : 'Could not safely queue the offline sale'), 'error');
          return false;
        }

        saleAttemptRef.current = null;
        base.resetWorkspace();
        show(
          isAr
            ? 'تم حفظ العملية محليًا كمعلّقة للمزامنة. لم يتم تسجيل البيع أو الدفع نهائيًا بعد.'
            : 'Saved locally as pending sync. The sale/payment is not final until the server confirms it.',
          'warning',
        );
        return true;
      } finally {
        saleMutationLockRef.current = false;
        setOfflineCompleting(false);
      }
    }

    if (!base.activeOrderId) return base.completeSale();
    if (saleMutationLockRef.current) return false;
    if (!input.branchId || !input.activeShift?.id) {
      show(isAr ? 'يجب اختيار فرع وفتح وردية قبل التحصيل' : 'Select a branch and open a shift before settlement', 'error');
      return false;
    }

    saleMutationLockRef.current = true;
    setOfflineCompleting(true);
    try {
      // Re-read authoritative sent items and pinned warehouse at confirmation.
      const preview = await loadSettlementPreview(false);
      if (!preview) return false;

      const invoiceNumber = await nextInvoiceNumber();
      if (!isCurrentSettlementPreview(preview)) return false;
      const paidAmountToUse = base.paymentMethod === 'credit' ? 0 : (base.paidAmount || preview.total);
      const binding = resolveOrderBindingForSave({
        activeOrderId: base.activeOrderId,
        orderType: base.orderType,
        tableId: base.tableId,
        activeTableId: base.activeTable?.id ?? null,
      });
      const attemptFingerprint = JSON.stringify({
        mode: 'linked',
        branchId: input.branchId,
        shiftId: input.activeShift.id,
        warehouseId: preview.warehouse_id || null,
        customerId: base.customerId || null,
        subtotal: preview.subtotal,
        discountAmount: preview.discount_amount,
        taxAmount: preview.tax_amount,
        total: preview.total,
        paidAmountToUse,
        paymentMethod: base.paymentMethod,
        items: preview.items,
        orderType: binding.orderType,
        tableId: binding.tableId,
        orderId: base.activeOrderId,
        guestCount: base.guestCount,
      });
      if (!saleAttemptRef.current || saleAttemptRef.current.fingerprint !== attemptFingerprint) {
        saleAttemptRef.current = {
          fingerprint: attemptFingerprint,
          operationKey: createSaleOperationKey(),
        };
      }
      const { result, error } = await processSaleForOrder({
        p_client_operation_key: saleAttemptRef.current.operationKey,
        p_invoice_number: invoiceNumber,
        p_branch_id: input.branchId,
        p_shift_id: input.activeShift.id,
        p_warehouse_id: preview.warehouse_id || null,
        p_customer_id: base.customerId || null,
        p_salesperson_id: null,
        p_subtotal: preview.subtotal,
        p_discount_amount: preview.discount_amount,
        p_discount_type: 'amount',
        p_tax_amount: preview.tax_amount,
        p_bonus_amount: 0,
        p_total: preview.total,
        p_paid_amount: paidAmountToUse,
        p_payment_method: base.paymentMethod,
        p_status: 'completed',
        p_items: preview.items,
        p_order_type: binding.orderType,
        p_table_id: binding.tableId,
        p_order_id: base.activeOrderId,
        p_guest_count: base.guestCount,
      });

      if (error || !result?.success) {
        show(error || result?.detail || result?.error || (isAr ? 'تعذر تحصيل الأصناف المرسلة' : 'Could not settle sent items'), 'error');
        return false;
      }

      const extended = result as typeof result & {
        order_completed?: boolean;
        remaining_unsent_quantity?: number;
        sale_id?: string;
        invoice_number?: string;
        payments?: Array<{ payment_method: string; amount: number }>;
      };
      const confirmedInvoiceNumber = extended.invoice_number || invoiceNumber;
      const receipt = buildSettlementReceipt(preview, confirmedInvoiceNumber, paidAmountToUse, extended.payments || []);
      setSettlementReceipt(receipt);
      setSettlementReceiptSaleId(extended.sale_id || null);
      setSettlementReceiptOrderCompleted(Boolean(extended.order_completed));
      clearSettlementPreview();
      base.setCheckoutOpen(false);
      base.setPaidAmount(0);
      // The sale is durable and the receipt state is now local. Only now may
      // the next checkout allocate a fresh logical operation identity.
      saleAttemptRef.current = null;

      if (input.effSettings?.receipt_auto_print) {
        const saleId = extended.sale_id || '';
        const queued = await enqueueAutomaticReceiptPrint({
          saleId,
          receipt,
          settings: input.effSettings,
          lang,
          isAr,
        });
        if (!queued.accepted) {
          show(
            isAr
              ? `تم تحصيل الطلب ولكن تعذر إنشاء أمر طباعة الإيصال: ${queued.error || 'PRINT_QUEUE_FAILED'}`
              : `Order settled, but receipt print job could not be queued: ${queued.error || 'PRINT_QUEUE_FAILED'}`,
            'error',
          );
        }
      }

      if (extended.order_completed) {
        base.resetWorkspace();
        show(t('saleCompleted'), 'success');
      } else {
        const remainingUnsent = Number(extended.remaining_unsent_quantity ?? preview.unsent_quantity ?? 0);
        show(
          isAr
            ? `تم تحصيل جزء من الطلب فقط ولم يتم إغلاقه. ما زال هناك ${remainingUnsent} من الأصناف غير المرسلة على الطلب.`
            : `Only part of the order was settled; the order is still open with ${remainingUnsent} unsent item(s).`,
          'warning',
        );
      }
      return true;
    } finally {
      saleMutationLockRef.current = false;
      setOfflineCompleting(false);
    }
  }, [base, buildSettlementReceipt, clearSettlementPreview, input.activeShift?.id, input.branchId, input.effSettings, isAr, isCurrentSettlementPreview, lang, loadSettlementPreview, offlineCompleting, show, t]);

  const printReceipt = useCallback(async () => {
    if (!input.effSettings) return;

    if (!base.activeOrderId) {
      if (settlementReceipt) {
        const html = await buildReceiptHtml(settlementReceipt, input.effSettings, lang, isAr);
        openPrintWindow(html, APPROVED_FIXED_THERMAL_WIDTH_MM);
        return;
      }
      await base.printReceipt();
      return;
    }

    if (!base.openCheckPrintStateReady && !perms.canReprint) return;
    if (openCheckPrintLockedOrderId === base.activeOrderId && !perms.canReprint) return;

    const preview = await loadSettlementPreview(false);
    if (!preview) {
      if (settlementReceipt) {
        const html = await buildReceiptHtml(settlementReceipt, input.effSettings, lang, isAr);
        openPrintWindow(html, APPROVED_FIXED_THERMAL_WIDTH_MM);
      }
      return;
    }

    const receipt = buildSettlementReceipt(preview, base.activeOrderNumber || `ORDER-${Date.now()}`, 0);
    receipt.isOpenOrder = true;
    const text = buildReceiptThermalText(receipt, input.effSettings, lang, isAr);
    const template = buildReceiptFixedTemplate(receipt, input.effSettings, lang, isAr);
    const queued = await enqueueCloudOpenOrderPrint({
      orderId: base.activeOrderId,
      payload: {
        text,
        template,
        paperWidthMm: APPROVED_FIXED_THERMAL_WIDTH_MM,
        copies: 1,
      },
      idempotencyKey: `open-check:${base.activeOrderId}:${Date.now()}`,
    });
    if (!queued.accepted) {
      show(
        isAr
          ? `تعذر إرسال الحساب إلى محطة الكاشير: ${queued.error || 'PRINT_QUEUE_FAILED'}`
          : `Could not queue the open check to the cashier station: ${queued.error || 'PRINT_QUEUE_FAILED'}`,
        'error',
      );
      return;
    }
    setOpenCheckPrintLockedOrderId(base.activeOrderId);
    show(isAr ? 'تم إرسال الحساب إلى محطة طباعة الكاشير.' : 'Open check queued to the cashier print station.', 'success');
  }, [base, buildSettlementReceipt, input.effSettings, isAr, lang, loadSettlementPreview, openCheckPrintLockedOrderId, perms.canReprint, settlementReceipt]);

  const settlementTotals = base.checkoutOpen && base.activeOrderId && settlementPreview
    ? {
        subtotal: settlementPreview.subtotal,
        discountValue: settlementPreview.discount_amount,
        taxAmount: settlementPreview.tax_amount,
        total: settlementPreview.total,
        change: Math.max(base.paidAmount - settlementPreview.total, 0),
      }
    : {
        subtotal: base.subtotal,
        discountValue: base.discountValue,
        taxAmount: base.taxAmount,
        total: base.total,
        change: base.change,
      };

  return {
    ...base,
    ...settlementTotals,
    completing: base.completing || offlineCompleting,
    checkoutOpen: base.checkoutOpen,
    setCheckoutOpen,
    lastReceipt: settlementReceipt || base.lastReceipt,
    receiptSaleId: settlementReceiptSaleId || base.receiptSaleId,
    receiptOrderCompleted: settlementReceipt ? settlementReceiptOrderCompleted : true,
    openCheckPrintLocked: base.openCheckPrintLocked
      || (base.activeOrderId ? openCheckPrintLockedOrderId === base.activeOrderId : false),
    openCheckPrintStateReady: base.openCheckPrintStateReady,
    closeReceipt: () => {
      setSettlementReceiptSaleId(null);
      setSettlementReceiptOrderCompleted(null);
      base.closeReceipt();
    },
    transferOrderToTable,
    completeSale,
    printReceipt,
  };
}

export type UsePosOrder = ReturnType<typeof usePosOrder>;

void (null as unknown as ActiveShiftInfo | UsePosOrderInput);
