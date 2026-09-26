import { useEffect, useState } from 'react';
import { supabase } from '@/api';
import { useCan } from '@/lib/permissions';

export function CashierDiscountApprovalCard({
  subtotal,
  currentType,
  onApproved,
  ar,
}: {
  subtotal: number;
  currentType: 'amount' | 'percent';
  onApproved: (type: 'amount' | 'percent', amount: number) => void;
  ar: boolean;
}) {
  const [type, setType] = useState<'amount' | 'percent'>(currentType);
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'pending' | 'approved' | 'rejected'>('idle');
  const [busy, setBusy] = useState(false);
  const can = useCan();
  const canDirectDiscount = can('pos.discount');

  useEffect(() => setType(currentType), [currentType]);


  useEffect(() => {
    if (!requestId) return;

    const channel = supabase
      .channel(`discount-approval-${requestId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'approval_requests',
          filter: `id=eq.${requestId}`,
        },
        (payload) => {
          const next = payload.new as {
            status?: string;
            payload?: Record<string, unknown>;
          };

          if (next.status === 'approved') {
            setStatus('approved');
            onApproved(type, type === 'percent' ? Math.min(amount, 100) : Math.min(amount, Math.max(subtotal, 0)));
          } else if (next.status === 'rejected' || next.status === 'expired') {
            setStatus('rejected');
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [requestId, type, amount, subtotal, onApproved]);

  if (canDirectDiscount) return null;

  const request = async () => {
    if (amount <= 0 || reason.trim().length < 3) return;

    const normalizedInput = type === 'percent'
      ? Math.min(amount, 100)
      : Math.min(amount, Math.max(subtotal, 0));
    const monetaryDiscount = type === 'percent'
      ? (Math.max(subtotal, 0) * normalizedInput) / 100
      : normalizedInput;
    if (monetaryDiscount <= 0) return;

    setBusy(true);

    try {
      const { data } = await supabase.rpc('request_manager_approval', {
        p_action_type: 'discount',
        p_entity_type: 'sale',
        p_entity_id: null,
        p_payload: {
          discount_amount: monetaryDiscount,
          discount_type: type,
          requested_value: normalizedInput,
          subtotal,
        },
        p_reason: reason.trim(),
      });

      const res = data as {
        success?: boolean;
        request_id?: string;
      } | null;

      if (res?.success && res.request_id) {
        setRequestId(res.request_id);
        setStatus('pending');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-3xl border border-ui-border bg-ui-surface p-5 shadow-ui-sm">
      <p className="mb-3 text-sm font-black text-ui-text">
        {ar ? 'طلب خصم من المدير' : 'Request manager discount approval'}
      </p>

      <div className="grid grid-cols-2 gap-2">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as 'amount' | 'percent')}
          className="rounded-xl border border-ui-border bg-ui-surface-raised px-3 py-2 text-sm"
        >
          <option value="amount">{ar ? 'قيمة' : 'Amount'}</option>
          <option value="percent">{ar ? 'نسبة %' : 'Percent %'}</option>
        </select>

        <input
          type="number"
          min={0}
          value={amount || ''}
          onChange={(e) => setAmount(Math.max(0, Number(e.target.value) || 0))}
          className="rounded-xl border border-ui-border bg-ui-surface-raised px-3 py-2 text-sm"
          placeholder={ar ? 'قيمة الخصم' : 'Discount'}
        />
      </div>

      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="mt-2 w-full rounded-xl border border-ui-border bg-ui-surface-raised px-3 py-2 text-sm"
        placeholder={ar ? 'سبب الخصم (إجباري)' : 'Reason (required)'}
      />

      <button
        type="button"
        onClick={() => void request()}
        disabled={
          busy ||
          status === 'pending' ||
          amount <= 0 ||
          reason.trim().length < 3
        }
        className="mt-3 w-full rounded-xl bg-ui-primary px-4 py-2.5 text-sm font-bold text-ui-primary-fg disabled:opacity-50"
      >
        {status === 'pending'
          ? ar
            ? 'بانتظار موافقة المدير...'
            : 'Waiting for manager...'
          : status === 'approved'
            ? ar
              ? 'تمت الموافقة'
              : 'Approved'
            : status === 'rejected'
              ? ar
                ? 'تم الرفض'
                : 'Rejected'
              : ar
                ? 'إرسال طلب الموافقة'
                : 'Send approval request'}
      </button>
    </div>
  );
}
