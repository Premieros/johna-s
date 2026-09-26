import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Plus, CheckCircle2, XCircle, ArrowLeftRight, Trash2 } from 'lucide-react';
import { supabase } from '@/api';
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
import { BranchBadge } from '@/components/BranchBadge';
import { formatDateTime } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import { useOperationalGuard, PrerequisiteAlertBanner, PREREQUISITE_STEPS } from '@/core/guard';
import type { WarehouseTransfer, Warehouse, Branch, RpcResult } from '@/lib/types';

interface RawMaterialChoice { id: string; name: string; branch_id: string; unit_id: string | null; default_cost: number; }
interface TransferLine { item_type: 'raw_material'; item_id: string; destination_item_id: string; quantity: number; unit_cost: number; }
interface TransferRow extends WarehouseTransfer { to_branch_id?: string | null; }

const EMPTY_LINE: TransferLine = { item_type: 'raw_material', item_id: '', destination_item_id: '', quantity: 1, unit_cost: 0 };
const normalizeRawName = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

export function TransfersPage() {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const can = useCan();
  const branchFilter = useBranchFilter();
  const history = useHistoryAccess();
  const location = useLocation();
  const { guardTransfer, interceptDbError, startGuidance } = useOperationalGuard();

  const { rows: transfers, loading, error, total, hasMore, loadMore, loadingMore, refresh: reloadTransfers } = usePaginatedRows<TransferRow>({
    table: 'warehouse_transfers',
    select: '*, from_warehouse:warehouses!warehouse_transfers_from_warehouse_id_fkey(*), to_warehouse:warehouses!warehouse_transfers_to_warehouse_id_fkey(*), branch:branches!warehouse_transfers_branch_id_fkey(*), requester:users!warehouse_transfers_requested_by_fkey(id, full_name, email)',
    order: { column: 'created_at', ascending: false },
    or: history.minIso
      ? (branchFilter
          ? `and(branch_id.eq.${branchFilter},created_at.gte.${history.minIso}),and(branch_id.eq.${branchFilter},status.eq.pending),and(to_branch_id.eq.${branchFilter},created_at.gte.${history.minIso}),and(to_branch_id.eq.${branchFilter},status.eq.pending)`
          : `created_at.gte.${history.minIso},status.eq.pending`)
      : (branchFilter ? `branch_id.eq.${branchFilter},to_branch_id.eq.${branchFilter}` : undefined),
    pageSize: 100,
  });
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterialChoice[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ source_branch_id: '', destination_branch_id: '', from_warehouse_id: '', to_warehouse_id: '', reason: '', notes: '' });
  const [lines, setLines] = useState<TransferLine[]>([{ ...EMPTY_LINE }]);
  const [rejectTarget, setRejectTarget] = useState<TransferRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  async function loadMeta() {
    const [w, rm, br] = await Promise.all([
      supabase.from('warehouses').select('*').eq('is_active', true).order('name'),
      supabase.from('raw_materials').select('id,name,branch_id,unit_id,default_cost').eq('is_active', true).order('name'),
      supabase.from('branches').select('*').eq('is_active', true).order('name'),
    ]);
    setWarehouses((w.data as Warehouse[]) || []);
    setRawMaterials((rm.data as RawMaterialChoice[]) || []);
    setBranches((br.data as Branch[]) || []);
  }
  useEffect(() => { void loadMeta(); }, []);

  useEffect(() => {
    const state = location.state as { restoredDraft?: { form?: typeof form; lines?: TransferLine[] }; fromGuidance?: boolean } | null;
    if (state?.fromGuidance && state?.restoredDraft) {
      if (state.restoredDraft.form) setForm((prev) => ({ ...prev, ...state.restoredDraft?.form }));
      if (state.restoredDraft.lines) {
        const restoredRawLines = state.restoredDraft.lines.filter((line) => line.item_type === 'raw_material');
        setLines(restoredRawLines.length ? restoredRawLines : [{ ...EMPTY_LINE }]);
      }
      setModalOpen(true);
    }
  }, [location.state]);

  const sourceWarehouses = useMemo(() => warehouses.filter((w) => w.branch_id === form.source_branch_id), [warehouses, form.source_branch_id]);
  const destinationWarehouses = useMemo(() => warehouses.filter((w) => w.branch_id === form.destination_branch_id), [warehouses, form.destination_branch_id]);
  const sourceRawMaterials = useMemo(() => rawMaterials.filter((r) => r.branch_id === form.source_branch_id), [rawMaterials, form.source_branch_id]);
  const destinationRawMaterials = useMemo(() => rawMaterials.filter((r) => r.branch_id === form.destination_branch_id), [rawMaterials, form.destination_branch_id]);

  const transferDestinationBranchId = (tr: TransferRow) => tr.to_branch_id || tr.to_warehouse?.branch_id || tr.branch_id;
  const destinationBranchName = (tr: TransferRow) => branches.find((branch) => branch.id === transferDestinationBranchId(tr))?.name || '-';

  const filtered = transfers.filter((tr) => {
    const destinationBranchId = transferDestinationBranchId(tr);
    if (branchFilter && tr.branch_id !== branchFilter && destinationBranchId !== branchFilter) return false;
    if (!search) return true;
    const needle = search.toLowerCase();
    return tr.transfer_number.toLowerCase().includes(needle)
      || (tr.from_warehouse?.name || '').toLowerCase().includes(needle)
      || (tr.to_warehouse?.name || '').toLowerCase().includes(needle)
      || (tr.branch?.name || '').toLowerCase().includes(needle)
      || destinationBranchName(tr).toLowerCase().includes(needle);
  });

  const openAdd = () => {
    const allowed = guardTransfer({ warehousesCount: warehouses.length, formData: { form, lines } });
    if (!allowed) return;
    const sourceBranchId = branchFilter || branches[0]?.id || '';
    const destinationBranchId = branches.find((b) => b.id !== sourceBranchId)?.id || sourceBranchId;
    const from = warehouses.find((w) => w.branch_id === sourceBranchId)?.id || '';
    const to = warehouses.find((w) => w.branch_id === destinationBranchId)?.id || '';
    setForm({ source_branch_id: sourceBranchId, destination_branch_id: destinationBranchId, from_warehouse_id: from, to_warehouse_id: to, reason: '', notes: '' });
    setLines([{ ...EMPTY_LINE }]);
    setModalOpen(true);
  };

  const setSourceBranch = (branchId: string) => {
    const firstWarehouse = warehouses.find((w) => w.branch_id === branchId)?.id || '';
    setForm((prev) => ({ ...prev, source_branch_id: branchId, from_warehouse_id: firstWarehouse }));
    setLines([{ ...EMPTY_LINE }]);
  };
  const resolveDestinationRawId = (sourceRawId: string, destinationBranchId: string): string => {
    if (!sourceRawId || !destinationBranchId) return '';
    if (destinationBranchId === form.source_branch_id) return sourceRawId;
    const source = rawMaterials.find((raw) => raw.id === sourceRawId);
    if (!source) return '';
    const matches = rawMaterials.filter((raw) => raw.branch_id === destinationBranchId
      && raw.unit_id === source.unit_id
      && normalizeRawName(raw.name) === normalizeRawName(source.name));
    return matches.length === 1 ? matches[0].id : '';
  };

  const setDestinationBranch = (branchId: string) => {
    const firstWarehouse = warehouses.find((w) => w.branch_id === branchId)?.id || '';
    setForm((prev) => ({ ...prev, destination_branch_id: branchId, to_warehouse_id: firstWarehouse }));
    setLines((current) => current.map((line) => ({ ...line, destination_item_id: resolveDestinationRawId(line.item_id, branchId) })));
  };

  const lookupAvgCost = async (line: TransferLine): Promise<number> => {
    if (!line.item_id || !form.from_warehouse_id) return 0;
    const { data } = await supabase.from('raw_material_warehouse_inventory')
      .select('avg_cost')
      .eq('raw_material_id', line.item_id)
      .eq('branch_id', form.source_branch_id)
      .eq('warehouse_id', form.from_warehouse_id)
      .maybeSingle();
    return Number((data as { avg_cost?: number } | null)?.avg_cost || 0);
  };
  const updateLineItem = async (idx: number, itemId: string) => {
    const next = lines.map((l) => ({ ...l }));
    next[idx].item_id = itemId;
    next[idx].destination_item_id = resolveDestinationRawId(itemId, form.destination_branch_id);
    next[idx].unit_cost = Number((await lookupAvgCost({ ...next[idx], item_id: itemId })).toFixed(2));
    setLines(next);
  };
  const updateLine = (idx: number, field: 'quantity' | 'unit_cost', value: number) => setLines(lines.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  const addLine = () => setLines([...lines, { ...EMPTY_LINE }]);
  const removeLine = (idx: number) => setLines(lines.filter((_, i) => i !== idx));

  const createTransfer = async () => {
    const allowed = guardTransfer({ warehousesCount: warehouses.length, formData: { form, lines } });
    if (!allowed) return;
    if (!form.source_branch_id || !form.destination_branch_id) { show(lang === 'ar' ? 'اختر فرع المصدر وفرع الوجهة' : 'Select source and destination branches', 'error'); return; }
    if (!form.from_warehouse_id || !form.to_warehouse_id || form.from_warehouse_id === form.to_warehouse_id) { show(t('required') + ': ' + t('fromWarehouse'), 'error'); return; }
    const validLines = lines.filter((l) => l.item_id && l.quantity > 0);
    if (validLines.length === 0) { show(t('required') + ': ' + t('transferItems'), 'error'); return; }
    if (validLines.some((l) => !l.destination_item_id)) {
      show(lang === 'ar'
        ? 'توجد خامة غير معرفة بشكل مطابق في فرع الوجهة. يجب أن توجد خامة واحدة بنفس الاسم والوحدة قبل التحويل.'
        : 'A raw material has no unique matching definition in the destination branch. Create exactly one raw material with the same name and unit before transferring.', 'error');
      return;
    }
    const { data, error } = await api.inventory.createTransfer({
      p_from_warehouse_id: form.from_warehouse_id,
      p_to_warehouse_id: form.to_warehouse_id,
      p_branch_id: form.source_branch_id,
      p_items: validLines.map((l) => ({ item_type: l.item_type, item_id: l.item_id, destination_item_id: l.destination_item_id, quantity: l.quantity, unit_cost: l.unit_cost })),
      p_reason: form.reason || null,
      p_notes: form.notes || null,
    });
    if (error) {
      const handled = interceptDbError(error, 'transfer_create', 'التحويل المخزني', 'Warehouse Transfer', { form, lines });
      if (!handled) show(error.message, 'error');
      return;
    }
    const result = data as RpcResult | null;
    if (!result?.success) {
      const messageMap: Record<string, string> = {
        DESTINATION_ITEM_REQUIRED: 'تعذر تحديد الخامة المطابقة في فرع الوجهة.',
        DESTINATION_ITEM_BRANCH_MISMATCH: 'الخامة المطابقة لا تنتمي إلى فرع الوجهة أو تعريفها غير صحيح.',
      };
      const code = String(result?.error || '');
      const handled = interceptDbError(result?.detail || result?.error, 'transfer_create', 'التحويل المخزني', 'Warehouse Transfer', { form, lines });
      if (!handled) show(lang === 'ar' && messageMap[code] ? messageMap[code] : (result?.detail || result?.error || t('error')), 'error');
      return;
    }
    await logAudit('create', 'warehouse_transfers', result.transfer_id, { number: result.transfer_number, source_branch_id: form.source_branch_id, destination_branch_id: form.destination_branch_id });
    show(t('saveSuccess'), 'success');
    setModalOpen(false);
    reloadTransfers();
  };

  const approve = async (tr: TransferRow) => {
    const { data, error } = await api.inventory.approveTransfer({ p_transfer_id: tr.id });
    if (error) { show(error.message, 'error'); return; }
    const result = data as RpcResult | null;
    if (!result?.success) { show(result?.detail || result?.error || t('error'), 'error'); return; }
    await logAudit('update', 'warehouse_transfers', tr.id, { action: 'approve' });
    show(t('saveSuccess'), 'success');
    reloadTransfers();
  };
  const openReject = (tr: TransferRow) => { setRejectTarget(tr); setRejectReason(''); };
  const doReject = async () => {
    if (!rejectTarget) return;
    const { data, error } = await api.inventory.rejectTransfer({ p_transfer_id: rejectTarget.id, p_reason: rejectReason || null });
    if (error) { show(error.message, 'error'); return; }
    const result = data as RpcResult | null;
    if (!result?.success) { show(result?.detail || result?.error || t('error'), 'error'); return; }
    await logAudit('update', 'warehouse_transfers', rejectTarget.id, { action: 'reject', reason: rejectReason });
    show(t('saveSuccess'), 'success');
    setRejectTarget(null);
    reloadTransfers();
  };

  const statusPill = (status: string) => {
    const map: Record<string, string> = { pending: 'bg-ui-warning-soft text-ui-warning', approved: 'bg-ui-success-soft text-ui-success', rejected: 'bg-ui-danger-soft text-ui-danger' };
    const label: Record<string, string> = { pending: t('statusPending'), approved: t('statusApproved'), rejected: t('statusRejected') };
    return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${map[status] || map.pending}`}>{label[status] || status}</span>;
  };

  const columns: Column<TransferRow>[] = [
    { key: 'transfer_number', header: t('transferNumber'), render: (tr) => <div className="flex items-center gap-2"><div className="w-8 h-8 rounded-lg bg-ui-info-soft flex items-center justify-center text-ui-info"><ArrowLeftRight className="w-4 h-4" /></div><div><p className="font-semibold text-ui-text">{tr.transfer_number}</p>{tr.reason && <p className="text-xs text-ui-subtle">{tr.reason}</p>}</div></div> },
    { key: 'from', header: t('fromWarehouse'), render: (tr) => <div>{tr.from_warehouse?.name || '-'}<div className="mt-1"><BranchBadge name={tr.branch?.name || '-'} /></div></div> },
    { key: 'to', header: t('toWarehouse'), render: (tr) => <div>{tr.to_warehouse?.name || '-'}<div className="mt-1"><BranchBadge name={destinationBranchName(tr)} /></div></div> },
    { key: 'status', header: t('status'), render: (tr) => statusPill(tr.status) },
    { key: 'requested_at', header: t('requestedAt'), render: (tr) => formatDateTime(tr.requested_at, lang) },
    { key: 'actions', header: t('actions'), render: (tr) => <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>{can('inventory.transfer.approve') && tr.status === 'pending' && <><button onClick={() => approve(tr)} className="p-1.5 rounded-md hover:bg-ui-success-soft text-ui-success" title={t('approveTransfer')}><CheckCircle2 className="w-4 h-4" /></button><button onClick={() => openReject(tr)} className="p-1.5 rounded-md hover:bg-ui-danger-soft text-ui-danger" title={t('rejectTransfer')}><XCircle className="w-4 h-4" /></button></>}</div> },
  ];

  return (
    <DesignSurface testId="transfers-page">
      <DesignPageHeader title={t('warehouseTransfers')} subtitle={t('transfers')} actions={can('inventory.transfer.create') ? <Button size="sm" onClick={openAdd}><Plus className="w-4 h-4" /> {t('newTransfer')}</Button> : undefined} />
      {warehouses.length < 2 && !loading && <PrerequisiteAlertBanner step={PREREQUISITE_STEPS.create_second_warehouse} onAction={() => startGuidance(PREREQUISITE_STEPS.create_second_warehouse, 'transfer_create', location.pathname, { form, lines }, 'التحويل المخزني', 'Warehouse Transfers')} />}
      <DesignPanel testId="transfers-search-panel"><DesignSearch value={search} onChange={setSearch} label={t('search')} placeholder={t('search')} testId="transfers-search" /></DesignPanel>
      <DesignPanel testId="transfers-table-panel"><DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')} /><DesignPagination loaded={transfers.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} /></DesignPanel>
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={t('newTransfer')} size="lg">
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select label={lang === 'ar' ? 'فرع المصدر' : 'Source branch'} value={form.source_branch_id} onChange={(e) => setSourceBranch(e.target.value)} disabled={!!branchFilter}><option value="">{t('branch')}</option>{branches.map((br) => <option key={br.id} value={br.id}>{br.name}</option>)}</Select>
            <Select label={lang === 'ar' ? 'فرع الوجهة' : 'Destination branch'} value={form.destination_branch_id} onChange={(e) => setDestinationBranch(e.target.value)}><option value="">{t('branch')}</option>{branches.map((br) => <option key={br.id} value={br.id}>{br.name}</option>)}</Select>
            <Select label={t('fromWarehouse')} value={form.from_warehouse_id} onChange={(e) => setForm({ ...form, from_warehouse_id: e.target.value })}><option value="">{t('fromWarehouse')}</option>{sourceWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
            <Select label={t('toWarehouse')} value={form.to_warehouse_id} onChange={(e) => setForm({ ...form, to_warehouse_id: e.target.value })}><option value="">{t('toWarehouse')}</option>{destinationWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
            <Input label={t('reason')} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </div>
          <div>
            <div className="flex items-center justify-between mb-2"><div><p className="text-sm font-bold text-ui-muted">{t('transferItems')}</p><p className="text-xs text-ui-subtle">{lang === 'ar' ? 'اختر الخامة والكمية فقط. عند التحويل بين الفروع يحدد النظام الخامة المطابقة تلقائيًا بالاسم والوحدة.' : 'Choose the raw material and quantity only. Cross-branch transfers resolve the matching raw material automatically by name and unit.'}</p></div><Button variant="outline" size="sm" onClick={addLine}><Plus className="w-4 h-4" /> {t('add')}</Button></div>
            <div className="space-y-2">{lines.map((l, idx) => <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_130px_130px_36px] gap-2 items-end">
              <Select value={l.item_id} onChange={(e) => void updateLineItem(idx, e.target.value)}><option value="">{lang === 'ar' ? 'اختر الخامة' : 'Select raw material'}</option>{sourceRawMaterials.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
              <Input type="number" step="0.0001" value={l.quantity} onChange={(e) => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)} placeholder={t('quantity')} />
              <Input type="number" step="0.01" value={l.unit_cost} onChange={(e) => updateLine(idx, 'unit_cost', parseFloat(e.target.value) || 0)} placeholder={t('unitCost')} />
              <button onClick={() => removeLine(idx)} className="p-2 rounded-lg text-ui-danger hover:bg-ui-danger-soft" title={t('delete')}><Trash2 className="w-4 h-4" /></button>
            </div>)}</div>
          </div>
          <Input label={t('notes')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button><Button onClick={createTransfer}>{t('save')}</Button></div>
        </div>
      </Modal>
      <Modal open={!!rejectTarget} onClose={() => setRejectTarget(null)} title={t('rejectTransfer')} size="sm">{rejectTarget && <div className="space-y-4"><p className="text-sm text-ui-muted">{t('transferNumber')}: <b>{rejectTarget.transfer_number}</b></p><Input label={t('rejectReason')} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} /><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setRejectTarget(null)}>{t('cancel')}</Button><Button variant="danger" onClick={doReject}>{t('rejectTransfer')}</Button></div></div>}</Modal>
    </DesignSurface>
  );
}
