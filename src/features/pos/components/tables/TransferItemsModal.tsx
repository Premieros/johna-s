import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRightLeft, CheckCircle2, Search, UtensilsCrossed } from 'lucide-react';
import * as api from '@/api';
import { supabase } from '@/api';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { useLanguage } from '@/context/LanguageContext';
import type { CartItem, DiningTable, OrderItem } from '@/lib/types';
import type { PosItemTransferResult } from '../../types';
import { transferExpectedLine } from '../../utils/itemTransfer';
import { userFacingErrorMessage } from '@/lib/userFacingError';

export type TransferItemLine = {
  item: CartItem;
  orderItemId: string;
  saved: OrderItem;
};

interface TransferItemsModalProps {
  open: boolean;
  onClose: () => void;
  lines: TransferItemLine[];
  orderId: string | null;
  sourceTable: DiningTable | null;
  onCompleted: (result: PosItemTransferResult) => void;
}

export function TransferItemsModal({
  open,
  onClose,
  lines,
  orderId,
  sourceTable,
  onCompleted,
}: TransferItemsModalProps) {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const [tables, setTables] = useState<DiningTable[]>([]);
  const [query, setQuery] = useState('');
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [error, setError] = useState('');
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Parameters<typeof api.pos.transferOrderItemsToTable>[0] | null>(null);
  const submitting = useRef(false);
  const close = () => { if (!submitting.current && !pending) onClose(); };
  const validQuantities = lines.every(({ orderItemId, saved }) => {
    const quantity = Number(quantities[orderItemId] ?? saved.quantity);
    return Number.isFinite(quantity) && quantity > 0 && quantity <= Number(saved.quantity)
      && Math.abs(quantity * 10000 - Math.round(quantity * 10000)) < 0.000001;
  });

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedTableId(null);
    setError('');
    setQuantities({});
    setPending(null);
  }, [open]);

  useEffect(() => {
    if (!open || !sourceTable?.branch_id) {
      setTables([]);
      return;
    }
    let cancelled = false;
    setLoadingTables(true);
    supabase
      .from('dining_tables')
      .select('*')
      .eq('branch_id', sourceTable.branch_id)
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
  }, [open, sourceTable?.branch_id, isAr]);

  const targets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tables.filter((table) =>
      table.id !== sourceTable?.id &&
      (!q || table.name.toLowerCase().includes(q)),
    );
  }, [tables, sourceTable?.id, query]);

  const perform = async () => {
    if (submitting.current || (!pending && (!orderId || !selectedTableId || !lines.length || !validQuantities))) return;
    const command = pending || {
      p_order_id: orderId!, p_order_item_ids: lines.map((line) => line.orderItemId), p_target_table_id: selectedTableId!,
      p_transfer: {
        operation_id: crypto.randomUUID(),
        quantities: lines.map(({ orderItemId, saved }) => ({
          order_item_id: orderItemId, quantity: Number(quantities[orderItemId] ?? saved.quantity), expected: transferExpectedLine(saved),
        })),
      },
    };
    submitting.current = true;
    setPending(command);
    setLoading(true);
    setError('');
    try {
      const { data, error: rpcError } = await api.pos.transferOrderItemsToTable(command);
      if (rpcError || !data || typeof data.success !== 'boolean') throw rpcError || new Error('TRANSFER_OUTCOME_UNKNOWN');
      if (!data.success) {
        setPending(null); // The server rejected and rolled back the entire command.
        setError(data.error === 'PARTIAL_TRANSFER_DISABLED'
          ? (isAr ? 'نقل الكميات الجزئية متوقف مؤقتًا. لم يتم نقل أي كمية.' : 'Quantity transfer is temporarily disabled. Nothing was moved.')
          : userFacingErrorMessage(data, isAr ? 'ar' : 'en'));
        return;
      }
      if (!data.snapshot || !data.quantity_transfers) throw new Error('TRANSFER_OUTCOME_UNKNOWN');
      setPending(null);
      onCompleted(data);
      onClose();
    } catch {
      setError(isAr
        ? 'لم يتأكد وصول النتيجة. اضغط «التحقق وإعادة المحاولة»؛ سيُستخدم نفس رقم العملية لمنع النقل مرتين.'
        : 'The outcome could not be confirmed. Retry the same operation to verify it without moving twice.');
    } finally {
      submitting.current = false;
      setLoading(false);
    }
  };

  if (!open || (!pending && (!orderId || !sourceTable || lines.length === 0))) return null;

  return (
    <Modal open={open} onClose={close} title={isAr ? 'نقل الأصناف إلى طاولة أخرى' : 'Move items to another table'} size="lg">
      <div className="space-y-4">
        <div className="rounded-2xl border border-ui-border bg-ui-page-alt p-3">
          <p className="text-xs font-black text-ui-text">
            {isAr ? `تم تحديد ${lines.length} صنف` : `${lines.length} selected item(s)`}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {lines.map(({ item, orderItemId, saved }) => (
              <label key={orderItemId} className="rounded-lg bg-ui-surface px-2 py-1 text-[10px] font-bold text-ui-muted">
                {item.product.name} · {isAr ? 'نقل من' : 'Move from'} {saved.quantity}
                <input type="number" min="0.0001" max={saved.quantity} step="0.0001"
                  aria-label={`${isAr ? 'كمية النقل' : 'Transfer quantity'} ${item.product.name}`}
                  data-testid={`transfer-quantity-${orderItemId}`} disabled={loading || !!pending}
                  value={quantities[orderItemId] ?? String(saved.quantity)}
                  onChange={(event) => setQuantities((current) => ({ ...current, [orderItemId]: event.target.value }))}
                  className="ms-2 h-9 w-24 rounded-lg border border-ui-border bg-ui-surface px-2 text-sm text-ui-text" />
              </label>
            ))}
          </div>
          <p className="mt-2 text-[10px] font-bold text-ui-subtle">
            {isAr
              ? 'يتم نقل الأصناف المحددة حتى لو كانت مرسلة للمطبخ. ينتقل سجل المطبخ معها دون إعادة إرسال أو خصم مخزون جديد.'
              : 'Selected lines move even after kitchen send. Their kitchen history follows them without re-sending or another stock deduction.'}
          </p>
        </div>

        <div className="relative">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ui-subtle" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={isAr ? 'ابحث عن طاولة...' : 'Search table...'}
            className="h-11 w-full rounded-xl border border-ui-border bg-ui-surface ps-10 pe-3 text-sm font-bold text-ui-text outline-none focus:border-ui-primary"
          />
        </div>

        <div className="max-h-[320px] overflow-y-auto pr-1">
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
                    disabled={loading || !!pending}
                    data-testid={`transfer-items-target-${table.id}`}
                    onClick={() => { setSelectedTableId(table.id); setError(''); }}
                    className={`rounded-xl border p-3 text-start transition ${selected ? 'border-ui-primary bg-ui-primary-soft ring-2 ring-ui-ring' : 'border-ui-border bg-ui-surface hover:border-ui-primary'}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-black text-ui-text">{table.name}</span>
                      {selected ? <CheckCircle2 className="h-4 w-4 shrink-0 text-ui-success" /> : <UtensilsCrossed className="h-4 w-4 shrink-0 text-ui-subtle" />}
                    </div>
                    <p className={`mt-2 truncate text-[10px] font-black ${occupied ? 'text-ui-warning' : 'text-ui-success'}`}>
                      {occupied ? (isAr ? 'مشغولة — إضافة للطلب الحالي' : 'Occupied — add to current order') : (isAr ? 'متاحة — إنشاء طلب جديد' : 'Vacant — create new order')}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {error && <div className="rounded-xl border border-ui-danger/20 bg-ui-danger/10 p-3 text-xs font-bold text-ui-danger">{error}</div>}

        <div className="flex items-center justify-end gap-2 border-t border-ui-border pt-3">
          <Button variant="secondary" onClick={close} disabled={loading || !!pending}>{isAr ? 'إلغاء' : 'Cancel'}</Button>
          <Button variant="primary" onClick={() => void perform()} disabled={loading || (!pending && (!selectedTableId || !validQuantities))}>
            <ArrowRightLeft className="h-4 w-4" />
            {pending && !loading ? (isAr ? 'التحقق وإعادة المحاولة' : 'Verify and retry') : (isAr ? 'نقل المحدد' : 'Move selected')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
