import { useEffect, useMemo, useState, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { Plus, CheckCircle2, XCircle, ArrowLeftRight, Trash2 } from 'lucide-react';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { useAuth } from '@/context/AuthContext';
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
import { loadTransferAverageCost, loadTransferDestinationPrices, loadTransferMeta, type TransferRawMaterialChoice } from '../services/transferPageData';
import { loadTransferSourceBalances, loadTransferPendingItems, type PendingTransferItem } from '../services/transferPreviewData';

interface TransferLine { item_type: 'raw_material'; item_id: string; destination_item_id: string; quantity: number; unit_cost: number; }
interface TransferRow extends WarehouseTransfer { to_branch_id?: string | null; }

const EMPTY_LINE: TransferLine = { item_type: 'raw_material', item_id: '', destination_item_id: '', quantity: 1, unit_cost: 0 };
const normalizeRawName = (value: string) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

export function TransfersPage() {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const can = useCan();
  const { user } = useAuth();
  const [metaLoading, setMetaLoading] = useState(true);
  const [metaError, setMetaError] = useState(false);
  const [costPending, setCostPending] = useState<number[]>([]);
  const [costErrors, setCostErrors] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const writing = useRef(false);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const costs = useRef({ epoch: 0, versions: new Map<number,number>() });
  const invalidateCosts = () => { costs.current = {epoch: costs.current.epoch + 1, versions: new Map()}; setCostPending([]); setCostErrors([]); };
  const readError = lang === 'ar' ? 'تعذر تحميل بيانات التحويل. أعد التحميل قبل المتابعة.' : 'Transfer data could not be loaded. Reload before continuing.';
  const uncertainMessage = lang === 'ar' ? 'تعذر تأكيد نتيجة العملية. راجع سجل التحويلات قبل تكرارها.' : 'The operation outcome could not be confirmed. Review transfer history before repeating it.';
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
  const [rawMaterials, setRawMaterials] = useState<TransferRawMaterialChoice[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ source_branch_id: '', destination_branch_id: '', from_warehouse_id: '', to_warehouse_id: '', reason: '', notes: '' });
  const [lines, setLines] = useState<TransferLine[]>([{ ...EMPTY_LINE }]);
  const [rejectTarget, setRejectTarget] = useState<TransferRow | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [createBalances, setCreateBalances] = useState<Record<string, number>>({});
  const [createBalanceLoading, setCreateBalanceLoading] = useState(false);
  const [createBalanceError, setCreateBalanceError] = useState(false);
  const [approvalTarget, setApprovalTarget] = useState<TransferRow | null>(null);
  const [approvalItems, setApprovalItems] = useState<PendingTransferItem[]>([]);
  const [approvalOriginal, setApprovalOriginal] = useState<PendingTransferItem[]>([]);
  const [approvalBalances, setApprovalBalances] = useState<Record<string, number>>({});
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [approvalError, setApprovalError] = useState(false);
  const [approvalUnconfirmed, setApprovalUnconfirmed] = useState(false);
  const approvalReadVersion = useRef(0);
  const selectedCreateRawIds = [...new Set(lines.map(l => l.item_id).filter(Boolean))].sort().join(',');
  const balanceText = (value: number | undefined) => value === undefined ? '—'
    : new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-US', { maximumFractionDigits: 4 }).format(value);
  const pendingEdits = approvalItems.length !== approvalOriginal.length
    || approvalItems.some((item, index) => item.id !== approvalOriginal[index]?.id
      || item.quantity !== approvalOriginal[index]?.quantity);

  const metaVersion = useRef(0);
  async function loadMeta() {
    const version = ++metaVersion.current;
    setMetaLoading(true); setMetaError(false);
    try {
      const meta = await loadTransferMeta();
      if (version !== metaVersion.current) return;
      setWarehouses(meta.warehouses); setRawMaterials(meta.rawMaterials); setBranches(meta.branches);
    } catch {
      if (version !== metaVersion.current) return;
      setMetaError(true); setWarehouses([]); setRawMaterials([]); setBranches([]);
    } finally { if (version === metaVersion.current) setMetaLoading(false); }
  }
  useEffect(() => {
    void loadMeta();
    const requestVersion = metaVersion.current;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- generation counter, not a DOM ref; cancel pending requests on identity change/unmount.
    return () => { if (metaVersion.current === requestVersion) metaVersion.current++; costs.current = {epoch:costs.current.epoch + 1,versions:new Map()}; };
  }, [user?.id]);
  useEffect(() => { setModalOpen(false); setRejectTarget(null); invalidateCosts(); }, [branchFilter, user?.id]);

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

  useEffect(() => {
    let cancelled = false;
    setCreateBalances({});
    setCreateBalanceError(false);
    if (!modalOpen || !form.source_branch_id || !form.from_warehouse_id || !selectedCreateRawIds) {
      setCreateBalanceLoading(false);
      return () => { cancelled = true; };
    }
    setCreateBalanceLoading(true);
    void loadTransferSourceBalances(form.source_branch_id, form.from_warehouse_id, selectedCreateRawIds.split(','))
      .then(data => { if (!cancelled) setCreateBalances(data); })
      .catch(() => { if (!cancelled) setCreateBalanceError(true); })
      .finally(() => { if (!cancelled) setCreateBalanceLoading(false); });
    return () => { cancelled = true; };
  }, [modalOpen, form.source_branch_id, form.from_warehouse_id, selectedCreateRawIds]);

  const sourceWarehouses = useMemo(() => warehouses.filter((w) => w.branch_id === form.source_branch_id), [warehouses, form.source_branch_id]);
  const destinationWarehouses = useMemo(() => warehouses.filter((w) => w.branch_id === form.destination_branch_id), [warehouses, form.destination_branch_id]);
  const sourceRawMaterials = useMemo(() => rawMaterials.filter((r) => r.branch_id === form.source_branch_id), [rawMaterials, form.source_branch_id]);

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
    if (metaLoading || metaError || writing.current) return;
    invalidateCosts(); setUnconfirmed(false);
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
    invalidateCosts();
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
    invalidateCosts();
    const firstWarehouse = warehouses.find((w) => w.branch_id === branchId)?.id || '';
    setForm((prev) => ({ ...prev, destination_branch_id: branchId, to_warehouse_id: firstWarehouse }));
    const next=lines.map(line=>({...line,destination_item_id:resolveDestinationRawId(line.item_id,branchId),unit_cost:0}));
    setLines(next);
    void reloadDestinationPrices(next,branchId);
  };

  const lookupAvgCost = async (line: TransferLine, destinationBranchId=form.destination_branch_id): Promise<number> => {
    if (destinationBranchId !== form.source_branch_id) {
      const id=resolveDestinationRawId(line.item_id,destinationBranchId);
      if (!id) return 0; // The existing matching guard rejects an unresolved destination.
      return (await loadTransferDestinationPrices(destinationBranchId,[id]))[id];
    }
    if (!line.item_id || !form.from_warehouse_id) return 0;
    return loadTransferAverageCost({
      rawMaterialId: line.item_id,
      branchId: form.source_branch_id,
      warehouseId: form.from_warehouse_id,
    });
  };
  const updateLineItem = async (idx: number, itemId: string, destinationBranchId=form.destination_branch_id) => {
    const token = costs.current;
    const version = (token.versions.get(idx) || 0) + 1;
    token.versions.set(idx, version);
    const current = () => costs.current === token && token.versions.get(idx) === version;
    setLines(previous => previous.map((line,i) => i === idx ? {...line,item_id:itemId,destination_item_id:resolveDestinationRawId(itemId,destinationBranchId),unit_cost:0} : line));
    setCostErrors(previous => previous.filter(i => i !== idx));
    setCostPending(previous => [...previous.filter(i => i !== idx),idx]);
    try {
      const cost = Number((itemId ? await lookupAvgCost({ ...EMPTY_LINE, item_id:itemId },destinationBranchId) : 0).toFixed(6));
      if (current()) setLines(previous => previous.map((line,i) => i === idx && line.item_id === itemId ? {...line,unit_cost:cost} : line));
    } catch { if (current()) setCostErrors(previous => [...previous.filter(i => i !== idx),idx]); }
    finally { if (current()) setCostPending(previous => previous.filter(i => i !== idx)); }
  };
  const reloadDestinationPrices = async (next: TransferLine[], destinationBranchId: string) => {
    if (destinationBranchId===form.source_branch_id) {
      for (let i=0;i<next.length;i++) if(next[i].item_id) await updateLineItem(i,next[i].item_id,destinationBranchId);
      return;
    }
    const token=costs.current;
    const selected=next.map((line,index)=>({line,index})).filter(({line})=>line.destination_item_id);
    const versions=new Map(selected.map(({index})=>[index,1]));
    for(const [index,version] of versions) token.versions.set(index,version);
    setCostPending(selected.map(({index})=>index));
    const current=(i:number)=>costs.current===token && token.versions.get(i)===versions.get(i);
    try {
      const prices=await loadTransferDestinationPrices(destinationBranchId,selected.map(({line})=>line.destination_item_id));
      setLines(previous=>previous.map((line,index)=>current(index)&&versions.has(index)&&line.destination_item_id===next[index].destination_item_id?{...line,unit_cost:prices[line.destination_item_id]}:line));
    } catch {
      if(costs.current===token) setCostErrors(previous=>[...new Set([...previous,...selected.filter(({index})=>current(index)).map(({index})=>index)])]);
    } finally {
      if(costs.current===token) setCostPending(previous=>previous.filter(i=>!current(i)));
    }
  };
  const updateLine = (idx: number, field: 'quantity' | 'unit_cost', value: number) => setLines(previous => previous.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  const addLine = () => setLines(previous => [...previous, { ...EMPTY_LINE }]);
  const removeLine = (idx: number) => {
    if (costPending.length) return;
    const errors = costErrors.filter(i => i !== idx).map(i => i > idx ? i - 1 : i);
    invalidateCosts(); setCostErrors(errors); setLines(previous => previous.filter((_, i) => i !== idx));
  };

  const createTransfer = async () => {
    if (writing.current || metaLoading || metaError || costPending.length || costErrors.length || unconfirmed) return;
    const allowed = guardTransfer({ warehousesCount: warehouses.length, formData: { form, lines } });
    if (!allowed) return;
    if (!form.source_branch_id || !form.destination_branch_id) { show(lang === 'ar' ? 'اختر فرع المصدر وفرع الوجهة' : 'Select source and destination branches', 'error'); return; }
    if (!form.from_warehouse_id || !form.to_warehouse_id || form.from_warehouse_id === form.to_warehouse_id) { show(t('required') + ': ' + t('fromWarehouse'), 'error'); return; }
    const validLines = lines.filter((l) => l.item_id && Number.isFinite(l.quantity) && l.quantity > 0 && Number.isFinite(l.unit_cost) && l.unit_cost >= 0);
    if (validLines.length === 0) { show(t('required') + ': ' + t('transferItems'), 'error'); return; }
    if (validLines.some((l) => !l.destination_item_id)) {
      show(lang === 'ar'
        ? 'توجد خامة غير معرفة بشكل مطابق في فرع الوجهة. يجب أن توجد خامة واحدة بنفس الاسم والوحدة قبل التحويل.'
        : 'A raw material has no unique matching definition in the destination branch. Create exactly one raw material with the same name and unit before transferring.', 'error');
      return;
    }
    writing.current = true; setSaving(true);
    try {
    const { data, error } = await api.inventory.createTransfer({
      p_from_warehouse_id: form.from_warehouse_id,
      p_to_warehouse_id: form.to_warehouse_id,
      p_branch_id: form.source_branch_id,
      p_items: validLines.map((l) => ({ item_type: l.item_type, item_id: l.item_id, destination_item_id: l.destination_item_id, quantity: l.quantity, unit_cost: l.unit_cost })),
      p_reason: form.reason || null,
      p_notes: form.notes || null,
    });
    if (error || !data) throw error || new Error('TRANSFER_RESULT_UNCONFIRMED');
    const result = data as RpcResult | null;
    if (!result?.success) {
      const messageMap: Record<string, string> = {
        TRANSFER_UNIT_MISMATCH: 'وحدة الخامة مختلفة بين المصدر والوجهة. صحح التعريف قبل التحويل.',
        DESTINATION_ITEM_REQUIRED: 'تعذر تحديد الخامة المطابقة في فرع الوجهة.',
        DESTINATION_ITEM_BRANCH_MISMATCH: 'الخامة المطابقة لا تنتمي إلى فرع الوجهة أو تعريفها غير صحيح.',
      };
      const code = String(result?.error || '');
      if (code === 'INSUFFICIENT_RAW_STOCK' || code === 'INSUFFICIENT_STOCK') {
        show(transferApprovalFailureMessage(result), 'error');
        return;
      }
      const handled = interceptDbError(result?.detail || result?.error, 'transfer_create', 'التحويل المخزني', 'Warehouse Transfer', { form, lines });
      if (!handled) show(lang === 'ar' && messageMap[code] ? messageMap[code] : (result?.detail || result?.error || t('error')), 'error');
      return;
    }
    try { await logAudit('create', 'warehouse_transfers', result.transfer_id, { number: result.transfer_number, source_branch_id: form.source_branch_id, destination_branch_id: form.destination_branch_id }, form.source_branch_id); }
    catch { /* Creation succeeded; audit reporting cannot invalidate the result. */ }
    show(t('saveSuccess'), 'success');
    setModalOpen(false);
    reloadTransfers();
    } catch { setUnconfirmed(true); show(uncertainMessage, 'error'); void reloadTransfers(); }
    finally { writing.current = false; setSaving(false); }
  };

  const transferApprovalFailureMessage = (result: RpcResult | null): string => {
    const code = String(result?.error || '');
    if (code === 'INSUFFICIENT_RAW_STOCK' || code === 'INSUFFICIENT_STOCK') {
      const rawId = String((result as (RpcResult & { raw_material_id?: string }) | null)?.raw_material_id || '');
      const name = rawMaterials.find(raw => raw.id === rawId)?.name;
      const details = result as (RpcResult & { required?: number; available?: number }) | null;
      const required = Number(details?.required);
      const available = Number(details?.available);
      const quantity = Number.isFinite(required) && Number.isFinite(available)
        ? (lang === 'ar' ? `المطلوب ${required}، المتاح ${available}.` : `Required ${required}, available ${available}.`)
        : '';
      return lang === 'ar'
        ? `لا يمكن اعتماد التحويل: رصيد ${name || 'الخامة'} غير كافٍ. ${quantity} راجع رصيد المصدر أو عدّل كمية التحويل.`
        : `Cannot approve transfer: insufficient ${name || 'item'} stock. ${quantity} Check source balance or change transfer quantity.`;
    }
    const known: Record<string, [string, string]> = {
      TRANSFER_UNIT_MISMATCH: ['وحدة الخامة مختلفة بين المصدر والوجهة.', 'Raw material units differ between branches.'],
      INVALID_STATUS: ['تم تغيير حالة التحويل. حدّث القائمة قبل إعادة المحاولة.', 'Transfer status changed. Refresh before retrying.'],
      NOT_ALLOWED: ['ليست لديك صلاحية اعتماد التحويل.', 'You do not have permission to approve transfers.'],
      AUTH_REQUIRED: ['انتهت الجلسة. سجل الدخول مجددًا.', 'Sign in again before approving.'],
      TRANSFER_NOT_FOUND: ['التحويل غير متاح. حدّث القائمة.', 'Transfer not found. Refresh the list.'],
    };
    if (known[code]) return known[code][lang === 'ar' ? 0 : 1];
    // Do not expose arbitrary server details; they may contain internal SQL.
    return uncertainMessage;
  };


  const loadApprovalPreview = async (tr: TransferRow) => {
    const version = ++approvalReadVersion.current;
    setApprovalLoading(true); setApprovalError(false);
    try {
      const items = await loadTransferPendingItems(tr.id);
      const balances = await loadTransferSourceBalances(tr.branch_id, tr.from_warehouse_id,
        items.map(item => item.raw_material_id || ''));
      if (version !== approvalReadVersion.current) return;
      setApprovalItems(items); setApprovalOriginal(items.map(item => ({ ...item })));
      setApprovalBalances(balances);
    } catch {
      if (version === approvalReadVersion.current) setApprovalError(true);
    } finally {
      if (version === approvalReadVersion.current) setApprovalLoading(false);
    }
  };
  const openApprovalPreview = (tr: TransferRow) => {
    if (writing.current || tr.status !== 'pending') return;
    setApprovalTarget(tr); setApprovalOriginal([]); setApprovalItems([]);
    setApprovalBalances({}); setApprovalUnconfirmed(false);
    void loadApprovalPreview(tr);
  };
  const closeApprovalPreview = () => {
    if (writing.current) return;
    approvalReadVersion.current++; setApprovalTarget(null); setApprovalItems([]);
    setApprovalOriginal([]); setApprovalError(false);
  };
  const saveApprovalEdits = async () => {
    if (!approvalTarget || writing.current || approvalLoading || approvalError || approvalUnconfirmed
        || !pendingEdits || !approvalItems.length || approvalItems.some(item =>
          !item.raw_material_id || !Number.isFinite(item.quantity)
          || item.quantity <= 0 || !Number.isInteger(item.quantity * 10000))) return;
    writing.current = true; setSaving(true);
    try {
      const original = approvalOriginal.map(item => ({ id: item.id, quantity: item.quantity }));
      const next = approvalItems.map(item => ({ id: item.id, quantity: item.quantity }));
      const { data, error } = await api.inventory.revisePendingTransfer({
        p_transfer_id: approvalTarget.id, p_original_items: original, p_items: next,
      });
      if (error || !data) throw error || new Error('TRANSFER_REVISION_UNCONFIRMED');
      const result = data as RpcResult | null;
      if (!result?.success) {
        show(lang === 'ar'
          ? 'تعذر حفظ التعديلات؛ ربما تغير التحويل. أعد تحميل المعاينة.'
          : 'Cannot save changes. The transfer may have changed. Reload the preview.', 'error');
        void loadApprovalPreview(approvalTarget);
        return;
      }
      show(lang === 'ar' ? 'تم حفظ البنود. راجعها ثم اعتمد التحويل.' : 'Items saved. Review before approving.', 'success');
      void reloadTransfers();
      await loadApprovalPreview(approvalTarget);
    } catch {
      setApprovalUnconfirmed(true); show(uncertainMessage, 'error'); void reloadTransfers();
    } finally { writing.current = false; setSaving(false); }
  };

  const approve = async (tr: TransferRow) => {
    if (writing.current || approvalLoading || approvalError || pendingEdits || approvalUnconfirmed
      || !approvalTarget || approvalTarget.id !== tr.id || !approvalOriginal.length) return;
    writing.current = true; setSaving(true);
    try {
    const latest = await loadTransferPendingItems(tr.id);
    if (JSON.stringify(latest.map(x => [x.id, x.quantity])) !==
        JSON.stringify(approvalOriginal.map(x => [x.id, x.quantity]))) {
      show(lang === 'ar' ? 'تغيرت البنود؛ حدّث المعاينة قبل الاعتماد.' : 'Items changed. Refresh the preview before approving.', 'error');
      await loadApprovalPreview(tr);
      return;
    }
    await loadTransferSourceBalances(tr.branch_id, tr.from_warehouse_id,
      latest.map(x => x.raw_material_id || ''));
    const { data, error } = await api.inventory.approveTransfer({ p_transfer_id: tr.id });
    if (error) { show(error.message, 'error'); return; }
    const result = data as RpcResult | null;
    if (!result?.success) { show(transferApprovalFailureMessage(result), 'error'); void reloadTransfers(); return; }
    // Approval has already succeeded at the database boundary. Audit telemetry
    // must not turn that success into an ambiguous operation failure.
    try { await logAudit('update', 'warehouse_transfers', tr.id, { action: 'approve' }, tr.branch_id); }
    catch { /* The committed transfer remains approved; no automatic retry. */ }
    show(t('saveSuccess'), 'success');
    closeApprovalPreview();
    reloadTransfers();
    } catch { setApprovalUnconfirmed(true); show(uncertainMessage, 'error'); void reloadTransfers(); }
    finally { writing.current = false; setSaving(false); }
  };
  const openReject = (tr: TransferRow) => { setRejectTarget(tr); setRejectReason(''); };
  const doReject = async () => {
    if (!rejectTarget || writing.current) return;
    writing.current = true; setSaving(true);
    try {
    const { data, error } = await api.inventory.rejectTransfer({ p_transfer_id: rejectTarget.id, p_reason: rejectReason || null });
    if (error) { show(error.message, 'error'); return; }
    const result = data as RpcResult | null;
    if (!result?.success) { show(result?.error === 'TRANSFER_UNIT_MISMATCH' ? (lang === 'ar' ? 'وحدة الخامة مختلفة بين المصدر والوجهة. صحح التعريف قبل التحويل.' : 'Source and destination raw material units differ. Correct the definitions before transferring.') : (result?.detail || result?.error || t('error')), 'error'); return; }
    await logAudit('update', 'warehouse_transfers', rejectTarget.id, { action: 'reject', reason: rejectReason }, rejectTarget.branch_id);
    show(t('saveSuccess'), 'success');
    setRejectTarget(null);
    reloadTransfers();
    } catch { show(uncertainMessage, 'error'); void reloadTransfers(); }
    finally { writing.current = false; setSaving(false); }
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
    { key: 'actions', header: t('actions'), render: (tr) => <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>{can('inventory.transfer.approve') && tr.status === 'pending' && <><button disabled={saving} onClick={() => openApprovalPreview(tr)} className="p-1.5 rounded-md hover:bg-ui-success-soft text-ui-success" title={t('approveTransfer')}><CheckCircle2 className="w-4 h-4" /></button><button disabled={saving} onClick={() => openReject(tr)} className="p-1.5 rounded-md hover:bg-ui-danger-soft text-ui-danger" title={t('rejectTransfer')}><XCircle className="w-4 h-4" /></button></>}</div> },
  ];

  return (
    <DesignSurface testId="transfers-page">
      <DesignPageHeader title={t('warehouseTransfers')} subtitle={t('transfers')} actions={can('inventory.transfer.create') ? <Button size="sm" disabled={metaLoading || metaError || saving} onClick={openAdd}><Plus className="w-4 h-4" /> {t('newTransfer')}</Button> : undefined} />
      {metaError && <div role="alert">{readError} <Button onClick={() => void loadMeta()}>{lang === 'ar' ? 'إعادة التحميل' : 'Reload'}</Button></div>}
      {warehouses.length < 2 && !metaLoading && !metaError && <PrerequisiteAlertBanner step={PREREQUISITE_STEPS.create_second_warehouse} onAction={() => startGuidance(PREREQUISITE_STEPS.create_second_warehouse, 'transfer_create', location.pathname, { form, lines }, 'التحويل المخزني', 'Warehouse Transfers')} />}
      <DesignPanel testId="transfers-search-panel"><DesignSearch value={search} onChange={setSearch} label={t('search')} placeholder={t('search')} testId="transfers-search" /></DesignPanel>
      <DesignPanel testId="transfers-table-panel"><DataTable columns={columns} data={filtered} loading={loading} error={error} emptyMessage={t('noData')} /><DesignPagination loaded={transfers.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} /></DesignPanel>
      <Modal open={modalOpen} onClose={() => { if (!writing.current) { invalidateCosts(); setModalOpen(false); } }} title={t('newTransfer')} size="lg">
        <fieldset disabled={saving} className="space-y-5">
          {unconfirmed && <p role="alert">{uncertainMessage}</p>}
          {costErrors.length > 0 && <div role="alert">{lang === 'ar' ? 'تعذر تحميل تكلفة الخامة. أعد المحاولة قبل الحفظ.' : 'Raw material cost could not be loaded. Retry before saving.'} <Button variant="secondary" onClick={() => costErrors.forEach(idx => void updateLineItem(idx, lines[idx].item_id))}>{lang === 'ar' ? 'إعادة تحميل التكلفة' : 'Retry cost read'}</Button></div>}
          {costPending.length > 0 && <p role="status">{t('loading')}</p>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Select label={lang === 'ar' ? 'فرع المصدر' : 'Source branch'} value={form.source_branch_id} onChange={(e) => setSourceBranch(e.target.value)} disabled={!!branchFilter}><option value="">{t('branch')}</option>{branches.map((br) => <option key={br.id} value={br.id}>{br.name}</option>)}</Select>
            <Select label={lang === 'ar' ? 'فرع الوجهة' : 'Destination branch'} value={form.destination_branch_id} onChange={(e) => setDestinationBranch(e.target.value)}><option value="">{t('branch')}</option>{branches.map((br) => <option key={br.id} value={br.id}>{br.name}</option>)}</Select>
            <Select label={t('fromWarehouse')} value={form.from_warehouse_id} onChange={(e) => { invalidateCosts(); setLines([{...EMPTY_LINE}]); setForm({ ...form, from_warehouse_id: e.target.value }); }}><option value="">{t('fromWarehouse')}</option>{sourceWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
            <Select label={t('toWarehouse')} value={form.to_warehouse_id} onChange={(e) => setForm({ ...form, to_warehouse_id: e.target.value })}><option value="">{t('toWarehouse')}</option>{destinationWarehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</Select>
            <Input label={t('reason')} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          </div>
          <div>
            {form.source_branch_id !== form.destination_branch_id && <p role="note" className="mb-2 text-sm text-ui-subtle">{lang==='ar'?'سعر التحويل هو آخر سعر معتمد للخامة في الفرع المستلم. السعر المعروض تقديري ويُحدّث ويُثبت عند الموافقة؛ الخامة بلا سعر تُحسب بصفر.':'Transfers use the receiving branch’s latest approved raw price. The preview is refreshed and fixed at approval; an unpriced raw material is valued at zero.'}</p>}
            <div className="flex items-center justify-between mb-2"><div><p className="text-sm font-bold text-ui-muted">{t('transferItems')}</p><p className="text-xs text-ui-subtle">{lang === 'ar' ? 'اختر الخامة والكمية فقط. عند التحويل بين الفروع يحدد النظام الخامة المطابقة تلقائيًا بالاسم والوحدة.' : 'Choose the raw material and quantity only. Cross-branch transfers resolve the matching raw material automatically by name and unit.'}</p></div><Button variant="outline" size="sm" onClick={addLine}><Plus className="w-4 h-4" /> {t('add')}</Button></div>
            <div className="space-y-2">{lines.map((l, idx) => <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_130px_130px_36px] gap-2 items-end">
              <Select aria-label={`${t('rawMaterial')} ${idx + 1}`} value={l.item_id} onChange={(e) => void updateLineItem(idx, e.target.value)}><option value="">{lang === 'ar' ? 'اختر الخامة' : 'Select raw material'}</option>{sourceRawMaterials.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
              <Input aria-label={`${t('quantity')} ${idx + 1}`} type="number" step="0.0001" value={l.quantity} onChange={(e) => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)} placeholder={t('quantity')} />
              <Input aria-label={`${t('unitCost')} ${idx + 1}`} type="number" step="0.000001" readOnly={form.source_branch_id !== form.destination_branch_id} value={l.unit_cost} onChange={(e) => updateLine(idx, 'unit_cost', parseFloat(e.target.value) || 0)} placeholder={t('unitCost')} />
              <button disabled={costPending.length > 0} onClick={() => removeLine(idx)} className="p-2 rounded-lg text-ui-danger hover:bg-ui-danger-soft" title={t('delete')}><Trash2 className="w-4 h-4" /></button>
            </div>)}</div>
          </div>
          <Input label={t('notes')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => { invalidateCosts(); setModalOpen(false); }}>{t('cancel')}</Button><Button disabled={saving || unconfirmed || costPending.length > 0 || costErrors.length > 0} onClick={createTransfer}>{saving ? t('loading') : t('save')}</Button></div>
        </fieldset>
      </Modal>
      <Modal open={!!rejectTarget} onClose={() => setRejectTarget(null)} title={t('rejectTransfer')} size="sm">{rejectTarget && <div className="space-y-4"><p className="text-sm text-ui-muted">{t('transferNumber')}: <b>{rejectTarget.transfer_number}</b></p><Input label={t('rejectReason')} value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} /><div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setRejectTarget(null)}>{t('cancel')}</Button><Button variant="danger" disabled={saving} onClick={doReject}>{t('rejectTransfer')}</Button></div></div>}</Modal>
    </DesignSurface>
  );
}
