import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ShoppingCart, Printer, Barcode as BarcodeIcon, Grid2X2, ListOrdered, Utensils } from 'lucide-react';
import { useNavigate, useLocation, useParams } from 'react-router-dom';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { userFacingErrorMessage } from '@/lib/userFacingError';
import { useActiveBranchId } from '@/lib/activeBranch';
import { useOffline } from '@/context/OfflineContext';
import { offlinePosManager } from '../services/offlinePos';
import { Modal } from '@/components/Modal';
import { Logo } from '@/components/Logo';
import { formatCurrency } from '@/lib/format';
import { mergeEffectiveSettings, useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { useToast } from '@/components/Toast';
import { useOperationalGuard, PrerequisiteAlertBanner, PREREQUISITE_STEPS } from '@/core/guard';
import type { Product, Customer, Settings, Branch, Category, RpcResult, Order, CartItem, DiningArea, DiningTable } from '@/lib/types';
import { usePosOrder } from '../hooks/usePosOrder';
import { useActiveOrders } from '../hooks/useActiveOrders';
import { usePosPermissions } from '../hooks/usePosPermissions';
import { usePosKeyboard } from '../hooks/usePosKeyboard';
import { cartLineKey, orderItemLineKey } from '../utils/cart';
import { OrderStartWizard, type StartStep, type StartOrderOptions } from '../components/start/OrderStartWizard';
import { ProductBrowser } from '../components/catalog/ProductBrowser';
import { ProductConfigModal } from '../components/catalog/ProductConfigModal';
import { CustomerQuickModal } from '../components/customers/CustomerQuickModal';
import { TableSelectModal } from '../components/tables/TableSelectModal';
import { ShiftModal } from '../components/shift/ShiftModal';
import { PosTopBar, type PosPanelId } from '../components/topbar/PosTopBar';
import { ActiveOrdersDrawer, type ActiveCategory } from '../components/orders/ActiveOrdersDrawer';
import { TablesPanel } from '../components/tables/TablesPanel';
import { KitchenPanel } from '../components/kitchen/KitchenPanel';
import { CurrentOrderPanel } from '../components/order/CurrentOrderPanel';
import { PaymentPanel } from '../components/checkout/PaymentPanel';
import { PosTablesSidebar } from '../components/tables/PosTablesSidebar';
import { PosOrderHeaderBar } from '../components/order/PosOrderHeaderBar';
import { TransferOrderModal } from '../components/tables/TransferOrderModal';
import { orderOperatorName } from '../utils/operatorName';
import { VoidItemModal } from '../components/order/VoidItemModal';

const EMPTY_POS_STOCK_MAP: Record<string, number> = {};

interface WorkspaceState {
  tableId?: string | null;
  branchId?: string | null;
  guestCount?: number | null;
  pay?: number | null;
  startStep?: StartStep | null;
}

export function PosWorkspacePage() {
  const { orderId: orderIdParam } = useParams<{ orderId?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const { user } = useAuth();
  const branchFilter = useBranchFilter();
  const [, setActiveBranchId] = useActiveBranchId();
  const { settings: sharedSettings, branchSettingsMap } = useSettings();
  const { branches: sharedBranches } = useBranches();
  const { show } = useToast();
  const perms = usePosPermissions();
  const {
    guardPos,
    startGuidance,
  } = useOperationalGuard();

  const initState = useMemo<WorkspaceState>(() => (location.state || {}) as WorkspaceState, [location.state]);
  const { cachePosData, loadCachedPosData } = useOffline();
  const [reloadKey, setReloadKey] = useState(0);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [offlineSettings, setOfflineSettings] = useState<Settings | null>(null);
  const [offlineBranches, setOfflineBranches] = useState<Branch[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [diningAreas, setDiningAreas] = useState<DiningArea[]>([]);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [discountShortcutToken, setDiscountShortcutToken] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [loadWarning, setLoadWarning] = useState('');
  const [activeShift, setActiveShift] = useState<{ id: string; expected: number; opened_at: string; opening_amount: number } | null>(null);
  const [shiftChecked, setShiftChecked] = useState(false);
  const [panel, setPanel] = useState<PosPanelId>(null);
  const [ordersCategory, setOrdersCategory] = useState<ActiveCategory>('all');
  const [mobileOrderOpen, setMobileOrderOpen] = useState(false);
  const [startStep, setStartStep] = useState<StartStep | null>(initState.startStep ?? null);
  const [preselectedTableId, setPreselectedTableId] = useState<string | null>(initState.tableId || null);

  // Quick Modals State
  const [configProduct, setConfigProduct] = useState<Product | null>(null);
  const [configItem, setConfigItem] = useState<CartItem | null>(null);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [tableModalOpen, setTableModalOpen] = useState(false);
  const [shiftModalOpen, setShiftModalOpen] = useState(false);
  const [tablesCollapsed, setTablesCollapsed] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [transferOrder, setTransferOrder] = useState<Order | null>(null);
  const [transferSourceTable, setTransferSourceTable] = useState<DiningTable | null>(null);
  const [voidModalOpen, setVoidModalOpen] = useState(false);
  const [voidItem, setVoidItem] = useState<CartItem | null>(null);
  const [voidSentQty, setVoidSentQty] = useState(1);

  const barcodeRef = useRef<HTMLInputElement>(null);
  const payConsumed = useRef(false);
  const effectiveBranch = branchFilter || user?.branch_id || '';
  const settings = sharedSettings || offlineSettings;
  const branches = sharedBranches.length > 0 ? sharedBranches : offlineBranches;
  const effSettings: Settings | null = settings ? mergeEffectiveSettings(settings, effectiveBranch ? branchSettingsMap[effectiveBranch] : null) : null;

  const reloadShift = useCallback(() => {
    if (!effectiveBranch) {
      setShiftChecked(true);
      setActiveShift(null);
      return;
    }
    setShiftChecked(false);
    void api.pos.getActiveShift({ p_branch_id: effectiveBranch })
      .then(({ data }) => {
        const res = data as unknown as { open?: boolean; shift?: { id: string; expected: number; opened_at: string; opening_amount: number } } | null;
        setActiveShift(res?.open ? (res.shift ?? null) : null);
      })
      .catch(() => setActiveShift(null))
      .finally(() => setShiftChecked(true));
  }, [effectiveBranch]);

  useEffect(() => {
    reloadShift();
  }, [reloadShift]);

  // POS catalog is intentionally stock-agnostic. Kitchen send is the
  // authoritative inventory deduction point and may drive raw stock negative.
  // Do not preflight product/recipe stock from the workspace.
  const currentBranchName = branches.find((b) => b.id === effectiveBranch)?.name || effectiveBranch;

  const pos = usePosOrder({
    branchId: effectiveBranch,
    branchName: currentBranchName,
    orderId: orderIdParam || null,
    customers,
    effSettings,
    activeShift,
    products,
    stockMap: EMPTY_POS_STOCK_MAP,
  });
  const canModifyCurrentOrder = pos.activeOrderId ? perms.canEditOrder : perms.canCreateOrder;

  useEffect(() => {
    if (pos.receiptSaleId) setMobileOrderOpen(false);
  }, [pos.receiptSaleId]);

  const live = useActiveOrders(effectiveBranch);

  useEffect(() => {
    if (!effSettings?.pos_barcode_autofocus) return;
    if (panel || pos.checkoutOpen || mobileOrderOpen || configProduct || configItem || customerModalOpen || tableModalOpen || shiftModalOpen) return;
    const timer = setTimeout(() => barcodeRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [effSettings?.pos_barcode_autofocus, panel, pos.checkoutOpen, mobileOrderOpen, configProduct, configItem, customerModalOpen, tableModalOpen, shiftModalOpen]);

  const { orders, tables, counts, ordersByTable, itemsByOrder, kitchenSendsByOrder, sentOrderItemIds, tableById } = live;
  const customerById = useMemo(() => Object.fromEntries(customers.map((c) => [c.id, c])), [customers]);
  const productNames = useMemo(() => Object.fromEntries(products.map((p) => [p.id, isAr ? p.name : p.name_en || p.name])), [products, isAr]);
  const kitchenOrders = useMemo(() => orders.filter((o) => (kitchenSendsByOrder[o.id]?.length || 0) > 0).length, [orders, kitchenSendsByOrder]);
  const activeOrderCreatedAt = useMemo(() => orders.find((o) => o.id === pos.activeOrderId)?.created_at || null, [orders, pos.activeOrderId]);
  const activeOrderOperatorName = useMemo(() => {
    if (!pos.activeOrderId) return user?.full_name || user?.username || user?.email || null;
    const activeOrder = orders.find((order) => order.id === pos.activeOrderId);
    return activeOrder ? orderOperatorName(activeOrder) : null;
  }, [orders, pos.activeOrderId, user]);
  const orderItemsForActive = useMemo(() => (pos.activeOrderId ? itemsByOrder[pos.activeOrderId] || [] : []), [pos.activeOrderId, itemsByOrder]);
  const kitchenSendsForActive = useMemo(() => {
    const realtime = pos.activeOrderId ? kitchenSendsByOrder[pos.activeOrderId] || [] : [];
    if (realtime.length > 0 || !pos.activeOrderId || pos.kitchenSentItems.length === 0) return realtime;

    // A successful send_to_kitchen RPC is already server-confirmed. Keep a
    // session-local fallback until Realtime delivers the same rows so Pay/Print
    // become available immediately after the first successful kitchen send.
    return pos.kitchenSentItems.map((item, index) => ({
      id: item.send_id || `session-send-${index}`,
      branch_id: effectiveBranch,
      order_id: pos.activeOrderId as string,
      order_item_id: item.order_item_id || `session-order-item-${index}`,
      sent_at: new Date().toISOString(),
      sent_by: user?.id || null,
      sent_quantity: Number(item.quantity || 0),
    }));
  }, [pos.activeOrderId, pos.kitchenSentItems, kitchenSendsByOrder, effectiveBranch, user?.id]);

  const hasUnsentItems = useMemo(() => {
    if (pos.cart.length === 0) return false;
    return pos.cart.some((cItem) => {
      const lineKey = cartLineKey(cItem);
      const orderItem = orderItemsForActive.find((oi) => orderItemLineKey(oi) === lineKey);
      if (!orderItem) return true;
      const send = kitchenSendsForActive.find((row) => row.order_item_id === orderItem.id);
      return Number(send?.sent_quantity || 0) < cItem.quantity;
    });
  }, [pos.cart, kitchenSendsByOrder, orderItemsForActive]);

  const handlePay = useCallback(() => {
    if (!perms.canPay || !shiftChecked || pos.cart.length === 0) return;
    const allowed = guardPos({
      productsCount: products.length,
      activeShiftId: activeShift?.id || null,
      formData: { cart: pos.cart, orderType: pos.orderType },
    });
    if (!allowed) return;
    pos.setPaymentMethod('cash');
    pos.setPaidAmount(pos.total);
    pos.setCheckoutOpen(true);
    setMobileOrderOpen(true);
  }, [perms.canPay, shiftChecked, pos, guardPos, products.length, activeShift?.id]);

  // Keyboard Shortcuts Hook
  usePosKeyboard({
    onFocusSearch: () => barcodeRef.current?.focus(),
    onHoldOrder: () => {
      if (perms.canHoldOrder && pos.cart.length > 0 && !pos.orderLoading) void pos.holdOrder();
    },
    onTriggerDiscount: () => {
      if (perms.canDiscount && pos.cart.length > 0) {
        setDiscountShortcutToken((value) => value + 1);
        setMobileOrderOpen(true);
      }
    },
    onProceedToPay: handlePay,
    onPrintReceipt: () => {
      if (perms.canPrint && pos.lastReceipt && pos.cart.length === 0) void pos.printReceipt();
    },
    onEscape: () => {
      if (configProduct) setConfigProduct(null);
      else if (configItem) setConfigItem(null);
      else if (customerModalOpen) setCustomerModalOpen(false);
      else if (tableModalOpen) setTableModalOpen(false);
      else if (shiftModalOpen) setShiftModalOpen(false);
      else if (panel) setPanel(null);
      else if (pos.checkoutOpen) pos.setCheckoutOpen(false);
      else if (mobileOrderOpen) setMobileOrderOpen(false);
    },
    enabled: true,
  });

  const {
    checkoutOpen,
    orderLoading,
    activeOrderId,
    cart,
  } = pos;

  useEffect(() => {
    if (orderIdParam) {
      setStartStep(null);
      return;
    }
    if (initState.tableId) {
      setPreselectedTableId(initState.tableId);
      setStartStep('table');
    } else if (initState.startStep) {
      setPreselectedTableId(null);
      setStartStep(initState.startStep);
    } else setStartStep(null);
  }, [orderIdParam, initState.tableId, initState.startStep]);

  useEffect(() => {
    payConsumed.current = false;
  }, [orderIdParam, initState.pay]);

  useEffect(() => {
    if (!perms.canPay || payConsumed.current || !initState.pay || !shiftChecked || checkoutOpen || orderLoading || !activeOrderId || cart.length === 0) return;
    payConsumed.current = true;
    handlePay();
  }, [perms.canPay, initState.pay, shiftChecked, checkoutOpen, orderLoading, activeOrderId, cart.length, handlePay]);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      setLoading(true);
      setLoadError('');
      setLoadWarning('');
      try {
        const fixedBranch = effectiveBranch;
        
        // If navigator is offline, immediately try offline cache first
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          const offlineData = await loadCachedPosData(fixedBranch || undefined);
          const catalogFallback = offlinePosManager.getCatalogCache(fixedBranch || 'default');

          const prodList = offlineData.products.length > 0 ? offlineData.products : catalogFallback?.products || [];
          const catList = offlineData.categories.length > 0 ? offlineData.categories : catalogFallback?.categories || [];

          if (prodList.length > 0) {
            if (!cancelled) {
              setProducts(prodList);
              setCategories(catList);
              if (offlineData.customers.length > 0) setCustomers(offlineData.customers);
              if (offlineData.settings) setOfflineSettings(offlineData.settings);
              if (offlineData.branches.length > 0) setOfflineBranches(offlineData.branches);
              setLoading(false);
            }
            return;
          }
        }

        let cusq = supabase.from('customers').select('*');
        let catq = supabase.from('categories').select('*');
        let areaq = supabase.from('dining_areas').select('*');
        const productQuery = fixedBranch
          ? supabase.from('products').select('*, category:categories(*)').eq('branch_id', fixedBranch).eq('is_active', true)
          : supabase.from('products').select('*, category:categories(*)').eq('is_active', true).order('name');
        if (fixedBranch) {
          cusq = cusq.eq('branch_id', fixedBranch);
          catq = catq.eq('branch_id', fixedBranch);
          areaq = areaq.eq('branch_id', fixedBranch);
        }
        const [pRes, cRes, catRes, aRes] = await Promise.allSettled([
          productQuery,
          cusq.order('name'),
          catq.order('name'),
          areaq.order('name'),
        ]);
        if (cancelled) return;
        
        let productLoadError: unknown = null;
        const secondaryErrors: unknown[] = [];
        let loadedProds: Product[] = [];
        let loadedCats: Category[] = [];
        let loadedCusts: Customer[] = [];
        const loadedSettings: Settings | null = sharedSettings;
        const loadedBranches: Branch[] = sharedBranches;

        if (pRes.status === 'rejected') productLoadError = pRes.reason;
        else if (pRes.value.error) productLoadError = pRes.value.error;
        else {
          loadedProds = (pRes.value.data as Product[]) || [];
          setProducts(loadedProds);
        }

        if (cRes.status === 'rejected') secondaryErrors.push(cRes.reason);
        else if (cRes.value.error) secondaryErrors.push(cRes.value.error);
        else {
          loadedCusts = (cRes.value.data as Customer[]) || [];
          setCustomers(loadedCusts);
        }

        if (catRes.status === 'rejected') secondaryErrors.push(catRes.reason);
        else if (catRes.value.error) secondaryErrors.push(catRes.value.error);
        else {
          loadedCats = (catRes.value.data as Category[]) || [];
          setCategories(loadedCats);
        }

        if (aRes.status === 'rejected') secondaryErrors.push(aRes.reason);
        else if (aRes.value.error) secondaryErrors.push(aRes.value.error);
        else if (aRes.value.data) setDiningAreas((aRes.value.data as DiningArea[]) || []);

        if (secondaryErrors.length > 0) {
          setLoadWarning(
            isAr
              ? 'تم تحميل نقطة البيع، لكن تعذر تحديث بعض البيانات الثانوية. يمكنك مواصلة العمل، ثم إعادة المحاولة لتحديث البيانات.'
              : 'POS loaded, but some secondary data could not be refreshed. You can continue working and retry to refresh it.',
          );
        }

        // Cache online data for offline use
        if (loadedProds.length > 0) {
          offlinePosManager.saveCatalogCache(fixedBranch || 'default', loadedProds, loadedCats);
          void cachePosData({
            branchId: fixedBranch || 'default',
            products: loadedProds,
            categories: loadedCats,
            customers: loadedCusts,
            settings: loadedSettings,
            branches: loadedBranches,
          });
        }

        // Only a product-catalog failure can block POS after offline fallback.
        // Secondary customer/settings/branch/category failures degrade gracefully.
        if (productLoadError || loadedProds.length === 0) {
          const offlineData = await loadCachedPosData(fixedBranch || undefined);
          const catalogFallback = offlinePosManager.getCatalogCache(fixedBranch || 'default');
          const fallbackProds = offlineData.products.length > 0 ? offlineData.products : catalogFallback?.products || [];
          const fallbackCats = offlineData.categories.length > 0 ? offlineData.categories : catalogFallback?.categories || [];

          if (fallbackProds.length > 0) {
            setProducts(fallbackProds);
            setCategories(fallbackCats);
            if (offlineData.customers.length > 0) setCustomers(offlineData.customers);
            if (offlineData.settings) setOfflineSettings(offlineData.settings);
            if (productLoadError) {
              setLoadWarning(
                isAr
                  ? 'تعذر تحديث كتالوج المنتجات من الخادم، وتم تشغيل آخر نسخة محفوظة بأمان.'
                  : 'The product catalog could not refresh from the server, so the last safe cached version is in use.',
              );
            }
          } else if (productLoadError) {
            setLoadError(userFacingErrorMessage(productLoadError, isAr ? 'ar' : 'en'));
          }
        }
      } catch (err: unknown) {
        // Try offline fallback on exception
        try {
          const offlineData = await loadCachedPosData(effectiveBranch || undefined);
          const catalogFallback = offlinePosManager.getCatalogCache(effectiveBranch || 'default');
          const fallbackProds = offlineData.products.length > 0 ? offlineData.products : catalogFallback?.products || [];
          const fallbackCats = offlineData.categories.length > 0 ? offlineData.categories : catalogFallback?.categories || [];
          if (fallbackProds.length > 0) {
            if (!cancelled) {
              setProducts(fallbackProds);
              setCategories(fallbackCats);
              if (offlineData.customers.length > 0) setCustomers(offlineData.customers);
              if (offlineData.settings) setOfflineSettings(offlineData.settings);
            }
            return;
          }
        } catch {
          // ignore
        }
        if (!cancelled) setLoadError(userFacingErrorMessage(err, isAr ? 'ar' : 'en'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadData();
    return () => {
      cancelled = true;
    };
  }, [effectiveBranch, reloadKey, cachePosData, loadCachedPosData, sharedSettings, sharedBranches, isAr]);

  useEffect(() => {
    if (!effectiveBranch) {
      setDiningAreas([]);
      return undefined;
    }

    let cancelled = false;
    const refreshAreas = async () => {
      const { data, error } = await supabase
        .from('dining_areas')
        .select('*')
        .eq('branch_id', effectiveBranch)
        .order('sort_order')
        .order('name');
      if (!cancelled && !error) setDiningAreas((data as DiningArea[]) || []);
    };

    const channel = supabase
      .channel(`pos-dining-areas-${effectiveBranch}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dining_areas', filter: `branch_id=eq.${effectiveBranch}` },
        () => { void refreshAreas(); },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [effectiveBranch]);


  const openOrderWorkspace = (orderId: string, opts: { pay?: boolean } = {}) => {
    if (pos.activeOrderId === orderId) {
      if (opts.pay && perms.canPay) handlePay();
      setPanel(null);
      setMobileOrderOpen(false);
      return;
    }
    navigate(`/pos/${orderId}`, { state: { branchId: effectiveBranch, ...(opts.pay ? { pay: 1 } : {}) } });
  };

  const startOrderAtTable = (tableId: string) => {
    if (!perms.canCreateOrder) return;
    if (pos.activeOrderId || pos.cart.length > 0) {
      const ok = window.confirm(isAr ? 'سيتم إغلاق الطلب الحالي محلياً وبدء طلب جديد على الطاولة. متابعة؟' : 'The current workspace order will be cleared. Continue?');
      if (!ok) return;
      pos.resetWorkspace();
    }
    setStartStep('table');
    setPreselectedTableId(tableId);
    setPanel(null);
    setMobileOrderOpen(false);
  };

  const handleStartOrder = (opts: StartOrderOptions) => {
    if (!perms.canCreateOrder) return;
    pos.resetWorkspace();
    pos.setOrderType(opts.orderType);
    if (opts.tableId) pos.setTableId(opts.tableId);
    pos.setGuestCount(opts.guestCount ?? null);
    if (opts.customerId) pos.setCustomerId(opts.customerId);
    pos.setOrderNotes(opts.notes || '');
    setStartStep(null);
    setPreselectedTableId(null);
    setPanel(null);
    setMobileOrderOpen(false);
  };

  const handleWizardResume = (order: Order, pay = false) => {
    setStartStep(null);
    setPreselectedTableId(null);
    setPanel(null);
    setMobileOrderOpen(false);
    openOrderWorkspace(order.id, pay ? { pay: true } : {});
  };

  const handleCancelOrder = async (orderId: string) => {
    if (!perms.canCancelOrder) return;
    const entered = window.prompt(
      isAr ? 'اكتب سبب إلغاء الطلب (مطلوب):' : 'Enter the cancellation reason (required):',
      '',
    );
    if (entered === null) return;
    const reason = entered.trim();
    if (reason.length < 3) {
      show(isAr ? 'اكتب سببًا واضحًا للإلغاء (3 أحرف على الأقل).' : 'Enter a clear cancellation reason (at least 3 characters).', 'error');
      return;
    }

    const { data, error } = await api.floorPlan.setOrderStatus({
      p_order_id: orderId,
      p_status: 'cancelled',
      p_notes: reason,
    });
    if (error) show(userFacingErrorMessage(error, isAr ? 'ar' : 'en'), 'error');
    else if (!(data as RpcResult | null)?.success) {
      const r = data as RpcResult | null;
      show(userFacingErrorMessage(r ?? t('error'), isAr ? 'ar' : 'en'), 'error');
    } else {
      show(t('cancelOrder'), 'success');
      setPanel(null);
      setReloadKey((value) => value + 1);
      if (pos.activeOrderId === orderId) pos.resetWorkspace();
    }
  };

  const handleBranchChange = (v: string) => {
    if (v !== effectiveBranch && (pos.cart.length > 0 || pos.activeOrderId)) {
      const ok = window.confirm(isAr ? 'تبديل الفرع سيمسح السلة الحالية. متابعة؟' : 'Switching branch will clear the current cart. Continue?');
      if (!ok) return;
    }
    setActiveBranchId(v);
    pos.resetWorkspace();
  };

  if (loading) {
    return (
      <div className="h-screen flex flex-col items-center justify-center bg-ui-page gap-4">
        <Logo variant="mark" size={56} tone="auto" />
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-ui-primary border-t-transparent" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="h-screen flex items-center justify-center bg-ui-page">
        <div className="text-center max-w-md px-4">
          <div className="flex justify-center mb-4">
            <Logo variant="mark" size={56} tone="auto" />
          </div>
          <div className="w-16 h-16 rounded-full bg-ui-danger/20 border border-ui-danger/30 flex items-center justify-center mx-auto mb-4">
            <ShoppingCart className="w-8 h-8 text-ui-danger" />
          </div>
          <p className="text-lg font-semibold text-ui-text mb-2">{isAr ? 'خطأ في تحميل البيانات' : 'Error Loading Data'}</p>
          <p className="text-sm text-ui-muted mb-4 whitespace-pre-line">{loadError}</p>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="px-6 py-2.5 rounded-xl bg-ui-primary hover:bg-ui-primary-hover text-ui-primary-fg font-bold transition-colors"
          >
            {isAr ? 'إعادة المحاولة' : 'Retry'}
          </button>
        </div>
      </div>
    );
  }

  const isCheckout = pos.checkoutOpen;

  const handleSidebarSelectTable = (table: DiningTable) => {
    const tableOrders = ordersByTable[table.id] || [];
    if (tableOrders.length > 0) {
      const ord = tableOrders[0];
      openOrderWorkspace(ord.id);
    } else {
      if (pos.activeOrderId || pos.cart.length > 0) {
        const ok = window.confirm(
          isAr
            ? `سيتم إغلاق مساحة العمل الحالية وبدء طلب جديد على طاولة (${table.name}). متابعة؟`
            : `Switch to start a new order on Table (${table.name})? Current cart will be cleared.`
        );
        if (!ok) return;
      }
      pos.startTableOrder(table);
      if (orderIdParam) navigate('/pos');
    }
  };

  const handleConfirmTransfer = async (orderId: string, fromTableId: string, toTableId: string) => {
    return await pos.transferOrderToTable(orderId, fromTableId, toTableId);
  };

  const handleConfirmVoid = async (lineKey: string, voidQuantity: number, reason: string) => {
    await pos.voidSentItem(lineKey, voidQuantity, reason);
  };

  const rightPanel = isCheckout ? (
    <PaymentPanel
      currentBranchName={currentBranchName}
      orderType={pos.orderType}
      activeTable={pos.activeTable}
      activeOrderNumber={pos.activeOrderNumber}
      guestCount={pos.guestCount}
      onGuestCountChange={pos.setGuestCount}
      customerId={pos.customerId}
      customers={customers}
      onCustomerChange={pos.setCustomerId}
      discountType={pos.discountType}
      discountAmount={pos.discountAmount}
      onDiscountTypeChange={pos.setDiscountType}
      onDiscountAmountChange={pos.setDiscountAmount}
      paymentMethod={pos.paymentMethod}
      onPaymentMethodChange={pos.setPaymentMethod}
      paidAmount={pos.paidAmount}
      onPaidAmountChange={pos.setPaidAmount}
      subtotal={pos.subtotal}
      discountValue={pos.discountValue}
      taxAmount={pos.taxAmount}
      total={pos.total}
      change={pos.change}
      completing={pos.completing}
      canComplete={perms.canPay && !!effectiveBranch}
      canEditOrder={perms.canEditOrder}
      onComplete={() => { if (perms.canPay) void pos.completeSale(); }}
      onBack={() => { pos.setCheckoutOpen(false); setMobileOrderOpen(true); }}
      currency={pos.effCurrency}
      cart={pos.cart}
      orderNotes={pos.orderNotes}
    />
  ) : (
    <CurrentOrderPanel
      cart={pos.cart}
      currency={pos.effCurrency}
      subtotal={pos.subtotal}
      discountValue={pos.discountValue}
      discountType={pos.discountType}
      discountAmount={pos.discountAmount}
      taxRate={effSettings?.tax_enabled ? effSettings.tax_rate || 0 : 0}
      taxAmount={pos.taxAmount}
      total={pos.total}
      completing={pos.completing}
      orderLoading={pos.orderLoading}
      kitchenSending={pos.kitchenSending}
      orderType={pos.orderType}
      activeOrderNumber={pos.activeOrderNumber}
      activeOrderId={pos.activeOrderId}
      activeTable={pos.activeTable}
      guestCount={pos.guestCount}
      customerId={pos.customerId}
      customerById={customerById}
      orderNotes={pos.orderNotes}
      activeOrderCreatedAt={activeOrderCreatedAt}
      orderItems={orderItemsForActive}
      sentOrderItemIds={sentOrderItemIds}
      sessionSent={pos.kitchenSentItems}
      canDiscount={perms.canDiscount}
      canDeleteItem={canModifyCurrentOrder}
      discountShortcutToken={discountShortcutToken}
      onSwitchOrderType={(ot) => void pos.switchOrderType(ot)}
      onGuestCountChange={pos.setGuestCount}
      onDiscountTypeChange={pos.setDiscountType}
      onDiscountAmountChange={pos.setDiscountAmount}
      onUpdateQty={pos.updateQty}
      onSetQty={pos.setQty}
      onRemove={pos.removeFromCart}
      onClear={pos.clearCart}
      onSetItemDiscount={pos.setItemDiscount}
      onHold={() => void pos.holdOrder()}
      onSendKitchen={() => void pos.sendToKitchen()}
      onPrint={() => void pos.printReceipt()}
      onPay={handlePay}
      onAddItem={() => barcodeRef.current?.focus()}
      onConfigureItem={(item) => setConfigItem(item)}
      onOpenCustomerModal={() => setCustomerModalOpen(true)}
      onOpenTableModal={() => setTableModalOpen(true)}
      perms={{ ...perms, canEditOrder: canModifyCurrentOrder }}
      onVoidItem={(item, sentQty) => {
        setVoidItem(item);
        setVoidSentQty(sentQty);
        setVoidModalOpen(true);
      }}
    />
  );

  return (
    <div data-testid="pos-workspace" className="flex h-[100dvh] flex-col overflow-hidden bg-ui-page text-ui-text">
      <PosTopBar
        panel={panel}
        onPanel={(p) => {
          setStartStep(null);
          if (p === 'orders') setOrdersCategory('all');
          setPanel(p);
        }}
        counts={{
          activeOrders: counts.active,
          occupiedTables: tables.filter((tb) => tb.status === 'occupied').length,
          kitchenOrders,
          heldOrders: counts.held,
          deliveryOrders: counts.delivery,
          takeawayOrders: counts.takeaway,
        }}
        branchId={effectiveBranch}
        branches={branches}
        canChangeBranch={perms.canChangeBranch}
        onBranchChange={handleBranchChange}
        shiftChecked={shiftChecked}
        activeShift={activeShift}
        onOpenShiftModal={() => setShiftModalOpen(true)}
        onNewOrder={() => {
          pos.resetWorkspace();
          window.dispatchEvent(new Event('pos:show-tables-landing'));
          setStartStep(null);
          setPreselectedTableId(null);
          setPanel(null);
          setMobileOrderOpen(false);
          if (orderIdParam) navigate('/pos');
        }}
        onExit={() => navigate('/dashboard')}
      />

      {loadWarning && (
        <div data-testid="pos-load-warning" className="flex items-center justify-between gap-3 border-b border-ui-warning/30 bg-ui-warning/10 px-3 py-2 text-xs font-bold text-ui-text">
          <span className="min-w-0 break-words">{loadWarning}</span>
          <button
            type="button"
            onClick={() => setReloadKey((k) => k + 1)}
            className="shrink-0 rounded-lg border border-ui-warning/40 bg-ui-surface px-2.5 py-1.5 text-[11px] font-black text-ui-text"
          >
            {isAr ? 'تحديث' : 'Retry'}
          </button>
        </div>
      )}

      {products.length === 0 && !loading && (
        <div className="p-3 bg-ui-surface border-b border-ui-border">
          <PrerequisiteAlertBanner
            step={PREREQUISITE_STEPS.create_product}
            onAction={() =>
              startGuidance(
                PREREQUISITE_STEPS.create_product,
                'pos_checkout',
                location.pathname,
                { cart: pos.cart, orderType: pos.orderType },
                'شاشة نقطة البيع POS',
                'POS Workspace'
              )
            }
          />
        </div>
      )}

      {/* Main Split-Screen Workspace */}
      <div data-testid="pos-main-workspace" className="flex min-h-0 flex-1 overflow-hidden">
        {/* Tables-first landing stays available on phones, tablets, and desktop. */}
        <div data-testid="pos-tables-landing-shell" className="flex h-full shrink-0">
          <PosTablesSidebar
            branchId={effectiveBranch}
            tables={tables}
            areas={diningAreas}
            ordersByTable={ordersByTable}
            itemsByOrder={itemsByOrder}
            kitchenSendsByOrder={kitchenSendsByOrder}
            currency={pos.effCurrency}
            activeTableId={pos.tableId || pos.activeTable?.id || null}
            activeOrderId={pos.activeOrderId}
            collapsed={tablesCollapsed}
            onToggleCollapse={() => setTablesCollapsed((prev) => !prev)}
            onSelectTable={handleSidebarSelectTable}
            onTransferOrder={(ord, tb) => {
              setTransferOrder(ord);
              setTransferSourceTable(tb);
              setTransferModalOpen(true);
            }}
            onStartQuick={() => handleStartOrder({ orderType: 'takeaway' })}
            onStartDelivery={() => {
              setStartStep('delivery');
              setPreselectedTableId(null);
              setPanel(null);
              setMobileOrderOpen(false);
            }}
            onStartDriveThru={() => {
              setStartStep('car');
              setPreselectedTableId(null);
              setPanel(null);
              setMobileOrderOpen(false);
            }}
            onOpenActiveOrders={() => {
              setStartStep(null);
              setPreselectedTableId(null);
              setOrdersCategory('all');
              setPanel('orders');
              setMobileOrderOpen(false);
            }}
            activeOrderType={pos.orderType}
          />
        </div>

        {/* Center: Product Browser with Fast Order Header Bar */}
        <div data-testid="pos-catalog-shell" className="flex min-h-0 min-w-0 flex-1 flex-col bg-ui-page">
          <PosOrderHeaderBar
            orderNumber={pos.activeOrderNumber}
            orderId={pos.activeOrderId}
            activeTable={pos.activeTable}
            orderType={pos.orderType}
            itemsCount={pos.cart.reduce((s, it) => s + it.quantity, 0)}
            canPrintReceipt={pos.cart.length > 0 || !!pos.lastReceipt}
            canModifyOrder={canModifyCurrentOrder}
            total={pos.total}
            currency={pos.effCurrency}
            createdAt={activeOrderCreatedAt}
            kitchenSends={kitchenSendsForActive}
            kitchenSending={pos.kitchenSending}
            completing={pos.completing}
            hasUnsentItems={hasUnsentItems}
            kitchenDispatch={pos.kitchenDispatch}
            customerName={pos.customerId ? customerById[pos.customerId]?.name || null : null}
            operatorName={activeOrderOperatorName}
            onOpenTransferModal={() => {
              if (pos.activeTable && pos.activeOrderId) {
                const currentOrd =
                  orders.find((o) => o.id === pos.activeOrderId) ||
                  ({
                    id: pos.activeOrderId,
                    order_number: pos.activeOrderNumber || '000',
                    table_id: pos.activeTable.id,
                    total: pos.total,
                    created_at: new Date().toISOString(),
                  } as Order);
                setTransferOrder(currentOrd);
                setTransferSourceTable(pos.activeTable);
                setTransferModalOpen(true);
              }
            }}
            onOpenCustomer={() => setCustomerModalOpen(true)}
            onHoldOrder={() => void pos.holdOrder()}
            onSendKitchen={() => void pos.sendToKitchen()}
            onPrint={() => void pos.printReceipt()}
            onPay={handlePay}
          />

          <div className="flex-1 min-h-0">
            <ProductBrowser
              products={products}
              categories={categories}
              search={search}
              selectedCategory={selectedCategory}
              currency={pos.effCurrency}
              hasBranch={!!effectiveBranch}
              canModifyOrder={canModifyCurrentOrder}
              onSearch={setSearch}
              onSelectCategory={setSelectedCategory}
              onAddToCart={pos.addToCart}
              onConfigureProduct={(p) => setConfigProduct(p)}
              inputRef={barcodeRef}
            />
          </div>
        </div>

        {/* One responsive order panel: desktop sidebar, mobile bottom sheet. */}
        <div
          data-testid="pos-mobile-order-sheet"
          className={`${mobileOrderOpen || isCheckout
            ? 'fixed inset-0 z-[60] flex items-end justify-center bg-black/45 backdrop-blur-[1px]'
            : 'hidden'
          } lg:static lg:z-auto lg:flex lg:w-[380px] lg:flex-shrink-0 lg:items-stretch lg:justify-stretch lg:bg-transparent lg:backdrop-blur-none xl:w-[410px] 2xl:w-[440px]`}
        >
          <button
            type="button"
            className="absolute inset-0 lg:hidden"
            aria-label={isAr ? 'إغلاق الطلب' : 'Close order'}
            onClick={() => {
              if (isCheckout) pos.setCheckoutOpen(false);
              setMobileOrderOpen(false);
            }}
          />
          <section
            data-testid="pos-mobile-order-sheet-panel"
            className="relative flex h-[min(94dvh,820px)] max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-3xl border-t border-ui-border bg-ui-surface shadow-2xl lg:h-full lg:max-h-none lg:rounded-none lg:border-s lg:border-t-0 lg:shadow-ui-md"
          >
            <div className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-ui-border bg-ui-surface/95 px-3 backdrop-blur lg:hidden">
              <button
                data-testid="pos-mobile-order-close"
                type="button"
                onClick={() => {
                  if (isCheckout) pos.setCheckoutOpen(false);
                  setMobileOrderOpen(false);
                }}
                className="flex h-11 w-11 items-center justify-center rounded-full border border-ui-border bg-ui-page-alt text-ui-text"
                aria-label={isAr ? 'رجوع للمنتجات' : 'Back to products'}
              >
                <Grid2X2 className="h-5 w-5" />
              </button>
              <div className="min-w-0 flex-1 text-center">
                <p className="truncate text-sm font-black text-ui-text">
                  {isCheckout ? (isAr ? 'الدفع' : 'Checkout') : (isAr ? 'الطلب الحالي' : 'Current order')}
                </p>
                <p className="truncate text-[11px] font-bold text-ui-muted">
                  {pos.activeOrderNumber ? `#${pos.activeOrderNumber}` : (isAr ? 'طلب جديد' : 'New order')}
                  {' · '}
                  {pos.cart.reduce((sum, item) => sum + item.quantity, 0)} {isAr ? 'صنف' : 'items'}
                </p>
              </div>
              <span className="max-w-[34vw] truncate text-sm font-black text-ui-accent">
                {formatCurrency(pos.total, pos.effCurrency, lang)}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden pb-[env(safe-area-inset-bottom)] lg:pb-0">
              {rightPanel}
            </div>
          </section>
        </div>
      </div>

      <nav
        data-testid="pos-mobile-command-dock"
        className="fixed bottom-0 start-0 end-0 z-40 grid grid-cols-4 border-t border-ui-border bg-ui-surface/95 px-1 pt-1 shadow-[0_-10px_30px_rgba(0,0,0,0.10)] backdrop-blur-xl lg:hidden"
        aria-label={isAr ? 'تحكم شاشة البيع' : 'POS mobile controls'}
      >
        <button
          data-testid="pos-mobile-nav-catalog"
          type="button"
          onClick={() => {
            pos.setCheckoutOpen(false);
            setMobileOrderOpen(false);
            setPanel(null);
            window.setTimeout(() => barcodeRef.current?.focus(), 30);
          }}
          className="flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[10px] font-black text-ui-muted active:bg-ui-page-alt"
        >
          <Grid2X2 className="h-5 w-5" />
          <span>{isAr ? 'المنتجات' : 'Menu'}</span>
        </button>

        <button
          data-testid="pos-mobile-nav-order"
          type="button"
          onClick={() => setMobileOrderOpen(true)}
          disabled={!pos.activeOrderId && pos.cart.length === 0}
          className="relative flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[10px] font-black text-ui-muted active:bg-ui-page-alt disabled:opacity-40"
        >
          <ShoppingCart className="h-5 w-5" />
          <span>{isCheckout ? (isAr ? 'الدفع' : 'Pay') : (isAr ? 'الطلب' : 'Order')}</span>
          {pos.cart.length > 0 && (
            <span className="absolute end-[22%] top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-ui-primary px-1 text-[9px] text-ui-primary-fg">
              {pos.cart.reduce((sum, item) => sum + item.quantity, 0)}
            </span>
          )}
        </button>

        <button
          data-testid="pos-mobile-nav-orders"
          type="button"
          onClick={() => {
            setMobileOrderOpen(false);
            setStartStep(null);
            setOrdersCategory('all');
            setPanel('orders');
          }}
          className="relative flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[10px] font-black text-ui-muted active:bg-ui-page-alt"
        >
          <ListOrdered className="h-5 w-5" />
          <span>{isAr ? 'الطلبات' : 'Orders'}</span>
          {counts.active > 0 && (
            <span className="absolute end-[22%] top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-ui-danger px-1 text-[9px] text-white">
              {counts.active}
            </span>
          )}
        </button>

        <button
          data-testid="pos-mobile-nav-tables"
          type="button"
          onClick={() => {
            setMobileOrderOpen(false);
            setStartStep(null);
            setPanel('tables');
          }}
          className="flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl px-1 text-[10px] font-black text-ui-muted active:bg-ui-page-alt"
        >
          <Utensils className="h-5 w-5" />
          <span>{isAr ? 'الطاولات' : 'Tables'}</span>
        </button>
      </nav>

      <ActiveOrdersDrawer
        open={panel === 'orders'}
        onClose={() => setPanel(null)}
        initialCategory={ordersCategory}
        orders={orders}
        itemsByOrder={itemsByOrder}
        kitchenSendsByOrder={kitchenSendsByOrder}
        tableById={tableById}
        customerById={customerById}
        currency={pos.effCurrency}
        onResume={(o) => openOrderWorkspace(o.id)}
        onPay={(o) => openOrderWorkspace(o.id, { pay: true })}
        onCancel={(o) => void handleCancelOrder(o.id)}
      />

      <TablesPanel
        open={panel === 'tables'}
        onClose={() => setPanel(null)}
        tables={tables}
        areas={diningAreas}
        ordersByTable={ordersByTable}
        currency={pos.effCurrency}
        onResume={(o) => openOrderWorkspace(o.id)}
        onPay={(o) => openOrderWorkspace(o.id, { pay: true })}
        onStart={(tb) => startOrderAtTable(tb.id)}
      />

      <KitchenPanel
        open={panel === 'kitchen'}
        onClose={() => setPanel(null)}
        orders={orders}
        itemsByOrder={itemsByOrder}
        kitchenSendsByOrder={kitchenSendsByOrder}
        tableById={tableById}
        productNames={productNames}
      />

      {startStep && (
        <OrderStartWizard
          step={startStep}
          tables={tables}
          ordersByTable={ordersByTable}
          itemsByOrder={itemsByOrder}
          kitchenSendsByOrder={kitchenSendsByOrder}
          customers={customers}
          preselectedTableId={preselectedTableId}
          currency={pos.effCurrency}
          onStepChange={setStartStep}
          onBack={() => setStartStep(null)}
          onStart={handleStartOrder}
          onResume={handleWizardResume}
          onActiveOrders={() => {
            setStartStep(null);
            setPreselectedTableId(null);
            setOrdersCategory('all');
            setPanel('orders');
          }}
        />
      )}

      {/* Product Config Modal */}
      {(configProduct || configItem) && (
        <ProductConfigModal
          isOpen={!!(configProduct || configItem)}
          onClose={() => {
            setConfigProduct(null);
            setConfigItem(null);
          }}
          product={configProduct || configItem?.product || null}
          initialItem={configItem}
          currency={pos.effCurrency}
          onConfirm={(item) => {
            if (configItem) {
              const originalLineKey = cartLineKey(configItem);
              const matchingOrderItem = orderItemsForActive.find((row) => orderItemLineKey(row) === originalLineKey);
              const matchingSend = matchingOrderItem
                ? kitchenSendsForActive.find((row) => row.order_item_id === matchingOrderItem.id)
                : null;
              const sentQty = Number(matchingSend?.sent_quantity || 0);
              const identityChanged = cartLineKey(item) !== originalLineKey;

              if (sentQty > 0 && (identityChanged || item.quantity < sentQty)) {
                show(
                  isAr
                    ? 'هذا الصنف أُرسل للمطبخ بالفعل. لتقليل الكمية أو تغيير الملاحظة/الإضافات استخدم زر إلغاء الصنف (Void) أولًا، ثم أضف التعديل المطلوب.'
                    : 'This item was already sent to kitchen. To reduce quantity or change notes/modifiers, void the sent item first, then add the required change.',
                  'error',
                );
                return;
              }

              pos.replaceCartLine(originalLineKey, item);
            } else {
              pos.addToCart(
                item.product,
                item.quantity,
                item.modifiers || [],
                item.discount_amount,
                item.modifier_option_ids || [],
                item.unit_price,
                item.item_note,
              );
            }
            setConfigProduct(null);
            setConfigItem(null);
          }}
          canDiscount={perms.canDiscount}
        />
      )}

      {/* Customer Quick Modal */}
      <CustomerQuickModal
        isOpen={customerModalOpen}
        onClose={() => setCustomerModalOpen(false)}
        customers={customers}
        selectedCustomerId={pos.customerId}
        onSelectCustomer={(c) => pos.setCustomerId(c.id)}
        onCustomerCreated={(c) => {
          setCustomers((prev) => [c, ...prev]);
          pos.setCustomerId(c.id);
        }}
        branchId={effectiveBranch}
      />

      {/* Table Select Modal */}
      <TableSelectModal
        isOpen={tableModalOpen}
        onClose={() => setTableModalOpen(false)}
        tables={tables}
        areas={diningAreas}
        selectedTableId={pos.activeTable?.id || null}
        onSelectTable={(table) => pos.setTableId(table.id)}
      />

      {/* Transfer Order Modal */}
      <TransferOrderModal
        open={transferModalOpen}
        onClose={() => {
          setTransferModalOpen(false);
          setTransferOrder(null);
          setTransferSourceTable(null);
        }}
        order={transferOrder}
        sourceTable={transferSourceTable}
        tables={tables}
        areas={diningAreas}
        ordersByTable={ordersByTable}
        onConfirmTransfer={handleConfirmTransfer}
        onOperatorTransferred={() => setReloadKey((value) => value + 1)}
      />

      {/* Void Sent Item Modal */}
      <VoidItemModal
        open={voidModalOpen}
        onClose={() => {
          setVoidModalOpen(false);
          setVoidItem(null);
        }}
        item={voidItem}
        sentQty={voidSentQty}
        canDirectVoid={perms.canVoidSentItem}
        onConfirmVoid={handleConfirmVoid}
      />

      {/* Shift Modal */}
      <ShiftModal
        isOpen={shiftModalOpen}
        onClose={() => setShiftModalOpen(false)}
        branchId={effectiveBranch}
        activeShift={activeShift}
        currency={pos.effCurrency}
        onShiftClosed={() => {
          reloadShift();
        }}
      />

      {/* Receipt Modal */}
      <Modal open={!!pos.receiptSaleId} onClose={pos.closeReceipt} title={t('printReceipt')} size="sm">
        {pos.lastReceipt && (
          <div className="space-y-4">
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-ui-success/15 ring-2 ring-ui-border-strong flex items-center justify-center mx-auto mb-3">
                <BarcodeIcon className="w-8 h-8 text-ui-success" />
              </div>
              <p className="text-base font-semibold text-ui-text">{t('saleCompleted')}</p>
              <p className="text-sm text-ui-muted mt-1">{pos.lastReceipt.invoice}</p>
            </div>
            {perms.canPrint && (
              <button
                data-testid="pos-receipt-print"
                onClick={() => void pos.printReceipt()}
                className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-ui-primary hover:bg-ui-primary-hover text-ui-primary-fg font-bold transition-colors"
              >
                <Printer className="w-5 h-5" /> {t('printReceipt')}
              </button>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
