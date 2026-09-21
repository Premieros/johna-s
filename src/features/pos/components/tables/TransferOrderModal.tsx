import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, AlertTriangle, GitMerge, ShieldCheck, Users } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import type { DiningArea, DiningTable, Order } from '@/lib/types';
import { userFacingErrorMessage } from '@/lib/userFacingError';

interface TransferOrderModalProps {
  open: boolean;
  onClose: () => void;
  order: Order | null;
  sourceTable: DiningTable | null;
  tables: DiningTable[];
  areas?: DiningArea[];
  ordersByTable: Record<string, Order[]>;
  onConfirmTransfer?: (orderId: string, fromTableId: string, toTableId: string) => Promise<boolean>;
  onOperatorTransferred?: () => void;
}

export function TransferOrderModal({
  open,
  onClose,
  order,
  sourceTable,
  tables,
  areas = [],
  ordersByTable,
  onOperatorTransferred,
}: TransferOrderModalProps) {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';

  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [activeAreaFilter, setActiveAreaFilter] = useState<'all' | 'indoor' | 'outdoor'>('all');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [operatorTargets, setOperatorTargets] = useState<Array<{ user_id: string; display_name: string }>>([]);
  const [selectedOperatorId, setSelectedOperatorId] = useState<string>('');
  const [operatorLoading, setOperatorLoading] = useState(false);
  const [operatorError, setOperatorError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedTargetId(null);
    setReason('');
    setErrorMsg(null);
    setPendingRequestId(null);
    setPendingStatus(null);
    setSelectedOperatorId('');
    setOperatorError(null);
  }, [open, order?.id]);

  useEffect(() => {
    if (!open || !order?.id) {
      setOperatorTargets([]);
      return;
    }
    let cancelled = false;
    setOperatorLoading(true);
    api.pos.listOrderTransferTargets({ p_order_id: order.id })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setOperatorTargets([]);
          setOperatorError(userFacingErrorMessage(error, isAr ? 'ar' : 'en'));
          return;
        }
        setOperatorTargets(Array.isArray(data) ? data : []);
      })
      .finally(() => {
        if (!cancelled) setOperatorLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, order?.id]);

  const availableTargetTables = useMemo(() => tables.filter((tb) => tb.id !== sourceTable?.id), [tables, sourceTable]);

  const filteredTables = useMemo(() => {
    return availableTargetTables.filter((tb) => {
      if (activeAreaFilter === 'all') return true;
      const areaName = areas.find((a) => a.id === tb.area_id)?.name?.toLowerCase() || '';
      const tableName = tb.name.toLowerCase();
      const isOutdoor =
        areaName.includes('outdoor') || areaName.includes('خارج') || areaName.includes('تراس') ||
        areaName.includes('terrace') || areaName.includes('patio') ||
        tableName.includes('outdoor') || tableName.includes('خارج');
      return activeAreaFilter === 'outdoor' ? isOutdoor : !isOutdoor;
    });
  }, [availableTargetTables, activeAreaFilter, areas]);

  const selectedTargetTable = useMemo(() => tables.find((tb) => tb.id === selectedTargetId) || null, [tables, selectedTargetId]);
  const targetOrder = selectedTargetTable ? (ordersByTable[selectedTargetTable.id]?.[0] || null) : null;
  const targetHasOrder = !!targetOrder;
  const actionType = targetHasOrder ? 'merge_order' : 'transfer_order';

  const performOperatorTransfer = async () => {
    if (!order || !selectedOperatorId || operatorLoading) return;
    setOperatorLoading(true);
    setOperatorError(null);
    try {
      const { data, error } = await api.floorPlan.transferOrderOperator({
        p_order_id: order.id,
        p_target_user_id: selectedOperatorId,
      });
      if (error) {
        setOperatorError(userFacingErrorMessage(error, isAr ? 'ar' : 'en'));
        return;
      }
      if (!data?.success) {
        setOperatorError(userFacingErrorMessage(
          data ?? (isAr ? 'تعذر نقل المستخدم.' : 'Could not transfer the operator.'),
          isAr ? 'ar' : 'en',
        ));
        return;
      }
      window.dispatchEvent(new CustomEvent('pos:operator-transferred', {
        detail: { orderId: order.id, userId: selectedOperatorId },
      }));
      setSelectedOperatorId('');
      onOperatorTransferred?.();
      onClose();
    } finally {
      setOperatorLoading(false);
    }
  };

  const perform = async () => {
    if (!order || !sourceTable || !selectedTargetId || loading) return;
    if (reason.trim().length < 3) {
      setErrorMsg(isAr ? 'اكتب سبب العملية للمدير.' : 'Enter a reason for manager approval.');
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    try {
      const payload = targetHasOrder
        ? { target_order_id: targetOrder!.id, target_table_id: selectedTargetId }
        : { target_table_id: selectedTargetId };

      const { data, error } = await api.pos.performOrderAction({
        p_action_type: actionType,
        p_order_id: order.id,
        p_payload: payload,
        p_reason: reason.trim(),
      });

      if (error) {
        setErrorMsg(userFacingErrorMessage(error, isAr ? 'ar' : 'en'));
        return;
      }

      if (data?.success) {
        setPendingRequestId(null);
        setPendingStatus(null);
        setSelectedTargetId(null);
        onClose();
        return;
      }

      if (data?.error === 'MANAGER_APPROVAL_REQUIRED' && data.request_id) {
        setPendingRequestId(data.request_id);
        setPendingStatus(data.status || 'pending');
        return;
      }

      setErrorMsg(
        data?.error === 'SOURCE_HAS_SENT_ITEMS'
          ? (isAr
            ? 'لا يمكن دمج طلب يحتوي أصنافًا مرسلة للمطبخ حاليًا حتى لا يتغير سجل KDS. استخدم نقل الطاولة للطلب كاملًا أو أكمل الطلب كما هو.'
            : 'A source order with sent kitchen items cannot currently be merged because the KDS snapshot is immutable. Transfer the whole table order instead or finish it separately.')
          : userFacingErrorMessage(data ?? (isAr ? 'تعذر تنفيذ العملية.' : 'Could not execute the action.'), isAr ? 'ar' : 'en'),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open || !pendingRequestId) return;
    let cancelled = false;
    const check = async () => {
      const { data } = await supabase
        .from('approval_requests')
        .select('status')
        .eq('id', pendingRequestId)
        .maybeSingle();
      if (cancelled || !data) return;
      const status = (data as { status: string }).status;
      setPendingStatus(status);
      if (status === 'approved') {
        setPendingRequestId(null);
        await perform();
      } else if (status === 'rejected' || status === 'expired') {
        setPendingRequestId(null);
        setErrorMsg(status === 'rejected'
          ? (isAr ? 'رفض المدير العملية.' : 'The manager rejected the action.')
          : (isAr ? 'انتهت صلاحية طلب الموافقة. أعد المحاولة.' : 'The approval request expired. Try again.'));
      }
    };
    const id = window.setInterval(() => void check(), 2000);
    void check();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pendingRequestId]);

  if (!open || !order || !sourceTable) return null;

  return (
    <Modal open={open} onClose={onClose} title={isAr ? 'نقل أو دمج الطلب' : 'Transfer or Merge Order'} size="lg">
      <div className="space-y-4">
        <div className="flex items-center justify-between rounded-2xl border border-ui-border bg-ui-page p-3.5">
          <div>
            <p className="text-xs text-ui-subtle">{isAr ? 'الطلب الحالي' : 'Active Order'}</p>
            <p className="text-sm font-black text-ui-text">#{order.order_number} · {sourceTable.name}</p>
          </div>
          <span className="inline-flex items-center rounded-lg bg-ui-primary-soft px-2.5 py-1 text-xs font-black text-ui-accent">
            {isAr ? 'المخزون وKDS لا يتغيران' : 'Inventory & KDS unchanged'}
          </span>
        </div>

        <div className="rounded-2xl border border-ui-border bg-ui-surface p-3.5 space-y-3">
          <div>
            <p className="text-sm font-black text-ui-text">{isAr ? 'نقل مسؤولية الطلب لمستخدم آخر' : 'Transfer order ownership'}</p>
            <p className="mt-1 text-[11px] font-semibold text-ui-muted">
              {isAr
                ? 'بعد النقل يصبح المستخدم الجديد مسؤولًا عن الطلب، وتُنسب له المبيعات الناتجة من هذا الطلب عند الدفع.'
                : 'After transfer, the selected user owns the order and sales settled from this order are attributed to that user.'}
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              data-testid="pos-operator-transfer-target"
              value={selectedOperatorId}
              onChange={(event) => { setSelectedOperatorId(event.target.value); setOperatorError(null); }}
              disabled={operatorLoading}
              className="h-11 flex-1 rounded-xl border border-ui-border bg-ui-surface px-3 text-sm font-bold text-ui-text outline-none focus:border-ui-primary"
            >
              <option value="">{operatorLoading ? (isAr ? 'جارٍ تحميل المستخدمين...' : 'Loading users...') : (isAr ? 'اختر المستخدم الجديد' : 'Select new user')}</option>
              {operatorTargets.map((target) => (
                <option key={target.user_id} value={target.user_id}>{target.display_name}</option>
              ))}
            </select>
            <Button
              variant="secondary"
              onClick={() => void performOperatorTransfer()}
              disabled={operatorLoading || !selectedOperatorId}
            >
              <Users className="h-4 w-4" />
              <span>{isAr ? 'نقل المستخدم' : 'Transfer User'}</span>
            </Button>
          </div>
          {operatorError && <p className="text-xs font-bold text-rose-600">{operatorError}</p>}
        </div>

        <div className="flex items-center gap-1 rounded-xl bg-ui-page-alt p-1">
          {(['all','indoor','outdoor'] as const).map((filter) => (
            <button
              key={filter}
              type="button"
              onClick={() => setActiveAreaFilter(filter)}
              className={`flex-1 rounded-lg py-1.5 text-xs font-black transition ${activeAreaFilter === filter ? 'bg-ui-surface text-ui-text shadow-ui-xs' : 'text-ui-muted hover:text-ui-text'}`}
            >
              {filter === 'all'
                ? (isAr ? `كل الطاولات (${availableTargetTables.length})` : `All (${availableTargetTables.length})`)
                : filter === 'indoor'
                  ? (isAr ? 'داخلية' : 'Indoor')
                  : (isAr ? 'خارجية' : 'Outdoor')}
            </button>
          ))}
        </div>

        <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
          <p className="text-xs font-bold text-ui-subtle">{isAr ? 'اختر الطاولة المستهدفة:' : 'Select destination table:'}</p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
            {filteredTables.map((tb) => {
              const hasOrd = (ordersByTable[tb.id]?.length || 0) > 0;
              const selected = selectedTargetId === tb.id;
              return (
                <button
                  key={tb.id}
                  type="button"
                  data-testid={`pos-structure-target-${tb.id}`}
                  onClick={() => { setSelectedTargetId(tb.id); setErrorMsg(null); }}
                  className={`flex flex-col items-start justify-between rounded-xl border p-2.5 text-start transition ${selected ? 'border-ui-primary bg-ui-primary-soft ring-2 ring-ui-ring' : hasOrd ? 'border-amber-500/30 bg-amber-500/5 hover:border-amber-500/60' : 'border-ui-border bg-ui-surface hover:border-emerald-500'}`}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="text-sm font-black text-ui-text">{tb.name}</span>
                    <span className="flex items-center gap-0.5 text-[10px] text-ui-muted"><Users className="h-2.5 w-2.5" /> {tb.capacity}</span>
                  </div>
                  <span className={`mt-2 block w-full rounded px-1.5 py-0.5 text-center text-[10px] font-bold ${hasOrd ? 'bg-amber-500/10 text-amber-600' : 'bg-emerald-500/10 text-emerald-600'}`}>
                    {hasOrd ? (isAr ? 'مشغولة — Merge' : 'Occupied — Merge') : (isAr ? 'فارغة — Transfer' : 'Vacant — Transfer')}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {selectedTargetTable && (
          <div className={`rounded-xl border p-3 text-xs font-semibold ${targetHasOrder ? 'border-amber-500/20 bg-amber-500/5 text-amber-700' : 'border-emerald-500/20 bg-emerald-500/5 text-emerald-700'}`}>
            {targetHasOrder
              ? (isAr
                ? `Merge: سيتم ضم الطلب #${order.order_number} إلى الطلب #${targetOrder?.order_number} على ${selectedTargetTable.name}.`
                : `Merge order #${order.order_number} into #${targetOrder?.order_number} on ${selectedTargetTable.name}.`)
              : (isAr
                ? `Transfer: سيتم نقل الطلب كاملًا من ${sourceTable.name} إلى ${selectedTargetTable.name}.`
                : `Transfer the whole order from ${sourceTable.name} to ${selectedTargetTable.name}.`)}
          </div>
        )}

        <label className="block">
          <span className="mb-1 block text-[11px] font-black text-ui-muted">{isAr ? 'سبب العملية — يظهر للمدير' : 'Reason — shown to manager'}</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={isAr ? 'مثال: نقل الضيف لطاولة أخرى' : 'Example: guest moved to another table'}
            className="h-11 w-full rounded-xl border border-ui-border bg-ui-surface px-3 text-sm font-bold text-ui-text outline-none focus:border-ui-primary"
          />
        </label>

        {pendingRequestId && (
          <div className="flex items-center gap-3 rounded-2xl border border-ui-warning/30 bg-ui-warning/10 p-3 text-ui-warning">
            <ShieldCheck className="h-5 w-5 shrink-0" />
            <div>
              <p className="text-xs font-black">{isAr ? 'بانتظار موافقة المدير' : 'Waiting for manager approval'}</p>
              <p className="mt-0.5 text-[10px] font-bold opacity-80">{isAr ? 'سيتم التنفيذ تلقائيًا فور الموافقة.' : 'It will execute automatically after approval.'} · {pendingStatus || 'pending'}</p>
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="flex items-center gap-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-xs font-bold text-rose-600">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-ui-border pt-3">
          <Button variant="secondary" onClick={onClose} disabled={loading}>{t('cancel')}</Button>
          <Button
            variant="primary"
            onClick={() => void perform()}
            disabled={loading || !!pendingRequestId || !selectedTargetId || reason.trim().length < 3}
          >
            {targetHasOrder ? <GitMerge className="h-4 w-4" /> : <ArrowRightLeft className="h-4 w-4" />}
            <span>
              {pendingRequestId
                ? (isAr ? 'بانتظار المدير' : 'Waiting')
                : targetHasOrder
                  ? (isAr ? 'طلب Merge' : 'Request Merge')
                  : (isAr ? 'طلب Transfer' : 'Request Transfer')}
            </span>
          </Button>
        </div>
      </div>
    </Modal>
  );
}
