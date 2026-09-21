import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, CheckCircle2, Search, ShoppingBag, ShieldCheck, UtensilsCrossed } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { useLanguage } from '@/context/LanguageContext';
import type { CartItem, DiningTable } from '@/lib/types';
import { userFacingErrorMessage } from '@/lib/userFacingError';

interface TransferItemModalProps {
  open: boolean;
  onClose: () => void;
  item: CartItem | null;
  orderId: string | null;
  orderItemId: string | null;
  sourceTable: DiningTable | null;
  onCompleted: (quantity: number) => void;
}

type SplitTargetKind = 'quick' | 'table';

export function TransferItemModal({ open, onClose, item, orderId, orderItemId, sourceTable, onCompleted }: TransferItemModalProps) {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const [branchId, setBranchId] = useState('');
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [query, setQuery] = useState('');
  const [targetKind, setTargetKind] = useState<SplitTargetKind>('quick');
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [error, setError] = useState('');
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuantity(Math.min(1, item?.quantity || 1));
    setReason('');
    setTargetKind('quick');
    setSelectedTableId(null);
    setPendingRequestId(null);
    setPendingStatus(null);
    setError('');
  }, [open, item?.quantity]);

  useEffect(() => {
    if (!open || !orderId) return;
    let cancelled = false;
    supabase.from('orders').select('branch_id').eq('id', orderId).maybeSingle().then(({ data }) => {
      if (!cancelled) setBranchId((data as { branch_id?: string } | null)?.branch_id || sourceTable?.branch_id || '');
    });
    return () => { cancelled = true; };
  }, [open, orderId, sourceTable?.branch_id]);

  useEffect(() => {
    if (!open || targetKind !== 'table' || !branchId) return;
    let cancelled = false;
    setLoadingTables(true);
    supabase
      .from('dining_tables')
      .select('*')
      .eq('branch_id', branchId)
      .eq('is_active', true)
      .order('name')
      .then(({ data, error: fetchError }) => {
        if (cancelled) return;
        if (fetchError) {
          setError(userFacingErrorMessage(fetchError, isAr ? 'ar' : 'en'));
          setTables([]);
        } else {
          setTables((data as DiningTable[]) || []);
        }
        setLoadingTables(false);
      });
    return () => { cancelled = true; };
  }, [open, targetKind, branchId]);

  const targets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tables.filter((table) => table.id !== sourceTable?.id && (!q || table.name.toLowerCase().includes(q)));
  }, [tables, sourceTable?.id, query]);

  const perform = async () => {
    if (!orderId || !orderItemId || !item || loading) return;
    if (quantity <= 0 || quantity > item.quantity) {
      setError(isAr ? 'حدد كمية صحيحة للفصل.' : 'Choose a valid split quantity.');
      return;
    }
    if (targetKind === 'table' && !selectedTableId) {
      setError(isAr ? 'اختر الطاولة المستهدفة.' : 'Choose the target table.');
      return;
    }
    if (reason.trim().length < 3) {
      setError(isAr ? 'اكتب سبب الفصل للمدير.' : 'Enter a reason for manager approval.');
      return;
    }

    setLoading(true);
    setError('');
    try {
      const payload = {
        order_item_id: orderItemId,
        quantity,
        target_kind: targetKind,
        target_table_id: targetKind === 'table' ? selectedTableId : null,
      };
      const { data, error: rpcError } = await api.pos.performOrderAction({
        p_action_type: 'split_order',
        p_order_id: orderId,
        p_payload: payload,
        p_reason: reason.trim(),
      });

      if (rpcError) {
        setError(userFacingErrorMessage(rpcError, isAr ? 'ar' : 'en'));
        return;
      }

      if (data?.success) {
        onCompleted(quantity);
        setPendingRequestId(null);
        setPendingStatus(null);
        onClose();
        return;
      }

      if (data?.error === 'MANAGER_APPROVAL_REQUIRED' && data.request_id) {
        setPendingRequestId(data.request_id);
        setPendingStatus(data.status || 'pending');
        return;
      }

      setError(
        data?.error === 'ITEM_ALREADY_SENT'
          ? (isAr ? 'لا يمكن فصل صنف تم إرساله للمطبخ لأن سجل KDS يجب أن يظل ثابتًا.' : 'A line already sent to kitchen cannot be split because its KDS snapshot must stay immutable.')
          : userFacingErrorMessage(data ?? (isAr ? 'تعذر فصل الصنف.' : 'Could not split the item.'), isAr ? 'ar' : 'en'),
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
        setError(status === 'rejected'
          ? (isAr ? 'رفض المدير طلب الفصل.' : 'The manager rejected the split request.')
          : (isAr ? 'انتهت صلاحية طلب الموافقة. أعد المحاولة.' : 'The approval request expired. Try again.'));
      }
    };
    const id = window.setInterval(() => void check(), 2000);
    void check();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // perform intentionally reuses the exact payload currently displayed in this modal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pendingRequestId]);

  if (!open || !item || !orderId || !orderItemId) return null;

  return (
    <Modal open={open} onClose={onClose} title={isAr ? 'Split — فصل صنف من الطلب' : 'Split — Move item to another order'} size="lg">
      <div className="space-y-4">
        <div className="rounded-2xl border border-ui-border bg-ui-page-alt p-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-ui-primary-soft text-ui-accent">
              <ArrowRightLeft className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-black text-ui-text">{item.product.name}</p>
              <p className="text-[11px] font-bold text-ui-subtle">
                {isAr
                  ? `${sourceTable ? `من ${sourceTable.name}` : 'من الطلب الحالي'} · الكمية الحالية ${item.quantity}`
                  : `${sourceTable ? `From ${sourceTable.name}` : 'From current order'} · Current qty ${item.quantity}`}
              </p>
            </div>
          </div>
          <p className="mt-2 text-[11px] font-bold text-ui-muted">
            {isAr
              ? 'الفصل لا يخصم مخزونًا ولا يعيد إرسال KDS. للكاشير يتم إنشاء طلب موافقة وينفذ تلقائيًا بعد موافقة المدير.'
              : 'Split never changes inventory or resends KDS. Cashier actions wait for manager approval and execute automatically after approval.'}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => { setTargetKind('quick'); setSelectedTableId(null); setError(''); }}
            className={`rounded-2xl border p-3 text-start transition ${targetKind === 'quick' ? 'border-ui-primary bg-ui-primary-soft ring-2 ring-ui-ring' : 'border-ui-border bg-ui-surface'}`}
          >
            <ShoppingBag className="mb-2 h-5 w-5 text-ui-accent" />
            <p className="text-xs font-black text-ui-text">{isAr ? 'طلب سريع منفصل' : 'New quick order'}</p>
            <p className="mt-1 text-[10px] font-bold text-ui-subtle">{isAr ? 'يفتح طلب Take Away جديد' : 'Creates a new takeaway order'}</p>
          </button>
          <button
            type="button"
            onClick={() => { setTargetKind('table'); setError(''); }}
            className={`rounded-2xl border p-3 text-start transition ${targetKind === 'table' ? 'border-ui-primary bg-ui-primary-soft ring-2 ring-ui-ring' : 'border-ui-border bg-ui-surface'}`}
          >
            <UtensilsCrossed className="mb-2 h-5 w-5 text-ui-success" />
            <p className="text-xs font-black text-ui-text">{isAr ? 'إلى طاولة' : 'To a table'}</p>
            <p className="mt-1 text-[10px] font-bold text-ui-subtle">{isAr ? 'مشغولة: يضاف للطلب · فارغة: يفتح طلب جديد' : 'Occupied: joins order · Vacant: creates order'}</p>
          </button>
        </div>

        <label className="block">
          <span className="mb-1 block text-[11px] font-black text-ui-muted">{isAr ? 'الكمية المراد فصلها' : 'Quantity to split'}</span>
          <input
            type="number"
            min={1}
            max={item.quantity}
            step={1}
            value={quantity}
            onChange={(event) => setQuantity(Math.max(1, Math.min(item.quantity, Number(event.target.value) || 1)))}
            className="h-11 w-full rounded-xl border border-ui-border bg-ui-surface px-3 text-sm font-black text-ui-text outline-none focus:border-ui-primary"
          />
        </label>

        {targetKind === 'table' && (
          <>
            <div className="relative">
              <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ui-subtle" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={isAr ? 'ابحث عن طاولة...' : 'Search table...'}
                className="h-11 w-full rounded-xl border border-ui-border bg-ui-surface ps-10 pe-3 text-sm font-bold text-ui-text outline-none focus:border-ui-primary"
              />
            </div>

            <div className="max-h-[270px] overflow-y-auto pr-1">
              {loadingTables ? (
                <div className="py-8 text-center text-xs font-bold text-ui-muted">{isAr ? 'جاري تحميل الطاولات...' : 'Loading tables...'}</div>
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                  {targets.map((table) => {
                    const selected = selectedTableId === table.id;
                    const occupied = table.status === 'occupied';
                    return (
                      <button
                        key={table.id}
                        type="button"
                        data-testid={`split-item-target-${table.id}`}
                        onClick={() => { setSelectedTableId(table.id); setError(''); }}
                        className={`rounded-xl border p-3 text-start transition ${selected ? 'border-ui-primary bg-ui-primary-soft ring-2 ring-ui-ring' : 'border-ui-border bg-ui-surface hover:border-ui-primary'}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-xs font-black text-ui-text">{table.name}</span>
                          {selected ? <CheckCircle2 className="h-4 w-4 shrink-0 text-ui-success" /> : <UtensilsCrossed className="h-4 w-4 shrink-0 text-ui-subtle" />}
                        </div>
                        <p className={`mt-2 truncate text-[10px] font-black ${occupied ? 'text-ui-warning' : 'text-ui-success'}`}>
                          {occupied ? (isAr ? 'مشغولة — دمج الصنف' : 'Occupied — join order') : (isAr ? 'متاحة — طلب جديد' : 'Vacant — new order')}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        <label className="block">
          <span className="mb-1 block text-[11px] font-black text-ui-muted">{isAr ? 'سبب الفصل — يظهر للمدير' : 'Reason — shown to manager'}</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={isAr ? 'مثال: فصل حساب عميل' : 'Example: split guest bill'}
            className="h-11 w-full rounded-xl border border-ui-border bg-ui-surface px-3 text-sm font-bold text-ui-text outline-none focus:border-ui-primary"
          />
        </label>

        {pendingRequestId && (
          <div className="flex items-center gap-3 rounded-2xl border border-ui-warning/30 bg-ui-warning/10 p-3 text-ui-warning">
            <ShieldCheck className="h-5 w-5 shrink-0" />
            <div>
              <p className="text-xs font-black">{isAr ? 'بانتظار موافقة المدير' : 'Waiting for manager approval'}</p>
              <p className="mt-0.5 text-[10px] font-bold opacity-80">{isAr ? 'سيتم تنفيذ الفصل تلقائيًا فور الموافقة.' : 'The split will execute automatically after approval.'} · {pendingStatus || 'pending'}</p>
            </div>
          </div>
        )}

        {error && <div className="rounded-xl border border-ui-danger/20 bg-ui-danger/10 p-3 text-xs font-bold text-ui-danger">{error}</div>}

        <div className="flex items-center justify-end gap-2 border-t border-ui-border pt-3">
          <Button variant="secondary" onClick={onClose} disabled={loading}>{isAr ? 'إلغاء' : 'Cancel'}</Button>
          <Button
            variant="primary"
            onClick={() => void perform()}
            disabled={loading || !!pendingRequestId || (targetKind === 'table' && !selectedTableId) || reason.trim().length < 3}
          >
            <ArrowRightLeft className="h-4 w-4" />
            {pendingRequestId ? (isAr ? 'بانتظار المدير' : 'Waiting') : (isAr ? 'طلب Split' : 'Request Split')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
