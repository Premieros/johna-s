import { useEffect, useState, useMemo } from 'react';
import { Plus, Trash2, Eye, Download, Send, Check, X, PackageOpen, RotateCcw, Edit2 } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useAuth } from '@/context/AuthContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useToast } from '@/components/Toast';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel, DesignPagination } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { BranchBadge } from '@/components/BranchBadge';
import { formatCurrency, formatDate, generateInvoiceNumber } from '@/lib/format';
import { exportToExcel } from '@/lib/excel';
import { logAudit } from '@/lib/audit';
import { useCan } from '@/lib/permissions';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import { useOperationalGuard, PrerequisiteAlertBanner, PREREQUISITE_STEPS } from '@/core/guard';
import type { Purchase, Supplier, Product, Warehouse, RpcResult, RawMaterial } from '@/lib/types';

interface PurchaseFormItem {
  line_type: 'product' | 'raw';
  product_id: string;
  raw_material_id: string;
  unit_name: string;
  quantity: number;
  unit_cost: number;
}

type InlineRawUnit = { id: string; name: string; symbol?: string | null };

const EMPTY_LINE: PurchaseFormItem = { line_type: 'product', product_id: '', raw_material_id: '', unit_name: 'piece', quantity: 1, unit_cost: 0 };

export function PurchasesPage() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const branchFilter = useBranchFilter();
  const { show } = useToast();
  const can = useCan();
  const navigate = useNavigate();
  const { rows: items, loading, error, total, hasMore, loadMore, loadingMore, refresh: reloadPurchases } = usePaginatedRows<Purchase>({
    table: 'purchases',
    select: '*, supplier:suppliers(*)',
    order: { column: 'created_at', ascending: false },
    branch_id: branchFilter,
    pageSize: 100,
  });
  const { effectiveSettings } = useSettings();
  const { branches } = useBranches();
  const location = useLocation();
  const {
    guardPurchase,
    interceptDbError,
    startGuidance,
  } = useOperationalGuard();
  const currency = effectiveSettings(branchFilter)?.currency || 'EGP';
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [rawUnits, setRawUnits] = useState<InlineRawUnit[]>([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);
  const [viewModal, setViewModal] = useState<Purchase | null>(null);
  const [viewItems, setViewItems] = useState<{ name: string; quantity: number; unit_name: string; unit_cost: number; total: number }[]>([]);
  const [rawModalOpen, setRawModalOpen] = useState(false);
  const [rawTargetLine, setRawTargetLine] = useState<number | null>(null);
  const [rawForm, setRawForm] = useState({ code: '', name: '', unit_id: '' });

  const [form, setForm] = useState({
    supplier_id: '',
    warehouse_id: '',
    branch_id: '',
    payment_method: 'cash',
    notes: '',
  });
  const [lineItems, setLineItems] = useState<PurchaseFormItem[]>([{ ...EMPTY_LINE }]);

  async function loadMeta() {
    const [s, pr, rm, w, u] = await Promise.all([
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('products').select('*').eq('is_active', true).order('name'),
      supabase.from('raw_materials').select('*, unit:units(*)').eq('is_active', true).order('name'),
      supabase.from('warehouses').select('*').order('name'),
      supabase.from('measurement_units').select('id,name,symbol').eq('is_active', true).order('name'),
    ]);
    setSuppliers((s.data as Supplier[]) || []);
    setProducts((pr.data as Product[]) || []);
    setRawMaterials((rm.data as RawMaterial[]) || []);
    setWarehouses((w.data as Warehouse[]) || []);
    setRawUnits((u.data as InlineRawUnit[]) || []);
  }
  useEffect(() => { void loadMeta(); }, []);

  // Restore draft if returning from guided prerequisite setup
  useEffect(() => {
    const state = location.state as { restoredDraft?: { form?: typeof form; lineItems?: PurchaseFormItem[] }; fromGuidance?: boolean } | null;
    if (state?.fromGuidance && state?.restoredDraft) {
      if (state.restoredDraft.form) setForm((prev) => ({ ...prev, ...state.restoredDraft?.form }));
      if (state.restoredDraft.lineItems) setLineItems(state.restoredDraft.lineItems);
      setEditingPurchase(null);
      setModalOpen(true);
    }
  }, [location.state]);

  const filtered = items.filter((p) => !search || p.invoice_number.toLowerCase().includes(search.toLowerCase()) || (p as Purchase & { supplier?: Supplier }).supplier?.name.toLowerCase().includes(search.toLowerCase()));

  const subtotal = useMemo(() => lineItems.reduce((s, i) => s + i.quantity * i.unit_cost, 0), [lineItems]);

  const openAdd = () => {
    const allowed = guardPurchase({
      warehousesCount: warehouses.length,
      suppliersCount: suppliers.length,
      productsCount: products.length,
      rawMaterialsCount: rawMaterials.length,
      formData: { form, lineItems },
    });
    if (!allowed) return;

    setEditingPurchase(null);
    setForm({
      supplier_id: suppliers[0]?.id || '',
      warehouse_id: warehouses[0]?.id || '',
      branch_id: user?.branch_id || branches[0]?.id || '',
      payment_method: 'cash',
      notes: '',
    });
    setLineItems([{ ...EMPTY_LINE }]);
    setModalOpen(true);
  };

  const openEdit = async (purchase: Purchase) => {
    if (!can('purchases.manage') || purchase.status !== 'completed') return;
    const { data, error: itemsError } = await supabase
      .from('purchase_items')
      .select('product_id,raw_material_id,unit_name,quantity,unit_cost')
      .eq('purchase_id', purchase.id)
      .order('created_at');
    if (itemsError) { show(itemsError.message, 'error'); return; }

    const editableLines = ((data || []) as Array<Record<string, unknown>>).map((row) => ({
      line_type: row.raw_material_id ? 'raw' as const : 'product' as const,
      product_id: String(row.product_id || ''),
      raw_material_id: String(row.raw_material_id || ''),
      unit_name: String(row.unit_name || 'piece'),
      quantity: Number(row.quantity || 0),
      unit_cost: Number(row.unit_cost || 0),
    }));
    if (editableLines.length === 0) {
      show(lang === 'ar' ? 'لا توجد بنود قابلة للتعديل في الفاتورة' : 'No editable items were found for this invoice', 'error');
      return;
    }

    setEditingPurchase(purchase);
    setForm({
      supplier_id: purchase.supplier_id || '',
      warehouse_id: purchase.warehouse_id || '',
      branch_id: purchase.branch_id || '',
      payment_method: purchase.payment_method || 'cash',
      notes: purchase.notes || '',
    });
    setLineItems(editableLines);
    setViewModal(null);
    setModalOpen(true);
  };

  const addLine = () => setLineItems([...lineItems, { ...EMPTY_LINE }]);
  const updateLine = (i: number, field: keyof PurchaseFormItem, value: string | number) => setLineItems(lineItems.map((l, idx) => idx === i ? { ...l, [field]: value } : l));
  const removeLine = (i: number) => setLineItems(lineItems.filter((_, idx) => idx !== i));

  const rawUnitName = (id: string) => {
    const rm = rawMaterials.find((m) => m.id === id);
    return rm?.unit?.symbol || rm?.unit?.name || 'وحدة';
  };

  const purchaseUnitOptions = (id: string) => {
    const stockUnit = rawUnitName(id);
    const normalized = stockUnit.trim().toLowerCase();
    if (['جم', 'g', 'gr', 'gm', 'gram', 'grams'].includes(normalized)) {
      return [
        { value: 'جم', label: lang === 'ar' ? 'جرام' : 'g' },
        { value: 'kg', label: lang === 'ar' ? 'كيلوجرام' : 'kg' },
      ];
    }
    if (['كجم', 'كغ', 'كيلو', 'kg', 'kgs', 'kilogram', 'kilograms'].includes(normalized)) {
      return [
        { value: 'kg', label: lang === 'ar' ? 'كيلوجرام' : 'kg' },
        { value: 'جم', label: lang === 'ar' ? 'جرام' : 'g' },
      ];
    }
    if (['مل', 'ml', 'mil', 'milliliter', 'milliliters'].includes(normalized)) {
      return [
        { value: 'مل', label: lang === 'ar' ? 'مل' : 'ml' },
        { value: 'liter', label: lang === 'ar' ? 'لتر' : 'liter' },
      ];
    }
    if (['ل', 'لتر', 'l', 'lt', 'liter', 'litre', 'liters', 'litres'].includes(normalized)) {
      return [
        { value: 'liter', label: lang === 'ar' ? 'لتر' : 'liter' },
        { value: 'مل', label: lang === 'ar' ? 'مل' : 'ml' },
      ];
    }
    if (['قطعة', 'حبة', 'each', 'ea', 'pcs', 'pc', 'piece', 'pieces'].includes(normalized)) {
      return [{ value: 'قطعة', label: lang === 'ar' ? 'قطعة' : 'each' }];
    }
    if (['كيس', 'باكيت', 'packet', 'pack', 'bag'].includes(normalized)) {
      return [{ value: 'كيس', label: lang === 'ar' ? 'كيس' : 'packet' }];
    }
    return [{ value: stockUnit, label: stockUnit }];
  };

  const updateRawMaterial = (index: number, rawMaterialId: string) => {
    const defaultUnit = purchaseUnitOptions(rawMaterialId)[0]?.value || rawUnitName(rawMaterialId);
    setLineItems((current) => current.map((line, idx) => (
      idx === index ? { ...line, raw_material_id: rawMaterialId, unit_name: defaultUnit } : line
    )));
  };

  const openInlineRaw = (lineIndex: number) => {
    if (!can('raw_materials.create')) return;
    setRawTargetLine(lineIndex);
    setRawForm({ code: '', name: '', unit_id: '' });
    setRawModalOpen(true);
  };

  const saveInlineRaw = async () => {
    if (!can('raw_materials.create')) {
      show(lang === 'ar' ? 'لا تملك صلاحية إنشاء الخامات' : 'Raw-material create permission is required', 'error');
      return;
    }
    if (!rawForm.code.trim() || !rawForm.name.trim() || !rawForm.unit_id) {
      show(lang === 'ar' ? 'الكود واسم الخامة ووحدة القياس مطلوبة' : 'Code, raw-material name, and measurement unit are required', 'error');
      return;
    }
    if (!form.branch_id) {
      show(lang === 'ar' ? 'حدد الفرع أولًا' : 'Select the branch first', 'error');
      return;
    }

    const payload = {
      code: rawForm.code.trim(),
      name: rawForm.name.trim(),
      unit_id: rawForm.unit_id,
      category: null,
      min_stock: 0,
      default_cost: 0,
      description: null,
      branch_id: form.branch_id,
      is_active: true,
    };
    const { data, error: rawError } = await supabase.from('raw_materials').insert(payload).select('*').single();
    if (rawError) { show(rawError.message, 'error'); return; }

    const created = data as RawMaterial;
    const selectedUnit = rawUnits.find((unit) => unit.id === rawForm.unit_id);
    const createdWithUnit = {
      ...created,
      unit: selectedUnit ? { ...selectedUnit } : undefined,
    } as RawMaterial;
    setRawMaterials((current) => [...current, createdWithUnit].sort((a, b) => a.name.localeCompare(b.name)));

    if (rawTargetLine !== null) {
      const unitName = selectedUnit?.symbol || selectedUnit?.name || 'وحدة';
      setLineItems((current) => current.map((line, idx) => idx === rawTargetLine
        ? { ...line, line_type: 'raw', raw_material_id: created.id, product_id: '', unit_name: unitName }
        : line));
    }
    await logAudit('create', 'raw_materials', created.id, { unit_id: rawForm.unit_id, source: 'purchase_invoice' });
    setRawModalOpen(false);
    setRawTargetLine(null);
    show(lang === 'ar' ? 'تم إنشاء الخامة وإضافتها للفاتورة' : 'Raw material created and selected', 'success');
  };

  const save = async () => {
    const allowed = guardPurchase({
      warehousesCount: warehouses.length,
      suppliersCount: suppliers.length,
      productsCount: products.length,
      rawMaterialsCount: rawMaterials.length,
      formData: { form, lineItems },
    });
    if (!allowed) return;

    const validItems = lineItems.filter((l) => (l.line_type === 'product' ? l.product_id : l.raw_material_id) && l.quantity > 0);
    if (!form.supplier_id) { show(t('required') + ': ' + t('supplier'), 'error'); return; }
    if (validItems.length === 0) { show(t('required') + ': ' + t('addProduct'), 'error'); return; }
    const hasProductLines = validItems.some((l) => l.line_type === 'product');
    if (hasProductLines && !form.warehouse_id) { show(t('required') + ': ' + t('warehouse'), 'error'); return; }

    const totalValue = validItems.reduce((s, i) => s + i.quantity * i.unit_cost, 0);
    const rpcItems = validItems.map((i) => ({
      ...(i.line_type === 'raw' ? { raw_material_id: i.raw_material_id } : { product_id: i.product_id }),
      unit_name: i.unit_name || (i.line_type === 'raw' ? rawUnitName(i.raw_material_id) : 'piece'),
      quantity: i.quantity,
      unit_cost: i.unit_cost,
    }));

    if (editingPurchase) {
      const { data, error: updateError } = await api.trade.updatePurchase({
        p_purchase_id: editingPurchase.id,
        p_supplier_id: form.supplier_id,
        p_warehouse_id: form.warehouse_id || null,
        p_subtotal: totalValue,
        p_discount_amount: 0,
        p_tax_amount: 0,
        p_total: totalValue,
        p_paid_amount: totalValue,
        p_payment_method: form.payment_method,
        p_notes: form.notes,
        p_items: rpcItems,
      });
      if (updateError) {
        const handled = interceptDbError(updateError, 'purchase_edit', 'تعديل فاتورة مشتريات', 'Edit Purchase Invoice', { purchaseId: editingPurchase.id, form, lineItems });
        if (!handled) show(updateError.message, 'error');
        return;
      }
      const result = data as RpcResult | null;
      if (!result?.success) {
        show(result?.detail || result?.error || t('error'), 'error');
        return;
      }
      await logAudit('update', 'purchases', result.purchase_id || editingPurchase.id, { previous_purchase_id: editingPurchase.id, total: totalValue });
      show(lang === 'ar' ? 'تم تعديل فاتورة المشتريات بأمان' : 'Purchase invoice updated safely', 'success');
      setEditingPurchase(null);
      setModalOpen(false);
      reloadPurchases();
      return;
    }

    const { data: serialRes, error: serialError } = await api.trade.nextDocumentNumber({ p_type: 'purchase' });
    if (serialError || !serialRes?.success) {
      const handled = interceptDbError(serialError, 'purchase_create', 'تسجيل مشتريات', 'Create Purchase Invoice', { form, lineItems });
      if (!handled) {
        show(serialError?.message || (serialRes as { detail?: string } | null)?.detail || t('error'), 'error');
      }
      return;
    }
    const invoiceNumber = (serialRes as { number?: string }).number || generateInvoiceNumber('PUR');

    const { data, error } = await api.trade.processPurchase({
      p_invoice_number: invoiceNumber,
      p_supplier_id: form.supplier_id,
      p_branch_id: form.branch_id || null,
      p_warehouse_id: form.warehouse_id || null,
      p_subtotal: totalValue,
      p_discount_amount: 0,
      p_tax_amount: 0,
      p_total: totalValue,
      p_paid_amount: totalValue,
      p_payment_method: form.payment_method,
      p_status: 'completed',
      p_notes: form.notes,
      p_items: rpcItems,
    });
    if (error) {
      const handled = interceptDbError(error, 'purchase_create', 'تسجيل مشتريات', 'Create Purchase Invoice', { form, lineItems });
      if (!handled) {
        show(error.message, 'error');
      }
      return;
    }
    const result = data as RpcResult | null;
    if (!result?.success) {
      const handled = interceptDbError(result?.detail || result?.error, 'purchase_create', 'تسجيل مشتريات', 'Create Purchase Invoice', { form, lineItems });
      if (!handled) {
        show(result?.detail || result?.error || t('error'), 'error');
      }
      return;
    }

    await logAudit('create', 'purchases', result.purchase_id || '', { invoice: invoiceNumber, total: totalValue });
    show(t('saveSuccess'), 'success');
    setModalOpen(false);
    reloadPurchases();
  };

  const viewPurchase = async (p: Purchase) => {
    setViewModal(p);
    const { data } = await supabase.from('purchase_items').select('*, product:products(name), raw_material:raw_materials(name)').eq('purchase_id', p.id);
    setViewItems((data || []).map((i: Record<string, unknown>) => ({
      name: (i.product as { name: string })?.name || (i.raw_material as { name: string })?.name || '-',
      quantity: Number(i.quantity),
      unit_name: String(i.unit_name || ''),
      unit_cost: Number(i.unit_cost),
      total: Number(i.total),
    })));
  };

  const handleExport = () => exportToExcel(items.map((p) => ({ Invoice: p.invoice_number, Date: formatDate(p.created_at, lang), Supplier: (p as Purchase & { supplier?: Supplier }).supplier?.name || '', Total: p.total, Status: p.status })), 'purchases');

  const changeOrderStatus = async (p: Purchase, status: string) => {
    const { data, error: err } = await api.procurement.updatePurchaseOrderStatus({ p_purchase_id: p.id, p_status: status });
    if (err) { show(err.message, 'error'); return; }
    const result = data as RpcResult | null;
    if (!result?.success) { show(result?.detail || result?.error || t('error'), 'error'); return; }
    show(t('saveSuccess'), 'success');
    reloadPurchases();
  };

  const deletePurchase = async (p: Purchase) => {
    const confirmed = window.confirm(
      lang === 'ar'
        ? `${p.status === 'returned' ? 'حذف الفاتورة المرتجعة' : 'حذف فاتورة الشراء'} ${p.invoice_number} نهائيًا؟`
        : `Permanently delete ${p.status === 'returned' ? 'returned ' : ''}purchase invoice ${p.invoice_number}?`
    );
    if (!confirmed) return;

    if (p.status === 'submitted') {
      const { data, error: err } = await api.procurement.updatePurchaseOrderStatus({ p_purchase_id: p.id, p_status: 'cancelled' });
      if (err) { show(err.message, 'error'); return; }
      const result = data as RpcResult | null;
      if (!result?.success) { show(result?.detail || result?.error || t('error'), 'error'); return; }
    } else {
      const { data, error: err } = await api.trade.deletePurchase({ p_purchase_id: p.id });
      if (err) { show(err.message, 'error'); return; }
      const result = data as RpcResult | null;
      if (!result?.success) { show(result?.detail || result?.error || t('error'), 'error'); return; }
    }

    show(lang === 'ar' ? 'تم حذف فاتورة الشراء' : 'Purchase invoice deleted', 'success');
    if (viewModal?.id === p.id) setViewModal(null);
    reloadPurchases();
  };

  const reversePurchase = async (p: Purchase) => {
    const confirmed = window.confirm(
      lang === 'ar'
        ? `سيتم عمل مرتجع كامل للفاتورة ${p.invoice_number} وعكس المخزون والأثر المحاسبي. هل تريد المتابعة؟`
        : `This will fully return ${p.invoice_number} and reverse its inventory/accounting impact. Continue?`
    );
    if (!confirmed) return;

    const reason = window.prompt(
      lang === 'ar' ? 'سبب إلغاء/عكس فاتورة الشراء:' : 'Reason for reversing this purchase invoice:',
      lang === 'ar' ? 'إلغاء فاتورة شراء' : 'Purchase invoice reversal'
    );
    if (reason === null) return;

    const { data, error: err } = await api.trade.processPurchaseReturn({
      p_purchase_id: p.id,
      p_items: null,
      p_reason: reason.trim() || (lang === 'ar' ? 'إلغاء فاتورة شراء' : 'Purchase invoice reversal'),
    });
    if (err) { show(err.message, 'error'); return; }
    const result = data as RpcResult | null;
    if (!result?.success) { show(result?.detail || result?.error || t('error'), 'error'); return; }

    show(lang === 'ar' ? 'تم عكس فاتورة الشراء بالكامل' : 'Purchase invoice fully reversed', 'success');
    if (viewModal?.id === p.id) setViewModal(null);
    reloadPurchases();
  };

  const canReversePurchase = can('purchases.manage');
  const purchaseStatusLabel = (status: string) => {
    const labels: Record<string, { ar: string; en: string }> = {
      draft: { ar: 'مسودة', en: 'Draft' },
      submitted: { ar: 'مرسلة', en: 'Submitted' },
      approved: { ar: 'معتمدة', en: 'Approved' },
      partial: { ar: 'استلام جزئي', en: 'Partial' },
      completed: { ar: 'مكتملة', en: 'Completed' },
      cancelled: { ar: 'ملغاة', en: 'Cancelled' },
      returned: { ar: 'مرتجع', en: 'Returned' },
    };
    return labels[status]?.[lang === 'ar' ? 'ar' : 'en'] || status;
  };

  const columns: Column<Purchase>[] = [
    { key: 'invoice_number', header: t('invoice'), render: (p) => <span className="font-medium text-ui-text">{p.invoice_number}</span> },
    { key: 'supplier', header: t('supplier'), render: (p) => (p as Purchase & { supplier?: Supplier }).supplier?.name || '-' },
    { key: 'branch', header: t('branch'), render: (p) => <BranchBadge name={branches.find((b) => b.id === p.branch_id)?.name || '-'} /> },
    { key: 'created_at', header: t('date'), render: (p) => formatDate(p.created_at, lang) },
    { key: 'total', header: t('total'), render: (p) => <span className="font-semibold text-ui-text">{formatCurrency(p.total, currency, lang)}</span> },
    { key: 'status', header: t('status'), render: (p) => <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.status === 'returned' ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300' : 'bg-ui-success-soft text-ui-success'}`}>{purchaseStatusLabel(p.status)}</span> },
    { key: 'actions', header: t('actions'), render: (p) => (
      <div className="flex items-center gap-1 justify-end">
        {p.status === 'draft' && can('purchases.manage') && (
          <button title={t('submitOrder')} onClick={() => changeOrderStatus(p, 'submitted')} className="p-1.5 rounded-md hover:bg-ui-info-soft text-ui-info"><Send className="w-4 h-4" /></button>
        )}
        {p.status === 'submitted' && can('purchases.manage') && (
          <button title={t('approveOrder')} onClick={() => changeOrderStatus(p, 'approved')} className="p-1.5 rounded-md hover:bg-ui-success-soft text-ui-success"><Check className="w-4 h-4" /></button>
        )}
        {['draft', 'submitted'].includes(p.status) && can('purchases.manage') && (
          <button title={t('cancel')} onClick={() => changeOrderStatus(p, 'cancelled')} className="p-1.5 rounded-md hover:bg-ui-page-alt dark:hover:bg-ui-page-alt text-ui-subtle"><X className="w-4 h-4" /></button>
        )}
        {['approved', 'submitted', 'partial'].includes(p.status) && can('purchases.receiving') && (
          <button title={t('receive')} onClick={() => navigate('/purchases/receiving')} className="p-1.5 rounded-md hover:bg-purple-50 dark:hover:bg-purple-900/20 text-purple-500"><PackageOpen className="w-4 h-4" /></button>
        )}
        {p.status === 'completed' && can('purchases.manage') && (
          <button
            title={lang === 'ar' ? 'تعديل فاتورة المشتريات' : 'Edit purchase invoice'}
            onClick={(e) => { e.stopPropagation(); void openEdit(p); }}
            className="p-1.5 rounded-md hover:bg-ui-info-soft text-ui-info"
          >
            <Edit2 className="w-4 h-4" />
          </button>
        )}
        {['draft', 'submitted', 'cancelled', 'returned'].includes(p.status) && can('purchases.delete') && (
          <button
            title={lang === 'ar' ? (p.status === 'returned' ? 'حذف الفاتورة المرتجعة' : 'حذف فاتورة الشراء') : (p.status === 'returned' ? 'Delete returned purchase invoice' : 'Delete purchase invoice')}
            onClick={(e) => { e.stopPropagation(); void deletePurchase(p); }}
            className="p-1.5 rounded-md hover:bg-ui-danger-soft text-ui-danger"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
        {p.status === 'completed' && canReversePurchase && (
          <button
            title={lang === 'ar' ? 'إلغاء/عكس فاتورة الشراء' : 'Reverse purchase invoice'}
            onClick={(e) => { e.stopPropagation(); void reversePurchase(p); }}
            className="p-1.5 rounded-md hover:bg-amber-50 dark:hover:bg-amber-900/20 text-amber-600"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        )}
        <button onClick={() => viewPurchase(p)} className="p-1.5 rounded-md hover:bg-ui-info-soft text-ui-info"><Eye className="w-4 h-4" /></button>
      </div>
    )},
  ];

  return (
    <DesignSurface testId="purchases-page">
      <DesignPageHeader title={t('purchases')} actions={
        <>
          <Button variant="outline" size="sm" onClick={handleExport}><Download className="w-4 h-4" /> {t('exportExcel')}</Button>
          {can('purchases.manage') && (
            <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4" /> {t('add')}</Button>
          )}
        </>
      } />

      {warehouses.length === 0 && !loading && (
        <PrerequisiteAlertBanner
          step={PREREQUISITE_STEPS.create_warehouse}
          onAction={() =>
            startGuidance(
              PREREQUISITE_STEPS.create_warehouse,
              'purchase_create',
              location.pathname,
              { form, lineItems },
              'تسجيل مشتريات',
              'Purchase Invoices'
            )
          }
        />
      )}

      {suppliers.length === 0 && !loading && (
        <PrerequisiteAlertBanner
          step={PREREQUISITE_STEPS.create_supplier}
          onAction={() =>
            startGuidance(
              PREREQUISITE_STEPS.create_supplier,
              'purchase_create',
              location.pathname,
              { form, lineItems },
              'تسجيل مشتريات',
              'Purchase Invoices'
            )
          }
        />
      )}

      <DesignPanel testId="purchases-search-panel">
        <DesignSearch value={search} onChange={setSearch} label={t('search')} placeholder={t('search')} testId="purchases-search" />
      </DesignPanel>
      <DesignPanel testId="purchases-table-panel">
        <DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')} onRowClick={viewPurchase} />
        <DesignPagination loaded={items.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} />
      </DesignPanel>

      {/* Add / Edit Purchase Modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingPurchase(null); }}
        title={editingPurchase ? (lang === 'ar' ? `تعديل فاتورة ${editingPurchase.invoice_number}` : `Edit ${editingPurchase.invoice_number}`) : t('purchaseInvoice')}
        size="xl"
      >
        <div className="space-y-4">
          {editingPurchase && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
              {lang === 'ar'
                ? 'سيتم عكس النسخة الحالية وإعادة تسجيل النسخة المصححة داخل عملية واحدة آمنة، مع الاحتفاظ بالنسخة السابقة كمرتجع للمراجعة.'
                : 'The current version will be reversed and the corrected version posted atomically; the prior version remains as a returned audit revision.'}
            </div>
          )}
          <div className="grid grid-cols-2 gap-4">
            <Select label={t('supplier')} value={form.supplier_id} onChange={(e) => setForm({ ...form, supplier_id: e.target.value })} required>
              <option value="">--</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
            <Select label={t('warehouse')} value={form.warehouse_id} onChange={(e) => setForm({ ...form, warehouse_id: e.target.value })}>
              <option value="">--</option>
              {warehouses.filter((w) => !form.branch_id || w.branch_id === form.branch_id).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
            <Select label={t('branch')} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })} disabled={!!editingPurchase}>
              <option value="">--</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
            <Select label={t('paymentMethod')} value={form.payment_method} onChange={(e) => setForm({ ...form, payment_method: e.target.value })}>
              <option value="cash">{t('cash')}</option>
              <option value="card">{t('card')}</option>
              <option value="transfer">{t('transfer')}</option>
              <option value="credit">{t('credit')}</option>
            </Select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-ui-muted">{t('addProduct')}</h3>
              <Button size="sm" variant="outline" onClick={addLine}><Plus className="w-4 h-4" /> {t('add')}</Button>
            </div>
            <div className="space-y-2">
              {lineItems.map((l, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <select value={l.line_type} onChange={(e) => updateLine(i, 'line_type', e.target.value)} className="col-span-2 rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm">
                    <option value="product">{t('product')}</option>
                    <option value="raw">{t('rawMaterial')}</option>
                  </select>
                  <div className="col-span-3">
                    {l.line_type === 'product' ? (
                      <select value={l.product_id} onChange={(e) => updateLine(i, 'product_id', e.target.value)} className="w-full rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm">
                        <option value="">--</option>
                        {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                      </select>
                    ) : (
                      <div className="flex gap-1">
                        <select value={l.raw_material_id} onChange={(e) => updateRawMaterial(i, e.target.value)} className="min-w-0 flex-1 rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm">
                          <option value="">--</option>
                          {rawMaterials.map((rm) => <option key={rm.id} value={rm.id}>{rm.name}</option>)}
                        </select>
                        {can('raw_materials.create') && (
                          <button
                            type="button"
                            title={lang === 'ar' ? 'إنشاء خامة جديدة' : 'Create raw material'}
                            onClick={() => openInlineRaw(i)}
                            className="shrink-0 rounded-md border border-ui-border px-2 text-ui-info hover:bg-ui-info-soft"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {l.line_type === 'raw' ? (
                    <select
                      value={l.unit_name}
                      onChange={(e) => updateLine(i, 'unit_name', e.target.value)}
                      className="col-span-2 rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm"
                      title={`${lang === 'ar' ? 'وحدة الشراء' : 'Purchase unit'} · ${lang === 'ar' ? 'وحدة التخزين' : 'Stock unit'}: ${rawUnitName(l.raw_material_id)}`}
                    >
                      {purchaseUnitOptions(l.raw_material_id).map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}
                    </select>
                  ) : (
                    <input value={l.unit_name} onChange={(e) => updateLine(i, 'unit_name', e.target.value)} className="col-span-2 rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm" placeholder={lang === 'ar' ? 'الوحدة' : 'Unit'} />
                  )}
                  <input type="number" placeholder={t('quantity')} value={l.quantity || ''} onChange={(e) => updateLine(i, 'quantity', parseFloat(e.target.value) || 0)} className="col-span-1 rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm" />
                  <input type="number" placeholder={t('cost')} step="0.01" value={l.unit_cost || ''} onChange={(e) => updateLine(i, 'unit_cost', parseFloat(e.target.value) || 0)} className="col-span-2 rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm" />
                  <span className="col-span-1 text-sm text-ui-muted text-end">{formatCurrency(l.quantity * l.unit_cost, currency, lang)}</span>
                  <button onClick={() => removeLine(i)} className="col-span-1 p-1.5 text-ui-danger hover:bg-ui-danger-soft rounded-md"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-between items-center pt-2 border-t border-ui-border">
            <span className="text-lg font-bold">{t('total')}: {formatCurrency(subtotal, currency, lang)}</span>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => { setModalOpen(false); setEditingPurchase(null); }}>{t('cancel')}</Button>
              <Button onClick={save}>{editingPurchase ? (lang === 'ar' ? 'حفظ التعديل' : 'Save changes') : t('save')}</Button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal open={rawModalOpen} onClose={() => setRawModalOpen(false)} title={lang === 'ar' ? 'إضافة خامة أثناء الفاتورة' : 'Add raw material'} size="sm">
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-ui-muted">{lang === 'ar' ? 'كود الخامة' : 'Raw code'}</label>
            <input value={rawForm.code} onChange={(e) => setRawForm({ ...rawForm, code: e.target.value })} className="w-full rounded-md border border-ui-border bg-ui-surface px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ui-muted">{lang === 'ar' ? 'اسم الخامة' : 'Raw-material name'}</label>
            <input value={rawForm.name} onChange={(e) => setRawForm({ ...rawForm, name: e.target.value })} className="w-full rounded-md border border-ui-border bg-ui-surface px-3 py-2 text-sm" />
          </div>
          <Select label={lang === 'ar' ? 'وحدة القياس' : 'Measurement unit'} value={rawForm.unit_id} onChange={(e) => setRawForm({ ...rawForm, unit_id: e.target.value })} required>
            <option value="">--</option>
            {rawUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}{unit.symbol ? ` (${unit.symbol})` : ''}</option>)}
          </Select>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRawModalOpen(false)}>{t('cancel')}</Button>
            <Button onClick={saveInlineRaw}>{t('save')}</Button>
          </div>
        </div>
      </Modal>

      {/* View Purchase Modal */}
      <Modal open={!!viewModal} onClose={() => setViewModal(null)} title={t('purchaseInvoice')} size="lg">
        {viewModal && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-ui-subtle">{t('invoice')}: </span><span className="font-medium">{viewModal.invoice_number}</span></div>
              <div><span className="text-ui-subtle">{t('date')}: </span><span className="font-medium">{formatDate(viewModal.created_at, lang)}</span></div>
              <div><span className="text-ui-subtle">{t('supplier')}: </span><span className="font-medium">{(viewModal as Purchase & { supplier?: Supplier }).supplier?.name || '-'}</span></div>
              <div><span className="text-ui-subtle">{t('paymentMethod')}: </span><span className="font-medium capitalize">{viewModal.payment_method}</span></div>
              <div><span className="text-ui-subtle">{t('status')}: </span><span className={`font-semibold ${viewModal.status === 'returned' ? 'text-amber-700 dark:text-amber-300' : ''}`}>{purchaseStatusLabel(viewModal.status)}</span></div>
            </div>
            <div className="border-t border-ui-border pt-3">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-ui-border">
                  <th className="text-start py-2 font-semibold text-ui-muted">{t('productName')}</th>
                  <th className="text-center py-2 font-semibold text-ui-muted">{t('quantity')}</th>
                  <th className="text-center py-2 font-semibold text-ui-muted">{t('cost')}</th>
                  <th className="text-end py-2 font-semibold text-ui-muted">{t('total')}</th>
                </tr></thead>
                <tbody>
                  {viewItems.map((i, idx) => (
                    <tr key={idx} className="border-b border-ui-border">
                      <td className="py-2 text-ui-text">{i.name}</td>
                      <td className="py-2 text-center text-ui-text">{i.quantity} {i.unit_name}</td>
                      <td className="py-2 text-center text-ui-text">{formatCurrency(i.unit_cost, currency, lang)}</td>
                      <td className="py-2 text-end font-medium text-ui-text">{formatCurrency(i.total, currency, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-between text-lg font-bold pt-2 border-t border-ui-border">
              <span>{t('total')}</span>
              <span className="text-brand-600 dark:text-brand-400">{formatCurrency(viewModal.total, currency, lang)}</span>
            </div>
            {viewModal.status === 'completed' && can('purchases.manage') && (
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => void openEdit(viewModal)}><Edit2 className="h-4 w-4" /> {lang === 'ar' ? 'تعديل الفاتورة' : 'Edit invoice'}</Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </DesignSurface>
  );
}