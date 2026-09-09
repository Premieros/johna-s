import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/components/Toast';
import { computePosTotals, computeLineDiscount, type PosPaymentMethod } from '@/lib/posMath';
import { logAudit } from '@/lib/audit';
import type { CartItem, Customer, DiningTable, Order, OrderItem, OrderType, Product, RpcResult, Settings } from '@/lib/types';
import { ORDER_TYPE_KEY } from '../utils/orderTypes';
import { cartLineKey, cartToItems, orderItemLineKey, orderItemsToCart } from '../utils/cart';
import { buildReceiptHtml, buildKitchenTicketHtml, openPrintWindow, ReceiptPrintApprovalError, type ReceiptData } from '../utils/printing';
import { fetchOrderForWorkspace } from '../services/posOrders';
import { sendOrderToKitchen } from '../services/kitchen';
import { processSaleForOrder, nextInvoiceNumber, fetchBranchWarehouseId } from '../services/payment';
import type { KitchenSendItem } from '../types';

export interface ActiveShiftInfo {
  id: string;
  expected: number;
  opened_at: string;
  opening_amount: number;
}

export interface UsePosOrderInput {
  branchId: string;
  branchName: string;
  orderId: string | null;
  customers: Customer[];
  effSettings: Settings | null;
  activeShift: ActiveShiftInfo | null;
  products: Product[];
  stockMap: Record<string, number>;
  onInventoryChanged?: () => void;
}

interface PersistResult {
  ok: boolean;
  orderId: string | null;
  orderNumber: string | null;
}

const EMPTY_CART: CartItem[] = [];

const VALID_PAYMENT_METHODS: PosPaymentMethod[] = ['cash', 'card', 'transfer', 'credit'];

export function usePosOrder(input: UsePosOrderInput) {
  const { branchId, branchName, orderId, customers, effSettings, activeShift, stockMap, onInventoryChanged } = input;
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const { user } = useAuth();
  const { show } = useToast();

  const [cart, setCart] = useState<CartItem[]>(EMPTY_CART);
  const [customerId, setCustomerId] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const paymentTouched = useRef(false);
  const defaultPayment = VALID_PAYMENT_METHODS.includes(effSettings?.pos_default_payment_method as PosPaymentMethod)
    ? (effSettings?.pos_default_payment_method as PosPaymentMethod)
    : 'cash';
  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>(defaultPayment);
  const setPaymentMethodSafe = useCallback((m: PosPaymentMethod) => {
    paymentTouched.current = true;
    setPaymentMethod(m);
  }, []);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [discountType, setDiscountType] = useState<'amount' | 'percent'>('amount');
  const [paidAmount, setPaidAmount] = useState(0);

  const [orderType, setOrderType] = useState<OrderType>('takeaway');
  const [tableId, setTableId] = useState<string | null>(null);
  const [guestCount, setGuestCount] = useState<number | null>(null);
  const [activeOrderId, setActiveOrderId] = useState<string | null>(orderId);
  const [activeOrderNumber, setActiveOrderNumber] = useState<string | null>(null);
  const [activeTable, setActiveTable] = useState<DiningTable | null>(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [orderLoading, setOrderLoading] = useState(false);
  const [kitchenSending, setKitchenSending] = useState(false);
  const [kitchenSentItems, setKitchenSentItems] = useState<KitchenSendItem[]>([]);
  const [lastReceipt, setLastReceipt] = useState<ReceiptData | null>(null);
  const [receiptSaleId, setReceiptSaleId] = useState<string | null>(null);

  const effCurrency = effSettings?.currency || 'EGP';

  const showReceiptPrintError = useCallback((error: unknown) => {
    if (error instanceof ReceiptPrintApprovalError && error.code === 'REPRINT_APPROVAL_PENDING') {
      show(
        isAr
          ? 'طلب إعادة الطباعة أُرسل للمدير أو ما زال قيد المراجعة. بعد الموافقة اضغط طباعة مرة أخرى.'
          : 'The reprint request was sent to the manager or is still pending. After approval, press Print again.',
        'success',
      );
      return;
    }
    show(
      error instanceof Error ? error.message : (isAr ? 'تعذر طباعة الإيصال' : 'Could not print the receipt'),
      'error',
    );
  }, [isAr, show]);

  useEffect(() => {
    if (paymentTouched.current) return;
    const dm = effSettings?.pos_default_payment_method as PosPaymentMethod;
    if (VALID_PAYMENT_METHODS.includes(dm)) setPaymentMethod(dm);
  }, [effSettings?.pos_default_payment_method]);

  useEffect(() => {
    setActiveOrderId(orderId);
    if (!orderId) {
      setActiveOrderNumber(null);
      setTableId(null);
      setGuestCount(null);
      setOrderType('takeaway');
      setCart(EMPTY_CART);
      setOrderNotes('');
      return;
    }
    let cancelled = false;
    setOrderLoading(true);
    fetchOrderForWorkspace(orderId)
      .then(({ order, items, products: orderProducts }) => {
        if (cancelled) return;
        if (!order) { setOrderLoading(false); return; }
        if (order.status !== 'open' && order.status !== 'held') {
          show(isAr ? 'لا يمكن استئناف طلب منتهي' : 'Cannot resume a completed order', 'error');
          setActiveOrderId(null);
          setActiveOrderNumber(null);
          setOrderLoading(false);
          return;
        }
        setOrderType(order.order_type as OrderType);
        setTableId(order.table_id);
        setActiveOrderId(order.id);
        setActiveOrderNumber(order.order_number);
        setGuestCount(order.guest_count);
        setOrderNotes(order.notes || '');
        if (order.table_id) {
          supabase.from('dining_tables').select('status').eq('id', order.table_id).maybeSingle().then(({ data: tbl }) => {
            if (!cancelled && tbl && (tbl as { status: string }).status === 'vacant') {
              api.floorPlan.setTableStatus({ p_table_id: order.table_id as string, p_status: 'occupied' }).catch(() => {});
            }
          });
        }
        const cartItems = orderItemsToCart(items, orderProducts);
        if (cartItems.length > 0) setCart(cartItems);
        show(t('orderResumed'), 'success');
        setOrderLoading(false);
      })
      .catch(() => { if (!cancelled) setOrderLoading(false); });
    return () => { cancelled = true; };
  }, [orderId, t, show, isAr]);

  useEffect(() => {
    if (!tableId) { setActiveTable(null); return; }
    let cancelled = false;
    supabase.from('dining_tables').select('*').eq('id', tableId).maybeSingle().then(({ data }) => {
      if (!cancelled) setActiveTable((data as DiningTable | null) || null);
    });
    return () => { cancelled = true; };
  }, [tableId]);

  const getStock = useCallback((productId: string) => stockMap[productId] || 0, [stockMap]);

  const addToCart = useCallback((
    product: Product,
    quantity = 1,
    modifiers: NonNullable<CartItem['modifiers']> = [],
    discount = 0,
    modifierOptionIds: string[] = [],
    unitPrice?: number,
    itemNote?: string,
  ) => {
    const stock = getStock(product.id);
    const totalProductQty = cart
      .filter((i) => i.product.id === product.id)
      .reduce((sum, i) => sum + i.quantity, 0);
    if (totalProductQty + quantity > stock) {
      show(`${product.name}: ${t('insufficientStock')} (${stock})`, 'error');
      return;
    }

    const incoming: CartItem = {
      product,
      unit_name: 'piece',
      quantity,
      unit_price: unitPrice ?? product.sale_price,
      discount_amount: discount,
      bonus_quantity: 0,
      modifier_option_ids: modifierOptionIds,
      modifiers,
      item_note: itemNote,
    };
    const incomingKey = cartLineKey(incoming);

    setCart((prev) => {
      const existing = prev.find((i) => cartLineKey(i) === incomingKey);
      if (existing) {
        return prev.map((i) => cartLineKey(i) === incomingKey ? { ...i, quantity: i.quantity + quantity } : i);
      }
      return [...prev, incoming];
    });
  }, [getStock, cart, show, t]);

  const updateQty = useCallback((lineKey: string, delta: number) => {
    const target = cart.find((i) => cartLineKey(i) === lineKey);
    if (!target) return;
    const stock = getStock(target.product.id);
    if (delta > 0) {
      const totalProductQty = cart
        .filter((i) => i.product.id === target.product.id)
        .reduce((sum, i) => sum + i.quantity, 0);
      if (totalProductQty + delta > stock) { show(`${t('insufficientStock')} (${stock})`, 'error'); return; }
    }
    setCart((prev) => prev
      .map((i) => cartLineKey(i) === lineKey ? { ...i, quantity: Math.max(0, i.quantity + delta) } : i)
      .filter((i) => i.quantity > 0));
  }, [getStock, cart, show, t]);

  const setQty = useCallback((lineKey: string, qty: number) => {
    const target = cart.find((i) => cartLineKey(i) === lineKey);
    if (!target) return;
    const stock = getStock(target.product.id);
    const otherQty = cart
      .filter((i) => i.product.id === target.product.id && cartLineKey(i) !== lineKey)
      .reduce((sum, i) => sum + i.quantity, 0);
    const maxForLine = Math.max(0, stock - otherQty);
    if (qty > maxForLine) { show(`${t('insufficientStock')} (${stock})`, 'error'); qty = maxForLine; }
    setCart((prev) => prev
      .map((i) => cartLineKey(i) === lineKey ? { ...i, quantity: Math.max(1, qty) } : i));
  }, [cart, getStock, show, t]);

  const removeFromCart = useCallback((lineKey: string) => setCart((prev) => prev.filter((i) => cartLineKey(i) !== lineKey)), []);
  const clearCart = useCallback(() => setCart(EMPTY_CART), []);

  const setItemDiscount = useCallback((lineKey: string, discount: number) => {
    const item = cart.find((i) => cartLineKey(i) === lineKey);
    if (!item) return;
    const lineTotal = item.quantity * item.unit_price;
    const d = computeLineDiscount(lineTotal, discount || 0);
    setCart((prev) => prev.map((i) => cartLineKey(i) === lineKey ? { ...i, discount_amount: d } : i));
  }, [cart]);

  const replaceCartLine = useCallback((lineKey: string, nextItem: CartItem) => {
    const stock = getStock(nextItem.product.id);
    const otherQty = cart
      .filter((i) => i.product.id === nextItem.product.id && cartLineKey(i) !== lineKey)
      .reduce((sum, i) => sum + i.quantity, 0);
    if (otherQty + nextItem.quantity > stock) {
      show(`${nextItem.product.name}: ${t('insufficientStock')} (${stock})`, 'error');
      return false;
    }
    setCart((prev) => {
      const withoutOld = prev.filter((i) => cartLineKey(i) !== lineKey);
      const nextKey = cartLineKey(nextItem);
      const existing = withoutOld.find((i) => cartLineKey(i) === nextKey);
      if (existing) {
        return withoutOld.map((i) => cartLineKey(i) === nextKey
          ? { ...i, quantity: i.quantity + nextItem.quantity, discount_amount: i.discount_amount + nextItem.discount_amount }
          : i);
      }
      return [...withoutOld, nextItem];
    });
    return true;
  }, [cart, getStock, show, t]);

  const taxRate = effSettings?.tax_enabled ? (effSettings?.tax_rate || 0) : 0;
  const totals = useMemo(
    () => computePosTotals({
      items: cart,
      discountType,
      discountAmount,
      taxRate,
      taxEnabled: !!effSettings?.tax_enabled,
      paidAmount,
      paymentMethod,
    }),
    [cart, discountType, discountAmount, taxRate, effSettings?.tax_enabled, paidAmount, paymentMethod]
  );
  const { subtotal, discountValue, taxAmount, total, change } = totals;

  const switchOrderType = useCallback(async (ot: OrderType) => {
    if (ot === orderType) return;
    if (activeOrderNumber) {
      show(isAr ? `لا يمكن تغيير نوع طلب نشط (${activeOrderNumber})` : `Cannot change order type of active order (${activeOrderNumber})`, 'error');
      return;
    }
    if (ot === 'dine_in' && !tableId && !activeTable) {
      show(isAr ? 'اختر طاولة أولاً لطلب داخل الصالة' : 'Select a table first for dine-in orders', 'error');
      return;
    }
    if (activeTable && ot !== 'dine_in') {
      const ok = window.confirm(isAr
        ? `التبديل إلى ${t(ORDER_TYPE_KEY[ot])} سيفصل الطاولة ${activeTable.name} ويحررها. متابعة؟`
        : `Switching to ${t(ORDER_TYPE_KEY[ot])} will detach and free table ${activeTable.name}. Continue?`);
      if (!ok) return;
      const res = await api.floorPlan.setTableStatus({ p_table_id: tableId || activeTable.id, p_status: 'vacant' });
      if (res.error || !(res.data as RpcResult | null)?.success) {
        const r = res.data as RpcResult | null;
        show(r?.detail || r?.error || res.error?.message || t('error'), 'error');
        return;
      }
      setTableId(null);
      setActiveTable(null);
    }
    setOrderType(ot);
  }, [orderType, activeOrderNumber, tableId, activeTable, show, t, isAr]);

  const performDetach = useCallback(async () => {
    if (activeOrderId) {
      const res = await api.floorPlan.detachOrder({ p_order_id: activeOrderId });
      if (res.error || !(res.data as RpcResult | null)?.success) {
        const r = res.data as RpcResult | null;
        show(r?.detail || r?.error || res.error?.message || t('error'), 'error');
        return;
      }
    } else if (tableId) {
      const res = await api.floorPlan.setTableStatus({ p_table_id: tableId, p_status: 'vacant' });
      if (res.error || !(res.data as RpcResult | null)?.success) {
        const r = res.data as RpcResult | null;
        show(r?.detail || r?.error || res.error?.message || t('error'), 'error');
        return;
      }
    }
    setActiveOrderId(null);
    setActiveOrderNumber(null);
    setTableId(null);
    setActiveTable(null);
    setGuestCount(null);
  }, [activeOrderId, tableId, show, t]);

  const detachTable = useCallback(async () => {
    if (!activeTable) return;
    const ok = window.confirm(isAr
      ? `فصل الطلب عن الطاولة ${activeTable.name}؟ سيتم تحرير الطاولة.`
      : `Detach order from table ${activeTable.name}? The table will be freed.`);
    if (!ok) return;
    await performDetach();
  }, [activeTable, isAr, performDetach]);

  const detachOrder = useCallback(async () => {
    const ok = window.confirm(isAr ? 'فصل الطلب الحالي؟' : 'Detach the current order?');
    if (!ok) return;
    await performDetach();
  }, [isAr, performDetach]);

  const resumeTableOrder = useCallback((order: Order, items: OrderItem[], orderProducts: Product[], table: DiningTable) => {
    setActiveOrderId(order.id);
    setActiveOrderNumber(order.order_number);
    setOrderType(order.order_type as OrderType);
    setTableId(table.id);
    setActiveTable(table);
    setGuestCount(order.guest_count || null);
    setOrderNotes(order.notes || '');
    setCustomerId(order.customer_id || '');
    const cartItems = orderItemsToCart(items, orderProducts);
    setCart(cartItems);
  }, []);

  const startTableOrder = useCallback((table: DiningTable, guests = 2) => {
    setCart(EMPTY_CART);
    setActiveOrderId(null);
    setActiveOrderNumber(null);
    setOrderType('dine_in');
    setTableId(table.id);
    setActiveTable(table);
    setGuestCount(guests || table.capacity || 2);
    setOrderNotes('');
    setDiscountAmount(0);
    setPaidAmount(0);
  }, []);

  const transferOrderToTable = useCallback(async (targetOrderId: string, fromTableId: string, toTableId: string): Promise<boolean> => {
    try {
      const { error: ordErr } = await supabase
        .from('orders')
        .update({ table_id: toTableId, updated_at: new Date().toISOString() })
        .eq('id', targetOrderId);

      if (ordErr) {
        show(ordErr.message, 'error');
        return false;
      }

      await supabase
        .from('dining_tables')
        .update({ status: 'vacant', updated_at: new Date().toISOString() })
        .eq('id', fromTableId);

      await supabase
        .from('dining_tables')
        .update({ status: 'occupied', updated_at: new Date().toISOString() })
        .eq('id', toTableId);

      const { data: newTable } = await supabase
        .from('dining_tables')
        .select('*')
        .eq('id', toTableId)
        .maybeSingle();

      if (activeOrderId === targetOrderId) {
        setTableId(toTableId);
        setActiveTable((newTable as DiningTable) || null);
      }

      show(isAr ? 'تم تحويل الطلب إلى الطاولة الجديدة بنجاح' : 'Order transferred successfully', 'success');
      return true;
    } catch (err) {
      show(err instanceof Error ? err.message : 'Transfer failed', 'error');
      return false;
    }
  }, [activeOrderId, isAr, show]);

  const transferOrderItemToTable = useCallback(async (lineKey: string, targetTableId: string): Promise<boolean> => {
    if (!activeOrderId || !activeTable) return false;
    const item = cart.find((entry) => cartLineKey(entry) === lineKey);
    if (!item) return false;

    try {
      const { data: orderRows, error: orderRowsError } = await supabase
        .from('order_items')
        .select('id,product_id,modifier_option_ids,notes')
        .eq('order_id', activeOrderId)
        .eq('product_id', item.product.id);
      if (orderRowsError) {
        show(orderRowsError.message, 'error');
        return false;
      }

      const matches = ((orderRows || []) as Pick<OrderItem, 'id' | 'product_id' | 'modifier_option_ids' | 'notes'>[])
        .filter((row) => orderItemLineKey(row) === lineKey);
      if (matches.length !== 1) {
        show(
          isAr
            ? 'تعذر تحديد سطر الصنف بدقة. حدّث الطلب وحاول مرة أخرى.'
            : 'Could not identify the exact order line. Refresh and try again.',
          'error',
        );
        return false;
      }

      const { data, error } = await api.pos.transferOrderItemToTable({
        p_order_id: activeOrderId,
        p_order_item_id: matches[0].id,
        p_target_table_id: targetTableId,
      });
      if (error) {
        show(error.message, 'error');
        return false;
      }

      const result = data as (RpcResult & { source_order_empty?: boolean }) | null;
      if (!result?.success) {
        const message = result?.error === 'ITEM_ALREADY_SENT'
          ? (isAr ? 'لا يمكن نقل صنف تم إرساله للمطبخ.' : 'A line already sent to kitchen cannot be moved.')
          : result?.detail || result?.error || t('error');
        show(message, 'error');
        return false;
      }

      setCart((prev) => prev.filter((entry) => cartLineKey(entry) !== lineKey));
      if (result.source_order_empty) {
        setActiveOrderId(null);
        setActiveOrderNumber(null);
        setTableId(null);
        setActiveTable(null);
        setGuestCount(null);
      }

      show(
        isAr ? `تم نقل ${item.product.name} إلى الطاولة الأخرى` : `${item.product.name} moved to the other table`,
        'success',
      );
      return true;
    } catch (err) {
      show(err instanceof Error ? err.message : (isAr ? 'تعذر نقل الصنف' : 'Could not move item'), 'error');
      return false;
    }
  }, [activeOrderId, activeTable, cart, isAr, show, t]);

  const voidSentItem = useCallback(async (lineKey: string, voidQuantity: number, reason: string): Promise<boolean> => {
    if (!activeOrderId) return false;
    try {
      const item = cart.find((i) => cartLineKey(i) === lineKey);
      if (!item) return false;
      const productId = item.product.id;

      const { data: orderRows, error: orderRowsError } = await supabase
        .from('order_items')
        .select('id,product_id,modifier_option_ids,notes')
        .eq('order_id', activeOrderId)
        .eq('product_id', productId);
      if (orderRowsError) {
        show(orderRowsError.message, 'error');
        return false;
      }
      const matchingOrderItems = ((orderRows || []) as Pick<OrderItem, 'id' | 'product_id' | 'modifier_option_ids' | 'notes'>[])
        .filter((orderItem) => orderItemLineKey(orderItem) === lineKey);
      if (matchingOrderItems.length !== 1) {
        show(
          isAr
            ? 'تعذر تحديد سطر الطلب المرسل بدقة. حدّث الطلب وحاول مرة أخرى.'
            : 'Could not identify the exact sent order line. Refresh the order and try again.',
          'error'
        );
        return false;
      }
      const orderItemId = matchingOrderItems[0].id;

      const { data, error } = await supabase.rpc('cancel_sent_order_item_exact', {
        p_order_id: activeOrderId,
        p_order_item_id: orderItemId,
        p_quantity: voidQuantity,
        p_reason: reason,
      });

      if (error) {
        show(error.message, 'error');
        return false;
      }

      const result = (data ?? {}) as RpcResult & {
        remaining_quantity?: number;
        voided_quantity?: number;
        inventory_changed?: boolean;
        request_id?: string;
        status?: string;
        action?: string;
      };

      if (!result.success) {
        if (result.error === 'MANAGER_APPROVAL_REQUIRED') {
          show(
            isAr
              ? 'تم إرسال طلب إلغاء الصنف للمدير. بعد الموافقة أعد تنفيذ الإلغاء.'
              : 'Manager approval request sent. Retry the void after approval.',
            'success'
          );
          return false;
        }
        show(result.detail || result.error || (isAr ? 'تعذر إلغاء الصنف' : 'Failed to void item'), 'error');
        return false;
      }

      const remaining = Number(result.remaining_quantity ?? Math.max(0, item.quantity - voidQuantity));
      setCart((prev) =>
        remaining <= 0
          ? prev.filter((i) => cartLineKey(i) !== lineKey)
          : prev.map((i) => cartLineKey(i) === lineKey ? { ...i, quantity: remaining } : i)
      );

      setKitchenSentItems((prev) =>
        prev
          .map((i) => {
            if (i.order_item_id !== orderItemId) return i;
            const qty = Number(i.quantity || 0) - voidQuantity;
            return { ...i, quantity: Math.max(0, qty) };
          })
          .filter((i) => Number(i.quantity || 0) > 0)
      );

      const cancelNote = `[إلغاء مطبخ: ${voidQuantity} × ${item.product.name} - السبب: ${reason}]`;
      setOrderNotes((prev) => (prev ? `${prev}\n${cancelNote}` : cancelNote));

      if (result.inventory_changed) onInventoryChanged?.();

      show(
        isAr
          ? `تم إلغاء الصنف (${item.product.name}) وإرجاع كميته المخصومة للمخزون`
          : `Item voided and its deducted quantity was restored to inventory`,
        'success'
      );
      return true;
    } catch (err) {
      show(err instanceof Error ? err.message : 'Failed to void item', 'error');
      return false;
    }
  }, [activeOrderId, cart, isAr, onInventoryChanged, show]);

  const persistCart = useCallback(async (status: 'open' | 'held'): Promise<PersistResult> => {
    if (!branchId) { show(t('selectBranchFirst'), 'error'); return { ok: false, orderId: null, orderNumber: null }; }
    const itemRows = cartToItems(cart);
    const targetTable = orderType === 'dine_in' ? tableId : null;

    if (activeOrderId) {
      const { data, error } = await api.floorPlan.updateOrder({
        p_order_id: activeOrderId,
        p_order_type: orderType,
        p_table_id: targetTable,
        p_customer_id: customerId || null,
        p_guest_count: guestCount,
        p_notes: orderNotes || null,
        p_items: itemRows,
        p_subtotal: subtotal,
        p_discount_amount: discountValue,
        p_discount_type: discountType === 'percent' ? 'percent' : 'amount',
        p_tax_amount: taxAmount,
        p_total: total,
        p_status: status,
      });
      if (error) { show(error.message, 'error'); return { ok: false, orderId: null, orderNumber: null }; }
      const r = data as RpcResult | null;
      if (!r?.success) { show(r?.detail || r?.error || t('error'), 'error'); return { ok: false, orderId: null, orderNumber: null }; }
      return { ok: true, orderId: activeOrderId, orderNumber: activeOrderNumber };
    }

    const { data, error } = await api.floorPlan.createOrder({
      p_branch_id: branchId,
      p_order_type: orderType,
      p_table_id: targetTable,
      p_customer_id: customerId || null,
      p_guest_count: guestCount,
      p_notes: orderNotes || null,
      p_items: itemRows,
      p_subtotal: subtotal,
      p_discount_amount: discountValue,
      p_discount_type: discountType === 'percent' ? 'percent' : 'amount',
      p_tax_amount: taxAmount,
      p_total: total,
      p_cashier_id: user?.id || null,
    });
    if (error) { show(error.message, 'error'); return { ok: false, orderId: null, orderNumber: null }; }
    const r = data as RpcResult | null;
    if (!r?.success) { show(r?.detail || r?.error || t('error'), 'error'); return { ok: false, orderId: null, orderNumber: null }; }
    return { ok: true, orderId: r.order_id || null, orderNumber: (r as RpcResult & { order_number?: string }).order_number || null };
  }, [branchId, activeOrderId, activeOrderNumber, orderType, tableId, customerId, guestCount, orderNotes, cart, subtotal, discountValue, discountType, taxAmount, total, user?.id, show, t]);

  const holdOrder = useCallback(async (): Promise<boolean> => {
    if (cart.length === 0 || completing || orderLoading) return false;
    if (!branchId) { show(t('selectBranchFirst'), 'error'); return false; }
    if (orderType === 'dine_in' && !tableId) {
      show(isAr ? 'اختر طاولة لطلب داخل الصالة' : 'Select a table for dine-in orders', 'error');
      return false;
    }
    setCompleting(true);
    try {
      if (activeOrderId) {
        const { ok } = await persistCart('held');
        if (!ok) return false;
      } else {
        const { ok, orderId: newId, orderNumber: newNum } = await persistCart('open');
        if (!ok) return false;
        if (newId) {
          const heldRes = await api.floorPlan.setOrderStatus({ p_order_id: newId, p_status: 'held' });
          if (heldRes.error || !(heldRes.data as RpcResult | null)?.success) {
            show(t('orderHeld') + ': ' + (heldRes.error?.message || (heldRes.data as RpcResult | null)?.detail || (heldRes.data as RpcResult | null)?.error || ''), 'error');
            setActiveOrderId(newId);
            setActiveOrderNumber(newNum);
            return false;
          }
        }
      }
      show(t('orderHeld'), 'success');
      return true;
    } finally {
      setCompleting(false);
    }
  }, [cart.length, completing, orderLoading, branchId, orderType, tableId, activeOrderId, persistCart, show, t, isAr]);

  const sendToKitchen = useCallback(async (): Promise<boolean> => {
    if (cart.length === 0 || completing || orderLoading || kitchenSending) return false;
    if (!branchId) { show(t('selectBranchFirst'), 'error'); return false; }
    if (orderType === 'dine_in' && !tableId) {
      show(isAr ? 'اختر طاولة لطلب داخل الصالة' : 'Select a table for dine-in orders', 'error');
      return false;
    }
    setKitchenSending(true);
    try {
      const { ok, orderId: targetOrderId, orderNumber: targetOrderNumber } = await persistCart('open');
      if (!ok || !targetOrderId) return false;

      const res = await sendOrderToKitchen({ p_order_id: targetOrderId, p_sent_by: null });
      if (!res.success) {
        show(res.detail || res.error || t('error'), 'error');
        return false;
      }
      setActiveOrderId(targetOrderId);
      if (targetOrderNumber) setActiveOrderNumber(targetOrderNumber);
      setKitchenSentItems(res.sent || []);
      const sentCount = res.items_sent_count || 0;
      if (sentCount > 0) {
        onInventoryChanged?.();
        show(`${t('sendToKitchen')} (${sentCount})`, 'success');
        if (effSettings) {
          const html = buildKitchenTicketHtml({
            orderNumber: targetOrderNumber || activeOrderNumber,
            tableName: activeTable?.name || null,
            orderTypeLabel: t(ORDER_TYPE_KEY[orderType]),
            guestCount,
            items: (res.sent || []).map((i) => ({ name: i.product_name || '—', qty: Number(i.quantity), unit_name: i.unit_name })),
            s: effSettings,
            isAr,
          });
          openPrintWindow(html, effSettings.receipt_width_mm || 80);
        }
      } else {
        show(isAr ? 'تم إرسال جميع الأصناف مسبقاً' : 'All items already sent to kitchen', 'success');
      }
      return true;
    } finally {
      setKitchenSending(false);
    }
  }, [cart.length, completing, orderLoading, kitchenSending, branchId, orderType, tableId, activeOrderNumber, persistCart, effSettings, activeTable, guestCount, t, isAr, onInventoryChanged, show]);

  const printKitchenTicket = useCallback(() => {
    if (cart.length === 0 || !effSettings) return;
    const html = buildKitchenTicketHtml({
      orderNumber: activeOrderNumber,
      tableName: activeTable?.name || null,
      orderTypeLabel: t(ORDER_TYPE_KEY[orderType]),
      guestCount,
      items: cart.map((i) => ({ name: i.product.name, qty: i.quantity, unit_name: i.unit_name })),
      s: effSettings,
      isAr,
    });
    openPrintWindow(html, effSettings.receipt_width_mm || 80);
  }, [cart, effSettings, activeOrderNumber, activeTable, orderType, guestCount, t, isAr]);

  const completeSale = useCallback(async (): Promise<boolean> => {
    if (cart.length === 0 || completing) return false;
    if (!branchId) { show(t('selectBranchFirst'), 'error'); return false; }
    if (!activeShift) { show(t('shiftRequired'), 'error'); return false; }
    if (orderType === 'dine_in' && !tableId) {
      show(isAr ? 'اختر طاولة لطلب داخل الصالة' : 'Select a table for dine-in orders', 'error');
      return false;
    }
    setCompleting(true);
    try {
      // A linked order has already crossed the authoritative kitchen boundary.
      // The server verifies that every delta was sent and reuses those effects.
      // Only a direct, unpersisted sale still needs the pre-deduction client check.
      if (!activeOrderId) {
        for (const item of cart) {
          const stock = getStock(item.product.id);
          if (stock < item.quantity) { show(`${item.product.name}: ${t('insufficientStock')} (${stock})`, 'error'); return false; }
        }
      }

      const warehouseId = await fetchBranchWarehouseId(branchId, activeOrderId);
      const invoiceNumber = (await nextInvoiceNumber()) || `INV-${Date.now()}`;
      const itemsPayload = cartToItems(cart);
      const paidAmountToUse = paymentMethod === 'credit' ? 0 : paidAmount || total;

      const { result, error: saleError } = await processSaleForOrder({
        p_invoice_number: invoiceNumber,
        p_branch_id: branchId,
        p_shift_id: activeShift?.id || null,
        p_warehouse_id: warehouseId,
        p_customer_id: customerId || null,
        p_salesperson_id: null,
        p_subtotal: subtotal,
        p_discount_amount: discountValue,
        p_discount_type: discountType === 'percent' ? 'percent' : 'amount',
        p_tax_amount: taxAmount,
        p_bonus_amount: 0,
        p_total: total,
        p_paid_amount: paidAmountToUse,
        p_payment_method: paymentMethod,
        p_status: 'completed',
        p_items: itemsPayload,
        p_order_type: orderType,
        p_table_id: orderType === 'dine_in' ? tableId : null,
        p_order_id: activeOrderId,
        p_guest_count: guestCount,
      });
      if (saleError) { show(saleError, 'error'); return false; }
      if (!result?.success) { show(result?.detail || result?.error || t('error'), 'error'); return false; }
      const saleId = result.sale_id || '';

      await logAudit('create', 'sales', saleId, { invoice: invoiceNumber, total });

      const receiptPayload: ReceiptData = {
        invoice: invoiceNumber,
        branchName,
        items: cart.map((i) => ({ name: [i.product.name, i.modifiers?.map((m) => m.name).join(' · ')].filter(Boolean).join(' — '), qty: i.quantity, price: i.unit_price, total: i.quantity * i.unit_price - i.discount_amount })),
        subtotal, discount: discountValue, tax: taxAmount, total,
        paid: paidAmountToUse, change, date: new Date().toISOString(),
        customerName: customers.find((c) => c.id === customerId)?.name || '',
        orderNumber: activeOrderNumber || undefined,
        tableName: activeTable?.name || undefined,
        orderTypeLabel: t(ORDER_TYPE_KEY[orderType]),
        guestCount: guestCount || undefined,
      };
      setLastReceipt(receiptPayload);
      setReceiptSaleId(saleId);
      setCheckoutOpen(false);
      setCart(EMPTY_CART);
      setDiscountAmount(0);
      setPaidAmount(0);
      setCustomerId('');
      setOrderNotes('');
      setActiveOrderId(null);
      setActiveOrderNumber(null);
      setTableId(null);
      setActiveTable(null);
      setGuestCount(null);
      show(t('saleCompleted'), 'success');

      if (effSettings?.receipt_auto_print) {
        try {
          const html = await buildReceiptHtml(receiptPayload, effSettings, lang, isAr);
          openPrintWindow(html, effSettings.receipt_width_mm || 80);
        } catch (error) {
          showReceiptPrintError(error);
        }
      }
      return true;
    } finally {
      setCompleting(false);
    }
  }, [cart, completing, branchId, branchName, activeShift, orderType, tableId, getStock, paymentMethod, total, paidAmount, customerId, subtotal, discountValue, discountType, taxAmount, change, activeOrderId, activeOrderNumber, guestCount, customers, activeTable, effSettings, lang, isAr, show, showReceiptPrintError, t]);

  const printReceipt = useCallback(async () => {
    if (!lastReceipt || !effSettings) return;
    try {
      const html = await buildReceiptHtml(lastReceipt, effSettings, lang, isAr);
      openPrintWindow(html, effSettings.receipt_width_mm || 80);
    } catch (error) {
      showReceiptPrintError(error);
    }
  }, [lastReceipt, effSettings, lang, isAr, showReceiptPrintError]);

  const closeReceipt = useCallback(() => setReceiptSaleId(null), []);

  const resetWorkspace = useCallback(() => {
    setCart(EMPTY_CART);
    setCustomerId('');
    setOrderNotes('');
    setDiscountAmount(0);
    setPaidAmount(0);
    setOrderType('takeaway');
    setTableId(null);
    setGuestCount(null);
    setActiveOrderId(null);
    setActiveOrderNumber(null);
    setActiveTable(null);
    setCheckoutOpen(false);
  }, []);

  return {
    cart,
    customerId, setCustomerId,
    orderNotes, setOrderNotes,
    paymentMethod, setPaymentMethod: setPaymentMethodSafe,
    discountAmount, setDiscountAmount,
    discountType, setDiscountType,
    paidAmount, setPaidAmount,
    orderType, setOrderType,
    tableId, setTableId,
    guestCount, setGuestCount,
    activeOrderId, activeOrderNumber, activeTable,
    checkoutOpen, setCheckoutOpen,
    completing, orderLoading, kitchenSending, kitchenSentItems,
    lastReceipt, receiptSaleId, closeReceipt,
    subtotal, discountValue, taxAmount, total, change,
    effCurrency,
    addToCart, updateQty, setQty, removeFromCart, clearCart, setItemDiscount, replaceCartLine,
    switchOrderType, holdOrder, sendToKitchen, printKitchenTicket, completeSale, printReceipt,
    detachTable, detachOrder, resetWorkspace,
    resumeTableOrder, startTableOrder, transferOrderToTable, transferOrderItemToTable, voidSentItem,
  };
}

export type UsePosOrder = ReturnType<typeof usePosOrder>;
