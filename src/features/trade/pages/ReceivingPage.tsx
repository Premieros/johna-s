import { useState, useEffect, useCallback } from 'react';
import { PackageOpen, Save, History, Trophy } from 'lucide-react';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useToast } from '@/components/Toast';
import { DesignSurface, DesignPageHeader, DesignPanel } from '@/components/design';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { BranchBadge } from '@/components/BranchBadge';
import { formatDate, formatCurrency } from '@/lib/format';
import { useCan } from '@/lib/permissions';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import type { RpcResult, PurchaseBackorderRow, PurchaseReceiptRow, SupplierEvaluationRow, ReceiveLineInput } from '@/lib/types';

interface ReceivingLine {
  purchase_item_id: string;
  name: string;
  unit_name: string;
  ordered: number;
  received: number;
  unit_cost: number;
  qty: string;
}

type Tab = 'backorders' | 'receipts' | 'evaluation';

export function ReceivingPage() {
  const { t, lang } = useLanguage();
  const branchFilter = useBranchFilter();
  const { show } = useToast();
  const can = useCan();
  const { branches } = useBranches();
  const { effectiveSettings } = useSettings();
  const currency = effectiveSettings(branchFilter)?.currency || 'EGP';
  const [tab, setTab] = useState<Tab>('backorders');

  const [backorders, setBackorders] = useState<PurchaseBackorderRow[]>([]);
  const [boLoading, setBoLoading] = useState(false);
  const [receipts, setReceipts] = useState<PurchaseReceiptRow[]>([]);
  const [rLoading, setRLoading] = useState(false);
  const [evaluation, setEvaluation] = useState<SupplierEvaluationRow[]>([]);
  const [evLoading, setEvLoading] = useState(false);

  const [receiveModal, setReceiveModal] = useState<PurchaseBackorderRow | null>(null);
  const [lines, setLines] = useState<ReceivingLine[]>([]);
  const [saving, setSaving] = useState(false);

  const branchName = useCallback((branchId: string | null | undefined) => branches.find((b) => b.id === branchId)?.name || '-', [branches]);

  const loadBackorders = useCallback(async () => {
    setBoLoading(true);
    const { data } = await api.procurement.getPurchaseBackorders({ p_branch_id: branchFilter || null });
    setBackorders(((data as PurchaseBackorderRow[]) || []).map((r) => ({ ...r, id: r.purchase_item_id })));
    setBoLoading(false);
  }, [branchFilter]);

  const loadReceipts = useCallback(async () => {
    setRLoading(true);
    const { data } = await api.procurement.getPurchaseReceipts({ p_branch_id: branchFilter || null });
    setReceipts(((data as PurchaseReceiptRow[]) || []).map((r) => ({ ...r, id: r.receipt_id })));
    setRLoading(false);
  }, [branchFilter]);

  const loadEvaluation = useCallback(async () => {
    setEvLoading(true);
    const { data } = await api.procurement.getSupplierEvaluation({ p_branch_id: branchFilter || null });
    setEvaluation(((data as SupplierEvaluationRow[]) || []).map((r) => ({ ...r, id: r.supplier_id })));
    setEvLoading(false);
  }, [branchFilter]);

  useEffect(() => {
    loadBackorders();
    loadReceipts();
  }, [loadBackorders, loadReceipts]);

  const openTab = (next: Tab) => {
    setTab(next);
    if (next === 'evaluation') loadEvaluation();
    if (next === 'receipts') loadReceipts();
    if (next === 'backorders') loadBackorders();
  };

  const openReceive = async (row: PurchaseBackorderRow) => {
    setReceiveModal(row);
    setLines([{
      purchase_item_id: row.purchase_item_id,
      name: row.item_name,
      unit_name: row.unit_name,
      ordered: row.ordered_quantity,
      received: row.received_quantity,
      unit_cost: row.unit_cost,
      qty: '',
    }]);
  };

  const updateQty = (i: number, qty: string) => setLines(lines.map((l, idx) => idx === i ? { ...l, qty } : l));

  const receiveFailureMessage = (result: RpcResult & { detail?: string }) => {
    if (lang === 'ar') {
      if (result.error === 'WAREHOUSE_REQUIRED') return 'حدد مستودعًا لأمر الشراء قبل الاستلام، ثم أعد المحاولة.';
      if (result.error === 'WAREHOUSE_BRANCH_MISMATCH') return 'مستودع أمر الشراء لا يتبع نفس الفرع. صحح المستودع في أمر الشراء قبل الاستلام.';
      if (result.error === 'OVER_RECEIPT') return 'كمية الاستلام أكبر من الكمية المتبقية في أمر الشراء.';
      if (result.error === 'NOT_RECEIVABLE') return 'أمر الشراء ليس في حالة تسمح باستلام جديد.';
    } else {
      if (result.error === 'WAREHOUSE_REQUIRED') return 'Select a warehouse on the purchase order before receiving, then try again.';
      if (result.error === 'WAREHOUSE_BRANCH_MISMATCH') return 'The purchase-order warehouse belongs to another branch. Correct the warehouse before receiving.';
      if (result.error === 'OVER_RECEIPT') return 'The receipt quantity is greater than the remaining purchase-order quantity.';
      if (result.error === 'NOT_RECEIVABLE') return 'This purchase order is not in a state that allows another receipt.';
    }
    return result.detail || result.error || t('error');
  };

  const saveReceipt = async () => {
    if (!receiveModal) return;

    const overRemaining = lines.find((l) => {
      const qty = parseFloat(l.qty);
      return Number.isFinite(qty) && qty > l.ordered - l.received;
    });
    if (overRemaining) {
      show(
        lang === 'ar'
          ? `كمية استلام ${overRemaining.name} أكبر من المتبقي (${overRemaining.ordered - overRemaining.received}).`
          : `Receipt quantity for ${overRemaining.name} exceeds the remaining quantity (${overRemaining.ordered - overRemaining.received}).`,
        'error',
      );
      return;
    }

    const items = lines
      .filter((l) => parseFloat(l.qty) > 0)
      .map((l): ReceiveLineInput => ({ purchase_item_id: l.purchase_item_id, quantity_received: parseFloat(l.qty) }));
    if (items.length === 0) { show(t('required') + ': ' + t('receiveItems'), 'error'); return; }

    setSaving(true);
    const { data, error: err } = await api.procurement.receivePurchaseOrder({
      p_purchase_id: receiveModal.purchase_id,
      p_receipt_items: items,
    });
    setSaving(false);
    if (err) { show(err.message, 'error'); return; }
    const result = data as (RpcResult & { fully_received?: boolean; detail?: string }) | null;
    if (!result?.success) { show(result ? receiveFailureMessage(result) : t('error'), 'error'); return; }
    show(result.fully_received ? t('fullyReceived') : t('partiallyReceived'), 'success');
    setReceiveModal(null);
    loadBackorders();
    loadReceipts();
  };

  const boColumns: Column<PurchaseBackorderRow>[] = [
    { key: 'invoice_number', header: t('purchaseOrder'), render: (r) => <span className="font-medium text-ui-text">{r.invoice_number}</span> },
    { key: 'supplier_name', header: t('supplier'), render: (r) => r.supplier_name },
    { key: 'branch', header: t('branch'), render: (r) => <BranchBadge name={branchName(r.branch_id)} /> },
    { key: 'item_name', header: t('item'), render: (r) => r.item_name },
    { key: 'unit_name', header: lang === 'ar' ? 'الوحدة' : 'Unit', render: (r) => r.unit_name || '-' },
    { key: 'ordered_quantity', header: t('orderedQty'), render: (r) => r.ordered_quantity },
    { key: 'received_quantity', header: t('receivedQty'), render: (r) => r.received_quantity },
    { key: 'remaining', header: t('remainingQty'), render: (r) => <span className="font-semibold text-ui-danger">{r.remaining}</span> },
    { key: 'unit_cost', header: t('unitCost'), render: (r) => formatCurrency(r.unit_cost, currency, lang) },
    { key: 'remaining_value', header: lang === 'ar' ? 'قيمة المتبقي' : 'Remaining Value', render: (r) => formatCurrency(Number(r.remaining || 0) * Number(r.unit_cost || 0), currency, lang) },
    { key: 'actions', header: t('actions'), render: (r) => can('purchases.receiving') ? (
      <Button size="sm" onClick={() => openReceive(r)}><PackageOpen className="w-4 h-4" /> {t('receive')}</Button>
    ) : null },
  ];

  const rColumns: Column<PurchaseReceiptRow>[] = [
    { key: 'receipt_number', header: t('receiptNumber'), render: (r) => <span className="font-medium text-ui-text">{r.receipt_number}</span> },
    { key: 'invoice_number', header: t('purchaseOrder'), render: (r) => r.invoice_number },
    { key: 'supplier_name', header: t('supplier'), render: (r) => r.supplier_name },
    { key: 'branch', header: t('branch'), render: (r) => <BranchBadge name={branchName(r.branch_id)} /> },
    { key: 'item_count', header: t('itemsReceived'), render: (r) => r.item_count },
    { key: 'total_quantity', header: t('receivedQty'), render: (r) => r.total_quantity },
    { key: 'received_at', header: t('receivedAt'), render: (r) => formatDate(r.received_at, lang) },
  ];

  const evColumns: Column<SupplierEvaluationRow>[] = [
    { key: 'supplier_name', header: t('supplier'), render: (r) => <span className="font-medium text-ui-text">{r.supplier_name}</span> },
    { key: 'orders_count', header: t('ordersCount'), render: (r) => r.orders_count },
    { key: 'total_purchased', header: t('totalPurchases'), render: (r) => <span className="font-semibold">{formatCurrency(r.total_purchased, currency, lang)}</span> },
    { key: 'total_returned', header: t('totalReturned'), render: (r) => formatCurrency(r.total_returned, currency, lang) },
    { key: 'return_rate', header: t('returnRate'), render: (r) => `${r.return_rate}%` },
    { key: 'avg_order_value', header: t('avgOrderValue'), render: (r) => formatCurrency(r.avg_order_value, currency, lang) },
    { key: 'quotations_count', header: t('quotationsCount'), render: (r) => r.quotations_count },
    { key: 'last_purchase_at', header: t('lastPurchaseAt'), render: (r) => (r.last_purchase_at ? formatDate(r.last_purchase_at, lang) : '-') },
  ];

  return (
    <DesignSurface testId="receiving-page">
      <DesignPageHeader title={t('receiving')} />
      <div className="flex gap-2 mb-4">
        <Button size="sm" variant={tab === 'backorders' ? 'primary' : 'outline'} onClick={() => openTab('backorders')}><PackageOpen className="w-4 h-4" /> {t('backorders')}</Button>
        <Button size="sm" variant={tab === 'receipts' ? 'primary' : 'outline'} onClick={() => openTab('receipts')}><History className="w-4 h-4" /> {t('receipts')}</Button>
        <Button size="sm" variant={tab === 'evaluation' ? 'primary' : 'outline'} onClick={() => openTab('evaluation')}><Trophy className="w-4 h-4" /> {t('supplierEvaluation')}</Button>
      </div>

      {tab === 'backorders' && (
        <DesignPanel testId="backorders-panel">
          <DataTable columns={boColumns} data={backorders} loading={boLoading} emptyMessage={t('noData')} />
        </DesignPanel>
      )}
      {tab === 'receipts' && (
        <DesignPanel testId="receipts-panel">
          <DataTable columns={rColumns} data={receipts} loading={rLoading} emptyMessage={t('noData')} />
        </DesignPanel>
      )}
      {tab === 'evaluation' && (
        <DesignPanel testId="evaluation-panel">
          <DataTable columns={evColumns} data={evaluation} loading={evLoading} emptyMessage={t('noData')} />
        </DesignPanel>
      )}

      <Modal open={!!receiveModal} onClose={() => setReceiveModal(null)} title={t('receiveItems')} size="lg">
        {receiveModal && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-ui-subtle">{t('purchaseOrder')}: </span><span className="font-medium">{receiveModal.invoice_number}</span></div>
              <div><span className="text-ui-subtle">{t('supplier')}: </span><span className="font-medium">{receiveModal.supplier_name}</span></div>
              <div className="col-span-2 flex items-center gap-2"><span className="text-ui-subtle">{t('branch')}: </span><BranchBadge name={branchName(receiveModal.branch_id)} /></div>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="border-b border-ui-border">
                <th className="text-start py-2 font-semibold text-ui-muted">{t('item')}</th>
                <th className="text-center py-2 font-semibold text-ui-muted">{lang === 'ar' ? 'الوحدة' : 'Unit'}</th>
                <th className="text-center py-2 font-semibold text-ui-muted">{t('orderedQty')}</th>
                <th className="text-center py-2 font-semibold text-ui-muted">{t('receivedQty')}</th>
                <th className="text-center py-2 font-semibold text-ui-muted">{t('remainingQty')}</th>
                <th className="text-center py-2 font-semibold text-ui-muted">{t('unitCost')}</th>
                <th className="text-center py-2 font-semibold text-ui-muted">{t('receive')}</th>
                <th className="text-end py-2 font-semibold text-ui-muted">{lang === 'ar' ? 'قيمة الاستلام' : 'Receipt Value'}</th>
              </tr></thead>
              <tbody>
                {lines.map((l, i) => {
                  const receiptQty = parseFloat(l.qty) || 0;
                  return (
                    <tr key={l.purchase_item_id} className="border-b border-ui-border">
                      <td className="py-2 text-ui-text">{l.name}</td>
                      <td className="py-2 text-center text-ui-text">{l.unit_name || '-'}</td>
                      <td className="py-2 text-center text-ui-text">{l.ordered}</td>
                      <td className="py-2 text-center text-ui-text">{l.received}</td>
                      <td className="py-2 text-center font-semibold text-ui-danger">{l.ordered - l.received}</td>
                      <td className="py-2 text-center text-ui-text">{formatCurrency(l.unit_cost, currency, lang)}</td>
                      <td className="py-2 text-center">
                        <input type="number" min="0" max={l.ordered - l.received} step="0.01" value={l.qty} placeholder="0" onChange={(e) => updateQty(i, e.target.value)} className="w-24 rounded-md border border-ui-border bg-ui-surface px-2 py-1 text-sm" />
                      </td>
                      <td className="py-2 text-end font-medium text-ui-text">{formatCurrency(receiptQty * Number(l.unit_cost || 0), currency, lang)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex justify-end gap-2 pt-2 border-t border-ui-border">
              <Button variant="secondary" onClick={() => setReceiveModal(null)}>{t('cancel')}</Button>
              <Button onClick={saveReceipt} disabled={saving}><Save className="w-4 h-4" /> {saving ? t('loading') : t('save')}</Button>
            </div>
          </div>
        )}
      </Modal>
    </DesignSurface>
  );
}
