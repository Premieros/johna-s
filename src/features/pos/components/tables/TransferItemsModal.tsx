import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, CheckCircle2, Search, UtensilsCrossed } from 'lucide-react';
import * as api from '@/api';
import { supabase } from '@/api';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { useLanguage } from '@/context/LanguageContext';
import type { CartItem, DiningTable } from '@/lib/types';

export type TransferItemLine = {
  item: CartItem;
  orderItemId: string;
};

interface TransferItemsModalProps {
  open: boolean;
  onClose: () => void;
  lines: TransferItemLine[];
  orderId: string | null;
  sourceTable: DiningTable | null;
  onCompleted: () => void;
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

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelectedTableId(null);
    setError('');
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
          setError(fetchError.message);
          setTables([]);
        } else {
          setTables((data as DiningTable[]) || []);
        }
        setLoadingTables(false);
      });
    return () => { cancelled = true; };
  }, [open, sourceTable?.branch_id]);

  const targets = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tables.filter((table) =>
      table.id !== sourceTable?.id &&
      (!q || table.name.toLowerCase().includes(q)),
    );
  }, [tables, sourceTable?.id, query]);

  const perform = async () => {
    if (!orderId || !selectedTableId || lines.length === 0 || loading) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: rpcError } = await api.pos.transferOrderItemsToTable({
        p_order_id: orderId,
        p_order_item_ids: lines.map((line) => line.orderItemId),
        p_target_table_id: selectedTableId,
      });
      if (rpcError) {
        setError(rpcError.message);
        return;
      }
      if (!data?.success) {
        const code = data?.error || '';
        setError(
          code === 'ITEM_ALREADY_SENT'
            ? (isAr ? 'يوجد صنف محدد تم إرساله للمطبخ؛ لا يمكن نقله بين الطلبات.' : 'A selected item was already sent to kitchen and cannot be moved.')
            : code === 'PERMISSION_DENIED'
              ? (isAr ? 'لا تملك صلاحية نقل الأصناف بين الطاولات.' : 'You do not have permission to move items between tables.')
              : data?.detail || code || (isAr ? 'تعذر نقل الأصناف.' : 'Could not move the selected items.'),
        );
        return;
      }
      onCompleted();
      onClose();
    } finally {
      setLoading(false);
    }
  };

  if (!open || !orderId || !sourceTable || lines.length === 0) return null;

  return (
    <Modal open={open} onClose={onClose} title={isAr ? 'نقل الأصناف إلى طاولة أخرى' : 'Move items to another table'} size="lg">
      <div className="space-y-4">
        <div className="rounded-2xl border border-ui-border bg-ui-page-alt p-3">
          <p className="text-xs font-black text-ui-text">
            {isAr ? `تم تحديد ${lines.length} صنف` : `${lines.length} selected item(s)`}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {lines.map(({ item, orderItemId }) => (
              <span key={orderItemId} className="rounded-lg bg-ui-surface px-2 py-1 text-[10px] font-bold text-ui-muted">
                {item.product.name} × {item.quantity}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[10px] font-bold text-ui-subtle">
            {isAr
              ? 'يتم نقل الأصناف المحددة فقط. لا يتغير المخزون ولا سجل إرسال المطبخ.'
              : 'Only the selected lines move. Inventory and kitchen-send history are unchanged.'}
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
          <Button variant="secondary" onClick={onClose} disabled={loading}>{isAr ? 'إلغاء' : 'Cancel'}</Button>
          <Button variant="primary" onClick={() => void perform()} disabled={loading || !selectedTableId}>
            <ArrowRightLeft className="h-4 w-4" />
            {isAr ? 'نقل المحدد' : 'Move selected'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
