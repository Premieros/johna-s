import { useEffect, useRef, useState } from 'react';
import { ClipboardCheck, Plus, Eye, Send, CheckCircle2, XCircle, CheckCheck, Trash2, Download, Upload } from 'lucide-react';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useCan } from '@/lib/permissions';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useHistoryAccess } from '@/lib/useHistoryAccess';
import { DesignSurface, DesignPageHeader, DesignSearch, DesignPanel, DesignPagination } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { formatNumber, formatDateTime } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { exportToExcelAdvanced, importFromExcel } from '@/lib/excel';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import type { StockCount, StockCountItem, Branch, Warehouse, Product, RawMaterial } from '@/lib/types';
import { loadRawMaterialWarehouseSnapshot, loadStockCountMetadata } from '../services/stockCountData';
import { buildStockCountExcelRows, parseStockCountExcelRows, stockCountExcelColumns } from '../utils/stockCountExcel';

interface EditLine {
  product_id: string;
  counted_quantity: string;
  reason: string;
}

type CreateLine = { item_id: string; counted_quantity: string; reason: string };
type StockCountItemWithCost = StockCountItem & { unit_cost?: number | string | null };

export function StockCountsPage() {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';
  const { show } = useToast();
  const can = useCan();
  const branchFilter = useBranchFilter();
  const history = useHistoryAccess();

  const { rows: counts, loading, error, total, hasMore, loadMore, loadingMore, refresh: reloadCounts } = usePaginatedRows<StockCount>({
    table: 'stock_counts',
    select: '*, branch:branches(*), warehouse:warehouses(*), items:stock_count_items(*, product:products(*), raw_material:raw_materials(*)), created_user:users!stock_counts_created_by_fkey(id, full_name, email)',
    order: { column: 'created_at', ascending: false },
    or: history.minIso ? `created_at.gte.${history.minIso},status.in.(draft,submitted,approved)` : undefined,
    pageSize: 100,
  });

  const [branches, setBranches] = useState<Branch[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [branchId, setBranchId] = useState(branchFilter || '');

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ branch_id: '', warehouse_id: '', count_type: 'full', notes: '' });
  const [formItems, setFormItems] = useState<CreateLine[]>([{ item_id: '', counted_quantity: '', reason: '' }]);

  const [viewTarget, setViewTarget] = useState<StockCount | null>(null);
  const [editTarget, setEditTarget] = useState<StockCount | null>(null);
  const [editLines, setEditLines] = useState<EditLine[]>([]);
  const [confirmTarget, setConfirmTarget] = useState<{ count: StockCount; action: 'submit' | 'approve' | 'reject' | 'apply' } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const countExcelInputRef = useRef<HTMLInputElement>(null);

  const statusOptions = [
    { key: 'draft', label: t('countStatusDraft') },
    { key: 'submitted', label: t('countStatusSubmitted') },
    { key: 'approved', label: t('countStatusApproved') },
    { key: 'applied', label: t('countStatusApplied') },
    { key: 'rejected', label: t('countStatusRejected') },
  ];
  const typeOptions = [
    { key: 'full', label: t('countFull') },
    { key: 'partial', label: t('countPartial') },
    { key: 'cycle', label: t('countCycle') },
  ];

  const visibleBranches = branchFilter ? branches.filter((b) => b.id === branchFilter) : branches;
  const formRawMaterials = form.branch_id ? rawMaterials.filter((r) => r.branch_id === form.branch_id) : [];
  const editProducts = editTarget ? products.filter((p) => p.branch_id === editTarget.branch_id) : [];

  async function loadMeta() {
    const metadata = await loadStockCountMetadata();
    setBranches(metadata.branches);
    setWarehouses(metadata.warehouses);
    setProducts(metadata.products);
    setRawMaterials(metadata.rawMaterials);
  }
  useEffect(() => { loadMeta(); }, []);

  useEffect(() => {
    if (!createOpen) return;
    setForm((current) => {
      const candidateBranches = branchFilter ? branches.filter((b) => b.id === branchFilter) : branches;
      const nextBranchId = current.branch_id || branchFilter || (candidateBranches.length === 1 ? candidateBranches[0].id : '');
      if (!nextBranchId) return current;
      const branchWarehouses = warehouses.filter((w) => w.branch_id === nextBranchId);
      const nextWarehouseId = current.warehouse_id || (branchWarehouses.length === 1 ? branchWarehouses[0].id : '');
      if (nextBranchId === current.branch_id && nextWarehouseId === current.warehouse_id) return current;
      return { ...current, branch_id: nextBranchId, warehouse_id: nextWarehouseId };
    });
  }, [createOpen, branchFilter, branches, warehouses]);

  const filtered = counts.filter((c) => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    if (branchId && c.branch_id !== branchId) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return (c.count_number || '').toLowerCase().includes(q)
      || (c.branch?.name || '').toLowerCase().includes(q)
      || (c.warehouse?.name || '').toLowerCase().includes(q);
  });

  const resetCreateLines = () => setFormItems([{ item_id: '', counted_quantity: '', reason: '' }]);

  const openCreate = () => {
    const defaultBranchId = branchFilter || (visibleBranches.length === 1 ? visibleBranches[0].id : '');
    const branchWarehouses = warehouses.filter((w) => w.branch_id === defaultBranchId);
    setForm({ branch_id: defaultBranchId, warehouse_id: branchWarehouses.length === 1 ? branchWarehouses[0].id : '', count_type: 'full', notes: '' });
    resetCreateLines();
    setCreateOpen(true);
  };

  const addFormItem = () => setFormItems([...formItems, { item_id: '', counted_quantity: '', reason: '' }]);
  const updateFormItem = (idx: number, field: keyof CreateLine, value: string) => setFormItems(formItems.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  const removeFormItem = (idx: number) => setFormItems(formItems.filter((_, i) => i !== idx));


  const handleCountExcelExport = async () => {
    if (!form.branch_id || !form.warehouse_id) {
      show(isAr ? 'اختر الفرع والمخزن أولاً قبل سحب ملف الجرد.' : 'Select branch and warehouse before exporting the count sheet.', 'error');
      return;
    }

    try {
      const snapshot = await loadRawMaterialWarehouseSnapshot(form.branch_id, form.warehouse_id);
      const branchName = branches.find((b) => b.id === form.branch_id)?.name || '';
      const warehouseName = warehouses.find((w) => w.id === form.warehouse_id)?.name || '';
      const columns = stockCountExcelColumns(isAr);
      await exportToExcelAdvanced({
        data: buildStockCountExcelRows({
          materials: formRawMaterials,
          snapshot,
          branchId: form.branch_id,
          warehouseId: form.warehouse_id,
          isAr,
        }),
        filename: `stock-count-${branchName || form.branch_id}-${warehouseName || form.warehouse_id}-${new Date().toISOString().slice(0, 10)}`,
        sheetName: isAr ? 'جرد الخامات' : 'Raw Material Count',
        columns: [
          columns.rawMaterialId,
          columns.code,
          columns.name,
          columns.systemQuantity,
          columns.countedQuantity,
          columns.reason,
          columns.branchId,
          columns.warehouseId,
        ],
        columnWidths: {
          [columns.rawMaterialId]: 38,
          [columns.code]: 18,
          [columns.name]: 32,
          [columns.systemQuantity]: 16,
          [columns.countedQuantity]: 18,
          [columns.reason]: 30,
          [columns.branchId]: 38,
          [columns.warehouseId]: 38,
        },
      });
    } catch (err) {
      show(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleCountExcelImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!form.branch_id || !form.warehouse_id) {
      show(isAr ? 'اختر الفرع والمخزن أولاً قبل رفع ملف الجرد.' : 'Select branch and warehouse before importing the count sheet.', 'error');
      return;
    }

    try {
      const rows = await importFromExcel(file);
      const parsed = parseStockCountExcelRows({
        rows,
        materials: formRawMaterials,
        branchId: form.branch_id,
        warehouseId: form.warehouse_id,
        requireComplete: form.count_type === 'full',
        isAr,
      });

      if (parsed.errors.length > 0) {
        const preview = parsed.errors.slice(0, 5).join('\n');
        const more = parsed.errors.length > 5
          ? (isAr ? `\n… و${parsed.errors.length - 5} أخطاء أخرى` : `\n… and ${parsed.errors.length - 5} more errors`)
          : '';
        show(preview + more, 'error');
        return;
      }
      if (parsed.lines.length === 0) {
        show(isAr ? 'لم يتم العثور على أي كمية فعلية في ملف الجرد.' : 'No counted quantities were found in the stock-count file.', 'error');
        return;
      }

      setFormItems(parsed.lines);
      show(
        isAr
          ? `تم تحميل ${parsed.lines.length} خامة إلى مسودة الجرد. لم يتم تعديل المخزون بعد.`
          : `Loaded ${parsed.lines.length} materials into the draft count. Stock has not been changed yet.`,
        'success',
      );
    } catch (err) {
      show(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const createCount = async () => {
    if (!form.branch_id || !form.warehouse_id) { show(t('required') + ': ' + t('branch') + ' / ' + t('warehouse'), 'error'); return; }
    const activeForWarehouse = counts.find((count) =>
      count.warehouse_id === form.warehouse_id
      && (count.status === 'draft' || count.status === 'submitted' || count.status === 'approved')
    );
    if (activeForWarehouse) {
      show(
        isAr
          ? `يوجد جرد نشط بالفعل لهذا المخزن (${activeForWarehouse.count_number || activeForWarehouse.status}). يجب إنهاؤه أو رفضه قبل إنشاء جرد جديد.`
          : `An active stock count already exists for this warehouse (${activeForWarehouse.count_number || activeForWarehouse.status}). Finish or reject it before creating another count.`,
        'error',
      );
      return;
    }

    const selectedLines = formItems.filter((line) => line.item_id);
    const seen = new Set<string>();
    for (const line of selectedLines) {
      if (seen.has(line.item_id)) {
        const materialName = formRawMaterials.find((material) => material.id === line.item_id)?.name || line.item_id;
        show(isAr ? `الخامة "${materialName}" مكررة في مسودة الجرد.` : `Raw material "${materialName}" is duplicated in the count draft.`, 'error');
        return;
      }
      seen.add(line.item_id);
      const quantity = Number(line.counted_quantity);
      if (line.counted_quantity.trim() === '' || !Number.isFinite(quantity) || quantity < 0) {
        const materialName = formRawMaterials.find((material) => material.id === line.item_id)?.name || line.item_id;
        show(isAr ? `أدخل كمية فعلية صحيحة للخامة "${materialName}".` : `Enter a valid counted quantity for "${materialName}".`, 'error');
        return;
      }
    }

    if (form.count_type === 'full') {
      const countedIds = new Set(selectedLines.map((line) => line.item_id));
      const missing = formRawMaterials.filter((material) => !countedIds.has(material.id));
      if (missing.length > 0) {
        const preview = missing.slice(0, 5).map((material) => material.name).join('، ');
        show(
          isAr
            ? `الجرد الكامل غير مكتمل. متبقي ${missing.length} خامة: ${preview}${missing.length > 5 ? '…' : ''}`
            : `Full count is incomplete. Missing ${missing.length} materials: ${preview}${missing.length > 5 ? '…' : ''}`,
          'error',
        );
        return;
      }
    }

    const items = selectedLines.map((line) => ({
      product_id: null,
      raw_material_id: line.item_id,
      counted_quantity: Number(line.counted_quantity),
      reason: line.reason || null,
    }));
    const { data, error: err } = await api.inventory.createStockCount({ p_branch_id: form.branch_id, p_warehouse_id: form.warehouse_id, p_count_type: form.count_type, p_notes: form.notes || null, p_items: items.length > 0 ? items : null });
    if (err) { show(err.message, 'error'); return; }
    const result = data as { success: boolean; error?: string; detail?: string } | null;
    if (!result?.success) { show(result?.detail || result?.error || t('error'), 'error'); return; }
    show(t('countSaved'), 'success');
    setCreateOpen(false);
    reloadCounts();
  };

  const openEdit = (count: StockCount) => {
    setEditTarget(count);
    setEditLines((count.items || []).map((it) => ({ product_id: it.product_id || '', counted_quantity: String(it.counted_quantity), reason: it.reason || '' })));
  };
  const addEditLine = () => setEditLines([...editLines, { product_id: '', counted_quantity: '', reason: '' }]);
  const updateEditLine = (idx: number, field: keyof EditLine, value: string) => setEditLines(editLines.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  const removeEditLine = (idx: number) => setEditLines(editLines.filter((_, i) => i !== idx));

  const saveEdit = async () => {
    if (!editTarget) return;
    const original = new Map((editTarget.items || []).filter((it) => it.product_id).map((it) => [it.product_id as string, String(it.counted_quantity)]));
    for (const line of editLines) {
      if (!line.product_id) continue;
      const hasCount = line.counted_quantity.trim() !== '';
      const qty = parseFloat(line.counted_quantity);
      if (original.has(line.product_id)) {
        if (original.get(line.product_id) !== line.counted_quantity || line.reason) await api.inventory.updateStockCountItem({ p_stock_count_id: editTarget.id, p_product_id: line.product_id, p_counted_quantity: hasCount && !Number.isNaN(qty) ? qty : null, p_reason: line.reason || null });
      } else if (hasCount && !Number.isNaN(qty)) {
        await api.inventory.addStockCountItem({ p_stock_count_id: editTarget.id, p_product_id: line.product_id, p_counted_quantity: qty, p_reason: line.reason || null });
      }
    }
    const kept = new Set(editLines.filter((l) => l.product_id).map((l) => l.product_id));
    for (const it of editTarget.items || []) if (it.product_id && !kept.has(it.product_id)) await api.inventory.removeStockCountItem({ p_stock_count_id: editTarget.id, p_product_id: it.product_id });
    show(t('countSaved'), 'success');
    setEditTarget(null);
    reloadCounts();
  };

  const runWorkflow = async (action: 'submit' | 'approve' | 'reject' | 'apply') => {
    if (!confirmTarget) return;
    const { count } = confirmTarget;
    const id = count.id;
    let res: { data: { success?: boolean; error?: string; detail?: string } | null; error?: { message: string } | null };
    if (action === 'submit') res = await api.inventory.submitStockCount({ p_stock_count_id: id });
    else if (action === 'approve') res = await api.inventory.approveStockCount({ p_stock_count_id: id });
    else if (action === 'reject') res = await api.inventory.rejectStockCount({ p_stock_count_id: id, p_reason: rejectReason || null });
    else res = await api.inventory.applyStockCount({ p_stock_count_id: id });
    if (res.error) { show(res.error.message, 'error'); return; }
    if (!res.data?.success) { show(res.data?.detail || res.data?.error || t('error'), 'error'); return; }
    const keyMap = { submit: 'countSubmitted', approve: 'countApproved', reject: 'countRejected', apply: 'countApplied' } as const;
    show(t(keyMap[action as keyof typeof keyMap]), 'success');
    await logAudit('update', 'stock_counts', id, { action, count_number: count.count_number });
    setConfirmTarget(null); setRejectReason(''); reloadCounts();
  };

  const statusPill = (status: string) => {
    const map: Record<string, string> = { draft: 'bg-ui-page-alt text-ui-muted', submitted: 'bg-ui-info-soft text-ui-info', approved: 'bg-ui-success-soft text-ui-success dark:text-ui-success', applied: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400', rejected: 'bg-ui-danger-soft text-ui-danger' };
    const label = statusOptions.find((s) => s.key === status)?.label || status;
    return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] || map.draft}`}>{label}</span>;
  };
  const typePill = (type: string) => <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-ui-page-alt text-ui-muted">{typeOptions.find((x) => x.key === type)?.label || type}</span>;

  const columns: Column<StockCount>[] = [
    { key: 'number', header: t('countNumber'), render: (c) => <div className="text-sm"><p className="font-medium text-ui-text">{c.count_number || '#' + String(c.id).slice(0, 8)}</p><p className="text-xs text-ui-subtle">{formatDateTime(c.created_at, lang)}</p></div> },
    { key: 'branch', header: t('branch'), render: (c) => c.branch?.name || '-' },
    { key: 'warehouse', header: t('warehouse'), render: (c) => c.warehouse?.name || '-' },
    { key: 'count_type', header: t('countType'), render: (c) => typePill(c.count_type) },
    { key: 'items_count', header: t('countItems'), render: (c) => c.items?.length || 0 },
    { key: 'status', header: t('status'), render: (c) => statusPill(c.status) },
    { key: 'actions', header: t('actions'), render: (c) => {
      const hasRaw = (c.items || []).some((i) => !!i.raw_material_id);
      return <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => setViewTarget(c)} className="p-1.5 rounded-md hover:bg-ui-page-alt text-ui-subtle" title={t('viewCountItems')}><Eye className="w-4 h-4" /></button>
        {can('inventory.count.create') && c.status === 'draft' && <>{!hasRaw && <button onClick={() => openEdit(c)} className="p-1.5 rounded-md hover:bg-ui-info-soft text-ui-info" title={t('addCountItem')}><Plus className="w-4 h-4" /></button>}<button onClick={() => setConfirmTarget({ count: c, action: 'submit' })} className="p-1.5 rounded-md hover:bg-ui-success-soft text-ui-success" title={t('submitCount')}><Send className="w-4 h-4" /></button></>}
        {can('inventory.count.approve') && c.status === 'submitted' && <button onClick={() => setConfirmTarget({ count: c, action: 'approve' })} className="p-1.5 rounded-md hover:bg-ui-success-soft text-ui-success" title={t('approveCount')}><CheckCircle2 className="w-4 h-4" /></button>}
        {can('inventory.count.reject') && c.status === 'submitted' && <button onClick={() => { setConfirmTarget({ count: c, action: 'reject' }); setRejectReason(''); }} className="p-1.5 rounded-md hover:bg-ui-danger-soft text-ui-danger" title={t('rejectCount')}><XCircle className="w-4 h-4" /></button>}
        {can('inventory.count.apply') && c.status === 'approved' && <button onClick={() => setConfirmTarget({ count: c, action: 'apply' })} className="p-1.5 rounded-md hover:bg-purple-50 text-purple-500" title={t('applyCount')}><CheckCheck className="w-4 h-4" /></button>}
      </div>;
    }},
  ];

  const getItemUnitCost = (item: StockCountItem) => Number((item as StockCountItemWithCost).unit_cost || 0);
  const getCountedValue = (item: StockCountItem) => Number(item.counted_quantity || 0) * getItemUnitCost(item);
  const viewTotalValue = (viewTarget?.items || []).reduce((sum, item) => sum + getCountedValue(item), 0);

  const itemColumns: Column<StockCountItem>[] = [
    { key: 'item', header: isAr ? 'الصنف / الخامة' : 'Item / Raw Material', render: (i) => { const product = i.product as Product | undefined; const rawMaterial = i.raw_material as RawMaterial | undefined; const name = product?.name || rawMaterial?.name || '-'; const sub = product?.barcode || (rawMaterial ? (isAr ? 'خامة' : 'Raw material') : ''); return <div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-ui-page-alt flex items-center justify-center text-xs font-bold text-ui-subtle">{name[0] || '?'}</div><div><p className="font-medium text-ui-text">{name}</p><p className="text-xs text-ui-subtle">{sub}</p></div></div>; } },
    { key: 'system', header: t('systemQuantity'), render: (i) => formatNumber(Number(i.system_quantity)) },
    { key: 'counted', header: t('countedQuantity'), render: (i) => formatNumber(Number(i.counted_quantity)) },
    { key: 'unit_cost', header: isAr ? 'سعر الوحدة' : 'Unit Cost', render: (i) => formatNumber(getItemUnitCost(i), 2) },
    { key: 'counted_value', header: isAr ? 'قيمة الجرد' : 'Count Value', render: (i) => <span className="font-semibold text-ui-text">{formatNumber(getCountedValue(i), 2)}</span> },
    { key: 'variance', header: t('varianceQuantity'), render: (i) => <span className={`font-semibold ${Number(i.variance_quantity) >= 0 ? 'text-ui-success' : 'text-ui-danger'}`}>{Number(i.variance_quantity) >= 0 ? '+' : ''}{formatNumber(Number(i.variance_quantity))}</span> },
    { key: 'variance_value', header: t('varianceValue'), render: (i) => formatNumber(Number(i.variance_value), 2) },
    { key: 'reason', header: t('reason'), render: (i) => i.reason || '-' },
  ];

  const createChoices = formRawMaterials;

  return (
    <DesignSurface testId="stock-counts-page">
      <DesignPageHeader title={t('stockCounts')} subtitle={isAr ? 'جرد الخامات بالمخزن مع الاعتماد وتطبيق الرصيد' : 'Raw-material warehouse counts with approval and stock adjustment'} actions={can('inventory.count.create') ? <Button size="sm" onClick={openCreate}><ClipboardCheck className="w-4 h-4" /> {t('newStockCount')}</Button> : undefined} />
      <DesignPanel testId="stock-counts-search-panel"><div className="flex flex-col sm:flex-row gap-3"><DesignSearch value={search} onChange={setSearch} className="flex-1" label={t('search')} placeholder={t('search')} testId="stock-counts-search" /><Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="sm:w-44"><option value="all">{t('all')}</option>{statusOptions.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</Select><Select value={branchId} onChange={(e) => setBranchId(e.target.value)} className="sm:w-48"><option value="">{t('allBranches')}</option>{visibleBranches.map((br) => <option key={br.id} value={br.id}>{br.name}</option>)}</Select></div></DesignPanel>
      <DesignPanel testId="stock-counts-table-panel"><DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')} /><DesignPagination loaded={counts.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} /></DesignPanel>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title={t('newStockCount')} size="lg"><div className="space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3"><Select label={t('branch')} value={form.branch_id} onChange={(e) => { const nextBranchId = e.target.value; const branchWarehouses = warehouses.filter((w) => w.branch_id === nextBranchId); setForm({ ...form, branch_id: nextBranchId, warehouse_id: branchWarehouses.length === 1 ? branchWarehouses[0].id : '' }); resetCreateLines(); }}><option value="">{t('branch')}</option>{visibleBranches.map((br) => <option key={br.id} value={br.id}>{br.name}</option>)}</Select><Select label={t('warehouse')} value={form.warehouse_id} onChange={(e) => { setForm({ ...form, warehouse_id: e.target.value }); resetCreateLines(); }}><option value="">{t('warehouse')}</option>{warehouses.filter((w) => !form.branch_id || w.branch_id === form.branch_id).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select><Select label={t('countType')} value={form.count_type} onChange={(e) => setForm({ ...form, count_type: e.target.value })}>{typeOptions.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</Select></div>
        <p className="text-xs text-ui-subtle">{isAr ? 'الجرد يطبق على الخامة داخل المخزن المحدد، وليس على رصيد منتج جاهز.' : 'The count applies to the raw material in the selected warehouse, not to finished-product stock.'}</p>
        <div className="rounded-lg border border-ui-border bg-ui-page-alt/40 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <input ref={countExcelInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleCountExcelImport} data-testid="stock-count-excel-input" />
            <Button variant="outline" size="sm" onClick={handleCountExcelExport} disabled={!form.branch_id || !form.warehouse_id}>
              <Download className="w-4 h-4" /> {isAr ? 'سحب خامات Excel' : 'Export Count Excel'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => countExcelInputRef.current?.click()} disabled={!form.branch_id || !form.warehouse_id}>
              <Upload className="w-4 h-4" /> {isAr ? 'رفع الجرد من Excel' : 'Import Count Excel'}
            </Button>
          </div>
          <p className="mt-2 text-xs text-ui-subtle">
            {isAr
              ? 'اسحب الملف بعد اختيار الفرع والمخزن، اكتب الكمية الفعلية فقط ثم ارفع نفس الملف. الرفع يملأ مسودة الجرد ولا يغيّر الرصيد حتى الإرسال ثم الاعتماد ثم التطبيق.'
              : 'Export after selecting branch and warehouse, fill only Counted Quantity, then upload the same file. Upload only fills the draft; stock changes only after submit, approval, and apply.'}
          </p>
        </div>
        <Input label={t('notes')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder={isAr ? 'ملاحظات اختيارية' : 'Optional notes'} />
        <div><div className="flex items-center justify-between mb-2"><p className="text-sm font-medium text-ui-muted">{t('countItems')}</p><Button variant="outline" size="sm" onClick={addFormItem}><Plus className="w-4 h-4" /> {t('addCountItem')}</Button></div><div className="space-y-2">{formItems.map((l, idx) => <div key={idx} className="grid grid-cols-12 gap-2 items-end"><div className="col-span-6"><Select label={idx === 0 ? (isAr ? 'الخامة' : 'Raw material') : undefined} value={l.item_id} onChange={(e) => updateFormItem(idx, 'item_id', e.target.value)}><option value="">{isAr ? 'اختر الخامة' : 'Choose raw material'}</option>{createChoices.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></div><div className="col-span-3"><Input label={idx === 0 ? t('countedQuantity') : undefined} type="number" step="0.0001" value={l.counted_quantity} onChange={(e) => updateFormItem(idx, 'counted_quantity', e.target.value)} placeholder="0" /></div><div className="col-span-2"><Input label={idx === 0 ? t('reason') : undefined} value={l.reason} onChange={(e) => updateFormItem(idx, 'reason', e.target.value)} placeholder={isAr ? 'سبب' : 'Reason'} /></div><div className="col-span-1 flex justify-end"><button onClick={() => removeFormItem(idx)} className="p-2 rounded-md hover:bg-ui-danger-soft text-ui-danger"><Trash2 className="w-4 h-4" /></button></div></div>)}</div></div>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setCreateOpen(false)}>{t('cancel')}</Button><Button onClick={createCount}>{isAr ? 'حفظ المسودة' : 'Save Draft'}</Button></div>
      </div></Modal>

      <Modal open={!!viewTarget} onClose={() => setViewTarget(null)} title={t('countItems') + (viewTarget?.count_number ? ` - ${viewTarget.count_number}` : '')} size="lg">{viewTarget && <div className="space-y-3"><div className="flex items-center justify-between rounded-lg bg-ui-page-alt px-4 py-3"><span className="text-sm text-ui-muted">{isAr ? 'إجمالي قيمة الجرد' : 'Total Count Value'}</span><span className="text-lg font-bold text-ui-text">{formatNumber(viewTotalValue, 2)}</span></div><DataTable columns={itemColumns} data={viewTarget.items || []} emptyMessage={t('noData')} /></div>}</Modal>
      <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title={t('editCountItem')} size="lg">{editTarget && <div className="space-y-4"><div className="flex items-center justify-between"><p className="text-sm font-medium text-ui-muted">{t('countItems')}</p><Button variant="outline" size="sm" onClick={addEditLine}><Plus className="w-4 h-4" /> {t('addCountItem')}</Button></div><div className="space-y-2">{editLines.map((l, idx) => <div key={idx} className="grid grid-cols-12 gap-2 items-end"><div className="col-span-6"><Select label={idx === 0 ? t('product') : undefined} value={l.product_id} onChange={(e) => updateEditLine(idx, 'product_id', e.target.value)}><option value="">{t('product')}</option>{editProducts.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></div><div className="col-span-3"><Input label={idx === 0 ? t('countedQuantity') : undefined} type="number" step="0.0001" value={l.counted_quantity} onChange={(e) => updateEditLine(idx, 'counted_quantity', e.target.value)} placeholder="0" /></div><div className="col-span-2"><Input label={idx === 0 ? t('reason') : undefined} value={l.reason} onChange={(e) => updateEditLine(idx, 'reason', e.target.value)} placeholder={isAr ? 'سبب' : 'Reason'} /></div><div className="col-span-1 flex justify-end"><button onClick={() => removeEditLine(idx)} className="p-2 rounded-md hover:bg-ui-danger-soft text-ui-danger"><Trash2 className="w-4 h-4" /></button></div></div>)}</div><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setEditTarget(null)}>{t('cancel')}</Button><Button onClick={saveEdit}>{t('save')}</Button></div></div>}</Modal>
      <ConfirmDialog open={!!confirmTarget && confirmTarget.action !== 'reject'} onClose={() => setConfirmTarget(null)} onConfirm={() => confirmTarget && runWorkflow(confirmTarget.action)} title={confirmTarget?.action ? t(confirmTarget.action === 'submit' ? 'submitCount' : confirmTarget.action === 'approve' ? 'approveCount' : 'applyCount') : ''} message={confirmTarget?.action ? (confirmTarget.action === 'submit' ? t('submitCountConfirm') : confirmTarget.action === 'approve' ? t('approveCountConfirm') : t('applyCountConfirm')) : ''} confirmLabel={t('save')} cancelLabel={t('cancel')} />
      <Modal open={!!confirmTarget && confirmTarget.action === 'reject'} onClose={() => setConfirmTarget(null)} title={t('rejectCount')} size="sm"><div className="space-y-4"><p className="text-sm text-ui-subtle">{t('rejectCountConfirm')}</p><Input label={t('reason')} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} placeholder={isAr ? 'سبب الرفض' : 'Rejection reason'} /><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setConfirmTarget(null)}>{t('cancel')}</Button><Button variant="danger" onClick={() => runWorkflow('reject')}>{t('rejectCount')}</Button></div></div></Modal>
    </DesignSurface>
  );
}