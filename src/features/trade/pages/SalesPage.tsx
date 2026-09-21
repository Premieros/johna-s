import { useEffect, useState } from 'react';
import { Trash2, FileText, Edit2, RotateCcw, Eye, Printer } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel, DesignPagination } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Select, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { BranchBadge } from '@/components/BranchBadge';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { useHistoryAccess } from '@/lib/useHistoryAccess';
import { useSettings } from '@/context/SettingsContext';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import { useBranches } from '@/hooks/useBranches';
import type { Customer } from '@/lib/types';
import {
  APPROVED_FIXED_THERMAL_WIDTH_MM,
  ReceiptPrintApprovalError,
  buildReceiptHtml,
  openPrintWindow,
  type ReceiptData,
} from '@/features/pos/utils/printing';

interface SaleRow {
  id: string;
  invoice_number: string;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total: number;
  paid_amount: number;
  refunded_amount: number;
  payment_method: string;
  status: string;
  notes: string | null;
  created_at: string;
  customer_id: string | null;
  branch_id: string;
  order_type: string;
  guest_count: number | null;
  is_archived: boolean;
  customer?: { name: string } | null;
  sale_items?: { id: string; product_id: string | null; unit_name: string; quantity: number; unit_price: number; discount_amount: number; refunded_quantity: number; refunded_amount: number; total: number; product?: { name: string } | null }[];
}

export function SalesPage() {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const branchFilter = useBranchFilter();
  const can = useCan();
  const history = useHistoryAccess();
  const { rows: items, loading, error, total, hasMore, loadMore, loadingMore, refresh: reloadSales } = usePaginatedRows<SaleRow>({
    table: 'sales',
    select: 'id, invoice_number, subtotal, discount_amount, tax_amount, total, paid_amount, refunded_amount, payment_method, status, notes, created_at, customer_id, branch_id, order_type, guest_count, is_archived, customer:customers(name), sale_items(id, product_id, unit_name, quantity, unit_price, discount_amount, refunded_quantity, refunded_amount, total, product:products(name))',
    order: { column: 'created_at', ascending: false },
    branch_id: branchFilter,
    filters: [{ column: 'is_archived', value: false }],
    min: history.minIso ? { column: 'created_at', value: history.minIso } : undefined,
    pageSize: 100,
  });
  const [search, setSearch] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteSelectedConfirm, setDeleteSelectedConfirm] = useState(false);
  const { effectiveSettings } = useSettings();
  const { branches } = useBranches();
  const currency = effectiveSettings(branchFilter)?.currency || 'EGP';
  const [viewSale, setViewSale] = useState<SaleRow | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [editForm, setEditForm] = useState({ customer_id: '', payment_method: '', status: '', notes: '' });
  const [refundSale, setRefundSale] = useState<SaleRow | null>(null);
  const [refundQty, setRefundQty] = useState<Record<string, string>>({});
  const [refundReason, setRefundReason] = useState('');
  const [refunding, setRefunding] = useState(false);
  const [receiptPreviewHtml, setReceiptPreviewHtml] = useState('');
  const [receiptPreviewTitle, setReceiptPreviewTitle] = useState('');
  const [receiptPreviewOpen, setReceiptPreviewOpen] = useState(false);
  const [receiptBusyId, setReceiptBusyId] = useState<string | null>(null);
  const isAr = lang === 'ar';
  const canRequestRefundApproval = can('sales.refund.create') && !can('refunds.approve');
  const canOpenRefund = can('sales.refund.create') || can('refunds.approve');
  const canRequestPaymentApproval = can('sales.payment.receive') && !can('refunds.approve');
  const canEditSaleMetadata = can('refunds.approve');
  const canEditPaymentMethod = can('sales.payment.receive') || can('refunds.approve');
  const canEditSale = canEditSaleMetadata || canEditPaymentMethod;
  const canArchiveReturnedSale = can('refunds.approve');
  const canPreviewReceipt = can('sales.view');
  const canPrintReceipt = can('pos.receipt.print') || can('pos.reprint') || can('sales.print');

  async function loadMeta() {
    const { data: customersRes } = await supabase.from('customers').select('*').order('name');
    setCustomers((customersRes as Customer[]) || []);
  }
  useEffect(() => { loadMeta(); }, []);

  const filtered = items.filter((i) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      i.invoice_number?.toLowerCase().includes(s) ||
      i.customer?.name?.toLowerCase().includes(s) ||
      i.status?.toLowerCase().includes(s)
    );
  });

  const branchNameForSale = (sale: SaleRow) =>
    branches.find((branch) => branch.id === sale.branch_id)?.name || (isAr ? 'الفرع' : 'Branch');

  const orderTypeLabelForSale = (orderType: string) => {
    const labels: Record<string, [string, string]> = {
      dine_in: ['صالة', 'Dine-in'],
      takeaway: ['سفري', 'Takeaway'],
      delivery: ['توصيل', 'Delivery'],
      drive_thru: ['سيارات', 'Drive-thru'],
      quick: ['سريع', 'Quick'],
    };
    const label = labels[String(orderType || '').toLowerCase()];
    return label ? (isAr ? label[0] : label[1]) : orderType;
  };

  const loadReceiptPayments = async (sale: SaleRow): Promise<Array<{ method: string; amount: number }>> => {
    const { data, error: paymentError } = await supabase
      .from('sale_payments')
      .select('payment_method, amount, refunded_amount, created_at')
      .eq('sale_id', sale.id)
      .order('created_at', { ascending: true });

    if (!paymentError && Array.isArray(data) && data.length > 0) {
      const payments = data
        .map((row) => ({
          method: String(row.payment_method || 'other'),
          amount: Math.max(0, Number(row.amount || 0) - Number(row.refunded_amount || 0)),
        }))
        .filter((row) => row.amount > 0);
      if (payments.length > 0) return payments;
    }

    const fallbackAmount = Math.max(0, Number(sale.paid_amount || 0) - Number(sale.refunded_amount || 0));
    return fallbackAmount > 0
      ? [{ method: sale.payment_method || 'cash', amount: fallbackAmount }]
      : [];
  };

  const buildSaleReceipt = async (sale: SaleRow): Promise<ReceiptData> => {
    const payments = await loadReceiptPayments(sale);
    return {
      invoice: sale.invoice_number,
      branchName: branchNameForSale(sale),
      items: (sale.sale_items || []).map((item) => ({
        name: item.product?.name || item.unit_name || '-',
        qty: Number(item.quantity || 0),
        price: Number(item.unit_price || 0),
        total: Number(item.total || 0),
      })),
      subtotal: Number(sale.subtotal || 0),
      discount: Number(sale.discount_amount || 0),
      tax: Number(sale.tax_amount || 0),
      total: Number(sale.total || 0),
      paid: Number(sale.paid_amount || 0),
      change: Math.max(0, Number(sale.paid_amount || 0) - Number(sale.total || 0)),
      date: sale.created_at,
      customerName: sale.customer?.name || '',
      orderTypeLabel: orderTypeLabelForSale(sale.order_type),
      guestCount: sale.guest_count,
      payments,
    };
  };

  const previewSaleReceipt = async (sale: SaleRow) => {
    if (!canPreviewReceipt || receiptBusyId) return;
    setReceiptBusyId(sale.id);
    try {
      const receipt = await buildSaleReceipt(sale);
      const html = await buildReceiptHtml(
        receipt,
        effectiveSettings(sale.branch_id),
        lang,
        isAr,
        { authorize: false },
      );
      setReceiptPreviewTitle(isAr ? `معاينة شيك العميل — ${sale.invoice_number}` : `Customer Receipt Preview — ${sale.invoice_number}`);
      setReceiptPreviewHtml(html);
      setReceiptPreviewOpen(true);
    } catch (err) {
      show(err instanceof Error ? err.message : (isAr ? 'تعذر إنشاء المعاينة' : 'Could not build receipt preview'), 'error');
    } finally {
      setReceiptBusyId(null);
    }
  };

  const printSaleReceipt = async (sale: SaleRow) => {
    if (!canPrintReceipt || receiptBusyId) return;
    setReceiptBusyId(sale.id);
    try {
      const receipt = await buildSaleReceipt(sale);
      const html = await buildReceiptHtml(receipt, effectiveSettings(sale.branch_id), lang, isAr);
      const accepted = openPrintWindow(html, APPROVED_FIXED_THERMAL_WIDTH_MM);
      if (!accepted) {
        show(isAr ? 'تعذر فتح مسار الطباعة' : 'Could not open the receipt print path', 'error');
        return;
      }
      show(isAr ? 'تم إرسال الشيك إلى مسار طباعة الكاشير.' : 'Receipt sent to the cashier print path.', 'success');
    } catch (err) {
      if (err instanceof ReceiptPrintApprovalError && err.code === 'REPRINT_APPROVAL_PENDING') {
        show(
          isAr
            ? 'إعادة الطباعة تحتاج موافقة. تم إرسال الطلب للمدير أو ما زال قيد المراجعة.'
            : 'Reprint requires approval. The request was sent or is still pending.',
          'success',
        );
        return;
      }
      show(err instanceof Error ? err.message : (isAr ? 'تعذر إعادة طباعة الشيك' : 'Could not reprint receipt'), 'error');
    } finally {
      setReceiptBusyId(null);
    }
  };

  const openViewSale = (sale: SaleRow) => {
    setViewSale(sale);
    setEditForm({
      customer_id: sale.customer_id || '',
      payment_method: sale.payment_method,
      status: sale.status,
      notes: sale.notes || '',
    });
  };

  const openRefund = (sale: SaleRow) => {
    setRefundSale(sale);
    setRefundReason('');
    const qty: Record<string, string> = {};
    for (const item of sale.sale_items || []) {
      qty[item.id] = '0';
    }
    setRefundQty(qty);
  };

  const refundLineTotal = (item: NonNullable<SaleRow['sale_items']>[number]): number => {
    const q = Math.max(0, Math.min(parseFloat(refundQty[item.id] || '0') || 0, item.quantity - (item.refunded_quantity || 0)));
    return Math.round((item.total || 0) * q / (item.quantity || 1) * 100) / 100;
  };

  const refundTotal = () => {
    let sum = 0;
    for (const item of refundSale?.sale_items || []) sum += refundLineTotal(item);
    return Math.round(sum * 100) / 100;
  };

  const fillFullRefund = () => {
    if (!refundSale) return;
    const qty: Record<string, string> = {};
    for (const item of refundSale.sale_items || []) {
      qty[item.id] = String(Math.max(0, item.quantity - (item.refunded_quantity || 0)));
    }
    setRefundQty(qty);
  };

  const clearRefundSelection = () => {
    if (!refundSale) return;
    const qty: Record<string, string> = {};
    for (const item of refundSale.sale_items || []) qty[item.id] = '0';
    setRefundQty(qty);
  };

  const previewRefundReceipt = async () => {
    if (!refundSale || receiptBusyId) return;
    const selected = (refundSale.sale_items || [])
      .map((item) => {
        const remaining = Math.max(0, item.quantity - (item.refunded_quantity || 0));
        const qty = Math.max(0, Math.min(parseFloat(refundQty[item.id] || '0') || 0, remaining));
        return { item, qty };
      })
      .filter((row) => row.qty > 0);
    if (selected.length === 0) {
      show(isAr ? 'اختر صنفًا أو كمية للمرتجع أولًا' : 'Choose an item or quantity to refund first', 'error');
      return;
    }

    const totalRefund = refundTotal();
    const receipt: ReceiptData = {
      invoice: refundSale.invoice_number,
      branchName: branchNameForSale(refundSale),
      items: selected.map(({ item, qty }) => ({
        name: item.product?.name || item.unit_name || '-',
        qty,
        price: Number(item.unit_price || 0),
        total: refundLineTotal(item),
      })),
      subtotal: totalRefund,
      discount: 0,
      tax: 0,
      total: totalRefund,
      paid: 0,
      change: 0,
      date: refundSale.created_at,
      customerName: refundSale.customer?.name || '',
      orderTypeLabel: orderTypeLabelForSale(refundSale.order_type),
      guestCount: refundSale.guest_count,
      documentTitle: isAr ? 'معاينة المرتجع' : 'REFUND PREVIEW',
      hidePaymentSummary: true,
    };

    setReceiptBusyId(refundSale.id);
    try {
      const html = await buildReceiptHtml(
        receipt,
        effectiveSettings(refundSale.branch_id),
        lang,
        isAr,
        { authorize: false },
      );
      setReceiptPreviewTitle(isAr ? `معاينة المرتجع — ${refundSale.invoice_number}` : `Refund Preview — ${refundSale.invoice_number}`);
      setReceiptPreviewHtml(html);
      setReceiptPreviewOpen(true);
    } catch (err) {
      show(err instanceof Error ? err.message : (isAr ? 'تعذر إنشاء معاينة المرتجع' : 'Could not build refund preview'), 'error');
    } finally {
      setReceiptBusyId(null);
    }
  };

  const submitRefund = async () => {
    if (!refundSale) return;
    const p_items: { sale_item_id: string; quantity: number }[] = [];
    for (const item of refundSale.sale_items || []) {
      const q = Math.max(0, Math.min(parseFloat(refundQty[item.id] || '0') || 0, item.quantity - (item.refunded_quantity || 0)));
      if (q > 0) p_items.push({ sale_item_id: item.id, quantity: q });
    }
    if (p_items.length === 0) { show(isAr ? 'اختر كمية للمرتجع' : 'Choose a quantity to refund', 'error'); return; }
    setRefunding(true);
    const { data, error } = await api.trade.processRefund({
      p_sale_id: refundSale.id,
      p_items,
      p_reason: refundReason.trim() || null,
    });
    setRefunding(false);
    if (error) { show(error.message, 'error'); return; }
    const result = data as { success: boolean; error?: string; detail?: string; refunded_amount?: number } | null;
    if (!result?.success) {
      if (result?.error === 'APPROVAL_REQUIRED' && canRequestRefundApproval) {
        const { data: approvalData, error: approvalError } = await supabase.rpc('request_manager_approval', {
          p_action_type: 'refund',
          p_entity_type: 'sale',
          p_entity_id: refundSale.id,
          p_payload: {
            items: p_items,
            reason: refundReason.trim() || null,
            refund_total: refundTotal(),
            invoice_number: refundSale.invoice_number,
          },
          p_reason: refundReason.trim() || (isAr ? 'طلب مرتجع من الكاشير' : 'Cashier refund request'),
        });
        if (approvalError) {
          show(approvalError.message, 'error');
          return;
        }
        const approvalResult = approvalData as { success?: boolean; error?: string; request_id?: string } | null;
        if (!approvalResult?.success) {
          show(approvalResult?.error || (isAr ? 'تعذر إرسال طلب الموافقة' : 'Could not request approval'), 'error');
          return;
        }
        show(isAr ? 'تم إرسال طلب المرتجع للمدير. بعد الموافقة اضغط تنفيذ المرتجع مرة أخرى.' : 'Refund approval requested. After manager approval, submit the refund again.', 'success');
        return;
      }
      show(`${isAr ? 'فشل المرتجع' : 'Refund failed'}: ${result?.detail || result?.error || 'unknown'}`, 'error');
      return;
    }
    await logAudit('update', 'sales', refundSale.id, { refunded_amount: result.refunded_amount, reason: refundReason });
    show(`${isAr ? 'تمت المعاملة' : 'Refunded'} ${formatCurrency(result.refunded_amount || 0, currency, lang)}`, 'success');
    setRefundSale(null);
    reloadSales();
  };

  const saveSaleEdit = async () => {
    if (!viewSale) return;

    const paymentChanged = editForm.payment_method !== viewSale.payment_method;
    if (paymentChanged && !canEditPaymentMethod) {
      show(isAr ? 'لا تملك صلاحية تعديل طريقة الدفع' : 'You do not have permission to edit the payment method', 'error');
      return;
    }
    if (paymentChanged) {
      if (editForm.payment_method === 'credit') {
        show(isAr ? 'التحويل إلى آجل يحتاج مسار ذمم مدينة مستقل' : 'Changing to credit requires the receivables workflow', 'error');
        return;
      }

      const { data, error } = await supabase.rpc('change_sale_payment_method', {
        p_sale_id: viewSale.id,
        p_new_method: editForm.payment_method,
        p_reason: null,
      });
      if (error) { show(error.message, 'error'); return; }

      const result = data as { success?: boolean; error?: string; detail?: string } | null;
      if (!result?.success) {
        if (result?.error === 'APPROVAL_REQUIRED' && canRequestPaymentApproval) {
          const { data: approvalData, error: approvalError } = await supabase.rpc('request_manager_approval', {
            p_action_type: 'change_payment_method',
            p_entity_type: 'sale',
            p_entity_id: viewSale.id,
            p_payload: {
              old_method: viewSale.payment_method,
              new_method: editForm.payment_method,
              invoice_number: viewSale.invoice_number,
            },
            p_reason: isAr ? 'طلب تغيير طريقة دفع من الكاشير' : 'Cashier payment-method correction request',
          });
          if (approvalError) { show(approvalError.message, 'error'); return; }
          const approvalResult = approvalData as { success?: boolean; error?: string } | null;
          if (!approvalResult?.success) {
            show(approvalResult?.error || (isAr ? 'تعذر إرسال طلب الموافقة' : 'Could not request approval'), 'error');
            return;
          }
          show(isAr ? 'تم إرسال طلب تغيير طريقة الدفع للمدير. بعد الموافقة اضغط حفظ مرة أخرى.' : 'Payment change approval requested. After approval, save again.', 'success');
          return;
        }
        show(result?.detail || result?.error || (isAr ? 'فشل تغيير طريقة الدفع' : 'Payment change failed'), 'error');
        return;
      }
    }

    if (canEditSaleMetadata) {
      const { error } = await supabase.from('sales').update({
        customer_id: editForm.customer_id || null,
        status: editForm.status,
        notes: editForm.notes || null,
      }).eq('id', viewSale.id);
      if (error) { show(error.message, 'error'); return; }
    }

    await logAudit('update', 'sales', viewSale.id, paymentChanged ? { payment_method: editForm.payment_method } : undefined);
    show(t('saveSuccess'), 'success');
    setViewSale(null);
    reloadSales();
  };

  const remove = async () => {
    if (!deleteId) return;
    const sale = items.find((i) => i.id === deleteId);
    if (!sale || sale.status !== 'returned') {
      show(isAr ? 'لا يمكن إخفاء إلا الفاتورة المرتجعة بالكامل' : 'Only fully returned sales can be archived', 'error');
      setDeleteId(null);
      return;
    }
    try {
      const { data, error } = await api.trade.archiveReturnedSale({ p_sale_id: deleteId });
      if (error) { show(error.message, 'error'); return; }
      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        show(result?.error || (isAr ? 'تعذر إخفاء الفاتورة المرتجعة' : 'Could not archive returned sale'), 'error');
        return;
      }
      await logAudit('archive', 'sales', deleteId, { status: 'returned' });
      show(isAr ? 'تم إخفاء الفاتورة المرتجعة مع الاحتفاظ بأثرها المالي' : 'Returned sale archived; financial history was preserved', 'success');
    } catch (err: unknown) {
      show(err instanceof Error ? err.message : 'Error', 'error');
    }
    setDeleteId(null);
    reloadSales();
  };

  const removeSelected = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const archivable = items.filter((i) => ids.includes(i.id) && i.status === 'returned').map((i) => i.id);
    const blocked = ids.length - archivable.length;
    let archived = 0;
    for (const id of archivable) {
      const { data, error } = await api.trade.archiveReturnedSale({ p_sale_id: id });
      const result = data as { success?: boolean } | null;
      if (!error && result?.success) {
        archived += 1;
        await logAudit('archive', 'sales', id, { status: 'returned' });
      }
    }
    if (blocked > 0) show(isAr ? `تم إخفاء ${archived} فاتورة مرتجعة، و${blocked} فاتورة غير مؤهلة` : `Archived ${archived} returned sales; ${blocked} were not eligible`, 'error');
    else show(isAr ? 'تم إخفاء الفواتير المرتجعة مع الاحتفاظ بأثرها المالي' : 'Returned sales archived; financial history was preserved', 'success');
    setSelectedIds(new Set());
    setDeleteSelectedConfirm(false);
    reloadSales();
  };

  const PAYMENT_LABELS: Record<string, string> = { cash: t('cash'), card: t('card'), transfer: t('transfer'), credit: t('credit') };

  const columns: Column<SaleRow>[] = [
    { key: 'invoice_number', header: t('invoiceNumber'), render: (r) => (
      <div className="flex items-center gap-2">
        <FileText className="w-4 h-4 text-brand-500" />
        <span className="font-medium text-ui-text">{r.invoice_number}</span>
      </div>
    )},
    { key: 'created_at', header: t('date'), render: (r) => <span className="text-sm text-ui-subtle">{formatDateTime(r.created_at, lang)}</span> },
    { key: 'customer', header: t('customer'), render: (r) => r.customer?.name || '-' },
    { key: 'branch', header: t('branch'), render: (r) => <BranchBadge name={branches.find((b) => b.id === r.branch_id)?.name || '-'} /> },
    { key: 'total', header: t('total'), render: (r) => <span className="font-semibold text-ui-text">{formatCurrency(r.total, currency, lang)}</span> },
    { key: 'paid_amount', header: isAr ? 'المدفوع' : 'Paid', render: (r) => formatCurrency(r.paid_amount, currency, lang) },
    { key: 'payment_method', header: isAr ? 'طريقة الدفع' : 'Payment', render: (r) => (
      <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-ui-page-alt text-ui-muted">
        {PAYMENT_LABELS[r.payment_method] || r.payment_method}
      </span>
    )},
    { key: 'status', header: t('status'), render: (r) => (
      <div className="flex items-center gap-1.5">
        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
          r.status === 'completed' ? 'bg-ui-success-soft text-ui-success' :
          r.status === 'returned' ? 'bg-ui-danger-soft text-ui-danger' :
          'bg-ui-warning-soft text-ui-warning'
        }`}>
          {r.status}
        </span>
        {r.refunded_amount > 0 && r.status !== 'returned' && (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-ui-warning-soft text-ui-warning">
            {isAr ? `مرتجع ${formatCurrency(r.refunded_amount, currency, lang)}` : `Refunded ${formatCurrency(r.refunded_amount, currency, lang)}`}
          </span>
        )}
      </div>
    )},
    { key: 'actions', header: t('actions'), render: (r) => (
      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        {canEditSale && (
          <button onClick={() => openViewSale(r)} className="ui-icon-action ui-icon-action-info" title={t('edit')}>
            <Edit2 className="w-4 h-4" />
          </button>
        )}
        {canOpenRefund && r.status !== 'returned' && (r.refunded_amount || 0) < r.total && (
          <button onClick={() => openRefund(r)} className="p-1.5 rounded-md hover:bg-ui-warning-soft text-ui-warning" title={isAr ? 'مرتجع' : 'Refund'}>
            <RotateCcw className="w-4 h-4" />
          </button>
        )}
        {canArchiveReturnedSale && r.status === 'returned' && (
          <button onClick={() => setDeleteId(r.id)} className="ui-icon-action ui-icon-action-danger" title={isAr ? 'إخفاء الفاتورة المرتجعة' : 'Archive returned sale'}>
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>
    )},
  ];

  return (
    <DesignSurface testId="sales-page">
      <DesignPageHeader title={t('salesInvoices')} actions={
        <>
          {selectedIds.size > 0 && (
            <Button variant="danger" size="sm" onClick={() => setDeleteSelectedConfirm(true)} data-testid="sales-delete-selected">
              <Trash2 className="w-4 h-4" /> {t('deleteSelected')} ({selectedIds.size})
            </Button>
          )}
        </>
      } />

      <DesignPanel testId="sales-search-panel">
        <DesignSearch value={search} onChange={setSearch} label={t('search')}
          placeholder={isAr ? 'بحث برقم الفاتورة أو اسم العميل...' : 'Search by invoice number or customer...'} testId="sales-search" />
      </DesignPanel>

      <DesignPanel testId="sales-table-panel">
        <DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')}
          onRowClick={openViewSale} showCheckbox selectedIds={selectedIds} onSelectionChange={setSelectedIds} />
        <DesignPagination loaded={items.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>

      {/* Sale Detail / Edit Modal */}
      <Modal open={!!viewSale} onClose={() => setViewSale(null)} title={isAr ? 'تفاصيل الفاتورة' : 'Invoice Details'} size="lg">
        {viewSale && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 bg-ui-page-alt rounded-lg">
              <FileText className="w-8 h-8 text-brand-500" />
              <div>
                <p className="font-bold text-lg text-ui-text">{viewSale.invoice_number}</p>
                <p className="text-sm text-ui-subtle">{formatDateTime(viewSale.created_at, lang)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Select label={t('customer')} value={editForm.customer_id} disabled={!canEditSaleMetadata} onChange={(e) => setEditForm({ ...editForm, customer_id: e.target.value })}>
                <option value="">--</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
              <Select label={isAr ? 'طريقة الدفع' : 'Payment Method'} value={editForm.payment_method} disabled={!canEditPaymentMethod} onChange={(e) => setEditForm({ ...editForm, payment_method: e.target.value })}>
                <option value="cash">{t('cash')}</option>
                <option value="card">{t('card')}</option>
                <option value="transfer">{t('transfer')}</option>
                <option value="credit" disabled>{t('credit')}</option>
              </Select>
              <Select label={t('status')} value={editForm.status} disabled={!canEditSaleMetadata} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}>
                <option value="completed">{isAr ? 'مكتملة' : 'Completed'}</option>
                <option value="pending">{isAr ? 'قيد الانتظار' : 'Pending'}</option>
                <option value="returned">{isAr ? 'مرتجعة' : 'Returned'}</option>
              </Select>
              <div />
            </div>
            <Textarea label={t('notes')} value={editForm.notes} disabled={!canEditSaleMetadata} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={2} />

            {viewSale.sale_items && viewSale.sale_items.length > 0 && (
              <div>
                <h4 className="font-semibold text-ui-muted mb-2">{isAr ? 'أصناف الفاتورة' : 'Invoice Items'}</h4>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-ui-border">
                        <th className="px-3 py-2 text-start text-xs font-medium text-ui-subtle">{t('productName')}</th>
                        <th className="px-3 py-2 text-start text-xs font-medium text-ui-subtle">{isAr ? 'الكمية' : 'Qty'}</th>
                        <th className="px-3 py-2 text-start text-xs font-medium text-ui-subtle">{isAr ? 'السعر' : 'Price'}</th>
                        <th className="px-3 py-2 text-start text-xs font-medium text-ui-subtle">{t('total')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {viewSale.sale_items.map((item) => (
                        <tr key={item.id} className="border-b border-ui-border">
                          <td className="px-3 py-2 text-ui-text">{item.product?.name || '-'}</td>
                          <td className="px-3 py-2 text-ui-muted">{item.quantity}</td>
                          <td className="px-3 py-2 text-ui-muted">{formatCurrency(item.unit_price, currency, lang)}</td>
                          <td className="px-3 py-2 font-medium text-ui-text">{formatCurrency(item.total, currency, lang)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="bg-ui-page-alt rounded-lg p-4 space-y-2">
              <div className="flex justify-between text-sm"><span>{t('total')}</span><span className="font-bold text-brand-600">{formatCurrency(viewSale.total, currency, lang)}</span></div>
              <div className="flex justify-between text-sm"><span>{isAr ? 'المدفوع' : 'Paid'}</span><span>{formatCurrency(viewSale.paid_amount, currency, lang)}</span></div>
              {viewSale.total - viewSale.paid_amount > 0 && (
                <div className="flex justify-between text-sm text-ui-danger"><span>{isAr ? 'المتبقي' : 'Remaining'}</span><span>{formatCurrency(viewSale.total - viewSale.paid_amount, currency, lang)}</span></div>
              )}
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setViewSale(null)}>{t('cancel')}</Button>
              <Button onClick={saveSaleEdit}>{t('save')}</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Refund Modal */}
      <Modal open={!!refundSale} onClose={() => setRefundSale(null)} title={isAr ? 'مرتجع الفاتورة' : 'Invoice Refund'} size="lg">
        {refundSale && (
          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-ui-page-alt rounded-lg">
              <div>
                <p className="font-bold text-lg text-ui-text">{refundSale.invoice_number}</p>
                <p className="text-sm text-ui-subtle">{formatDateTime(refundSale.created_at, lang)}</p>
              </div>
              <span className="text-sm text-ui-subtle">{isAr ? 'إجمالي الفاتورة' : 'Invoice total'}: <b>{formatCurrency(refundSale.total, currency, lang)}</b></span>
            </div>

            <div className="overflow-x-auto border border-ui-border rounded-xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ui-border bg-ui-page-alt/60">
                    <th className="px-3 py-2 text-start text-xs font-medium text-ui-subtle">{t('productName')}</th>
                    <th className="px-3 py-2 text-start text-xs font-medium text-ui-subtle">{isAr ? 'كمية المرتجع' : 'Refund Qty'}</th>
                    <th className="px-3 py-2 text-start text-xs font-medium text-ui-subtle">{isAr ? 'قيمة المرتجع' : 'Refund Value'}</th>
                  </tr>
                </thead>
                <tbody>
                  {refundSale.sale_items?.map((item) => {
                    const remaining = item.quantity - (item.refunded_quantity || 0);
                    return (
                      <tr key={item.id} className="border-b border-ui-border">
                        <td className="px-3 py-2">
                          <p className="text-ui-text">{item.product?.name || '-'}</p>
                          <p className="text-xs text-ui-subtle">{isAr ? 'الكمية المبيعة' : 'Sold'}: {item.quantity}{item.refunded_quantity > 0 ? ` · ${isAr ? 'مرتجع' : 'refunded'}: ${item.refunded_quantity}` : ''}</p>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            max={remaining}
                            step="any"
                            value={refundQty[item.id] ?? ''}
                            onChange={(e) => setRefundQty({ ...refundQty, [item.id]: e.target.value })}
                            className="w-24 px-2 py-1.5 rounded-lg border border-ui-border bg-ui-surface text-sm text-ui-text focus:outline-none focus:ring-2 focus:ring-ui-primary"
                          />
                        </td>
                        <td className="px-3 py-2 font-medium text-ui-text">{formatCurrency(refundLineTotal(item), currency, lang)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <Textarea label={isAr ? 'سبب المرتجع (اختياري)' : 'Refund reason (optional)'} value={refundReason} onChange={(e) => setRefundReason(e.target.value)} rows={2} />

            <div className="flex justify-between items-center bg-ui-danger-soft rounded-lg px-4 py-3">
              <span className="font-semibold text-ui-danger">{isAr ? 'قيمة المرتجع الإجمالية' : 'Total refund'}</span>
              <span className="font-bold text-lg text-ui-danger">{formatCurrency(refundTotal(), currency, lang)}</span>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRefundSale(null)}>{t('cancel')}</Button>
              <Button onClick={submitRefund} disabled={refunding}>
                <RotateCcw className="w-4 h-4" /> {refunding ? '...' : (isAr ? 'تأكيد المرتجع' : 'Confirm Refund')}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={remove}
        title={isAr ? 'إخفاء الفاتورة المرتجعة' : 'Archive returned sale'}
        message={isAr ? 'ستختفي الفاتورة من شاشة المبيعات مع الاحتفاظ بأثر المرتجع والمخزون والقيود والطباعة.' : 'The sale will be hidden from the sales list while preserving refund, inventory, accounting and print history.'}
        confirmLabel={isAr ? 'إخفاء' : 'Archive'} cancelLabel={t('cancel')} />
      <ConfirmDialog open={deleteSelectedConfirm} onClose={() => setDeleteSelectedConfirm(false)} onConfirm={removeSelected}
        title={isAr ? 'إخفاء الفواتير المرتجعة' : 'Archive returned sales'}
        message={isAr ? 'سيتم إخفاء الفواتير المرتجعة بالكامل فقط مع الاحتفاظ بأثرها المالي.' : 'Only fully returned sales will be archived; financial history is preserved.'}
        confirmLabel={isAr ? 'إخفاء' : 'Archive'} cancelLabel={t('cancel')} />
    </DesignSurface>
  );
}
