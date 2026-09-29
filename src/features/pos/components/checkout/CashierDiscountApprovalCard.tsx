import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/api';

export function CashierDiscountApprovalCard({
  subtotal,
  currentType,
  onApproved,
  ar,
  canDirectDiscount,
}: {
  subtotal: number;
  currentType: 'amount' | 'percent';
  onApproved: (type: 'amount' | 'percent', amount: number) => void;
  ar: boolean;
  canDirectDiscount: boolean;
}) {
  const [type, setType] = useState<'amount' | 'percent'>(currentType);
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'pending' | 'approved' | 'rejected'>('idle');
  const [busy, setBusy] = useState(false);
  const appliedRequestRef = useRef<string | null>(null);

  useEffect(() => setType(currentType), [currentType]);

  const applyDecision = useCallback((row: {
    id?: string;
    status?: string;
    payload?: Record<string, unknown> | null;
  } | null) => {
    if (!row || !requestId) return;
    if (row.status === 'approved') {
      if (appliedRequestRef.current === requestId) return;
      const approvedPayload = row.payload || {};
      const approvedType = approvedPayload.discount_type === 'percent' ? 'percent' : 'amount';
      const requestedValue = Number(
        approvedPayload.requested_value ??
        approvedPayload.discount_amount ??
        0,
      );
      const approvedValue = approvedType === 'percent'
        ? Math.min(Math.max(requestedValue, 0), 100)
        : Math.min(Math.max(requestedValue, 0), Math.max(subtotal, 0));
      if (approvedValue <= 0) return;
      appliedRequestRef.current = requestId;
      setStatus('approved');
      onApproved(approvedType, approvedValue);
    } else if (row.status === 'rejected' || row.status === 'expired') {
      setStatus('rejected');
    }
  }, [onApproved, requestId, subtotal]);

  const refreshDecision = useCallback(async () => {
    if (!requestId) return;
    const { data } = await supabase
      .from('approval_requests')
      .select('id,status,payload')
      .eq('id', requestId)
      .maybeSingle();
    applyDecision(data as { id?: string; status?: string; payload?: Record<string, unknown> | null } | null);
  }, [applyDecision, requestId]);

  useEffect(() => {
    if (!requestId || status !== 'pending') return;

    void refreshDecision();

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
          applyDecision(payload.new as {
            id?: string;
            status?: string;
            payload?: Record<string, unknown> | null;
          });
        },
      )
      .subscribe();

    const interval = window.setInterval(() => {
      void refreshDecision();
    }, 3000);

    const onFocus = () => void refreshDecision();
    window.addEventListener('focus', onFocus);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      void supabase.removeChannel(channel);
    };
  }, [applyDecision, refreshDecision, requestId, status]);

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
        appliedRequestRef.current = null;
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
