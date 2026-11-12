import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, Check, X } from 'lucide-react';
import { supabase } from '@/api';
import { useAuth } from '@/context/AuthContext';
import { useCan } from '@/lib/permissions';
import { userFacingErrorMessage } from '@/lib/userFacingError';
import { createReadRefreshQueue } from '@/lib/readRefreshQueue';

type ApprovalRequest = {
  id: string;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  payload: Record<string, unknown>;
  reason: string;
  status: string;
  created_at: string;
  requester_id: string;
  requester_name?: string | null;
};

type RequesterDisplayRow = {
  id: string;
  full_name: string | null;
  username: string | null;
  email: string | null;
};

const labels: Record<string, { ar: string; en: string }> = {
  discount: { ar: 'طلب خصم', en: 'Discount request' },
  reprint: { ar: 'إعادة طباعة', en: 'Reprint request' },
  void_order: { ar: 'إلغاء طلب', en: 'Void order' },
  cancel_sent_item: { ar: 'إلغاء صنف مُرسل', en: 'Cancel sent item' },
  refund: { ar: 'مرتجع', en: 'Refund request' },
  open_drawer: { ar: 'فتح درج النقدية', en: 'Open cash drawer' },
  change_payment_method: { ar: 'تغيير وسيلة الدفع', en: 'Change payment method' },
  force_close_shift: { ar: 'إغلاق وردية إجباري', en: 'Force close shift' },
};

export function ApprovalInbox({ ar }: { ar: boolean }) {
  const { user } = useAuth();
  const can = useCan();
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [items, setItems] = useState<ApprovalRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [decisionError, setDecisionError] = useState('');
  const allowed = can('approvals.review');
  const approvalReadNeedsRetry = useRef(false);
  const loadApprovals = useCallback(async (isCurrent: () => boolean) => {
    if (!allowed || !user?.id || document.hidden) return;
    try {
      const approvalsResult = await supabase.rpc('get_operational_approval_queue', { p_branch_id: null });
      if (!isCurrent()) return;
      if (approvalsResult.error) { approvalReadNeedsRetry.current = true; return; }
      approvalReadNeedsRetry.current = false;

      const approvalRows = ((approvalsResult.data ?? []) as Array<{
        source_type: string;
        source_id: string;
        title: string;
        status: string;
        requested_by: string | null;
        requested_at: string;
        payload: {
          entity_type?: string;
          entity_id?: string | null;
          reason?: string;
          payload?: Record<string, unknown>;
        };
      }>)
        .filter((item) => item.source_type === 'manager_approval')
        .map((item) => ({
          id: item.source_id,
          action_type: item.title,
          entity_type: item.payload?.entity_type || '',
          entity_id: item.payload?.entity_id || null,
          payload: item.payload?.payload || {},
          reason: item.payload?.reason || '',
          status: item.status,
          created_at: item.requested_at,
          requester_id: item.requested_by || '',
        })) as ApprovalRequest[];

      const requesterIds = Array.from(new Set(approvalRows.map((item) => item.requester_id).filter(Boolean)));
      let requesterNames: Record<string, string> = {};
      if (!approvalsResult.error && requesterIds.length > 0) {
        const { data: requesterRows } = await supabase
          .from('users')
          .select('id,full_name,username,email')
          .in('id', requesterIds);
        requesterNames = Object.fromEntries(
          (requesterRows ?? [] as RequesterDisplayRow[]).map((row) => [
            String(row.id),
            String(row.full_name || row.username || row.email || '').trim(),
          ]),
        );
      }
      if (!isCurrent()) return;
      if (!approvalsResult.error) {
        setItems(approvalRows.map((item) => ({
          ...item,
          requester_name: requesterNames[item.requester_id] || null,
        })));
      }
    } catch (error) {
      if (isCurrent()) approvalReadNeedsRetry.current = true;
      throw error;
    }
  }, [allowed, user?.id]);

  const refreshQueueRef = useRef<ReturnType<typeof createReadRefreshQueue> | null>(null);
  useEffect(() => {
    const refreshQueue = createReadRefreshQueue(loadApprovals);
    refreshQueueRef.current = refreshQueue;
    setItems([]);
    approvalReadNeedsRetry.current = false;
    const refresh = () => { if (!document.hidden) void refreshQueue.request().catch(() => {}); };
    refresh();
    if (!allowed || !user?.id) return () => { refreshQueue.cancel(); };

    const channel = supabase
      .channel(`approval-inbox-${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'approval_requests' },
        refresh,
      );

    let subscriptionHealthy = false;
    channel.subscribe((status) => {
      subscriptionHealthy = status === 'SUBSCRIBED';
      if (subscriptionHealthy) {
        // Reconcile the gap between the initial read and the first subscription.
        refresh();
      }
    });
    // Retry failed approval reads even when realtime is healthy. This is
    // independent of printing events and stops once the queue read recovers.
    const recoveryTimer = window.setInterval(() => {
      if ((!subscriptionHealthy || approvalReadNeedsRetry.current) && !document.hidden) refresh();
    }, 30_000);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    const onVisible = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      refreshQueue.cancel();
      window.clearInterval(recoveryTimer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      void supabase.removeChannel(channel);
    };
  }, [allowed, user?.branch_id, user?.id, loadApprovals]);

  const decide = async (id: string, approve: boolean) => {
    if (busy) return;
    setBusy(id);
    setDecisionError('');
    try {
      const { data, error } = await supabase.rpc('decide_manager_approval', {
        p_request_id: id,
        p_approve: approve,
        p_note: null,
      });
      const result = data as {success?: boolean; error?: string; detail?: string} | null;
      if (error || !result?.success) throw new Error(error?.message || result?.detail || result?.error || 'APPROVAL_DECISION_FAILED');
      await refreshQueueRef.current?.request();
    } catch (error) {
      const message=error instanceof Error ? error.message : 'APPROVAL_DECISION_FAILED';
      setDecisionError(message==='NOT_AUTHORIZED'
        ? (ar ? 'لا تملك صلاحية الموافقة على هذا الطلب.' : 'You are not authorized to approve this request.')
        : userFacingErrorMessage(error,ar ? 'ar' : 'en'));
      await refreshQueueRef.current?.request();
    } finally {
      setBusy(null);
    }
  };

  if (!allowed) return null;

  return (
    <div className="flex items-center gap-1">
      <div className="relative">
        <button
          type="button"
          data-testid="approval-inbox-button"
          onClick={() => {
            setApprovalOpen((v) => !v);
            void refreshQueueRef.current?.request().catch(() => {});
          }}
          className="relative rounded-xl p-2 text-ui-muted transition-colors hover:bg-ui-page-alt hover:text-ui-text"
          aria-label={ar ? 'طلبات الموافقة' : 'Approval requests'}
        >
          <Bell className="h-5 w-5" />
          {items.length > 0 && (
            <span data-testid="approval-inbox-count" className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ui-danger px-1 text-[9px] font-bold text-ui-primary-fg">
              {items.length}
            </span>
          )}
        </button>

        {approvalOpen && (
          <div data-testid="approval-inbox-panel" className="absolute end-0 top-full z-[80] mt-2 w-[min(92vw,390px)] overflow-hidden rounded-xl border border-ui-border bg-ui-surface shadow-ui-lg">
            <div className="border-b border-ui-border px-4 py-3">
              <p className="font-semibold text-ui-text">{ar ? 'طلبات الموافقة' : 'Approval requests'}</p>
              <p className="text-xs text-ui-muted">{ar ? 'الطلبات المعلقة التي تحتاج قرارًا' : 'Pending requests that need a decision'}</p>
            </div>
            {decisionError && <p role="alert" className="px-4 py-2 text-sm text-ui-danger">{decisionError}</p>}
            <div className="max-h-96 overflow-y-auto p-2">
              {items.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-ui-muted">{ar ? 'لا توجد طلبات معلقة' : 'No pending requests'}</p>
              ) : items.map((item) => {
                const label = labels[item.action_type];
                const actionLabel = label ? (ar ? label.ar : label.en) : item.action_type;
                const requesterName = item.requester_name || (ar ? 'مستخدم غير معروف' : 'Unknown user');
                return (
                  <div key={item.id} className="mb-2 rounded-xl border border-ui-border bg-ui-page-alt p-3 last:mb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-ui-text">{requesterName}</p>
                        <p className="mt-0.5 text-sm font-medium text-ui-text">
                          {ar ? 'يطلب: ' : 'Requests: '}{actionLabel}
                        </p>
                        <p className="mt-1 text-sm text-ui-muted">
                          {ar ? 'السبب: ' : 'Reason: '}{item.reason}
                        </p>
                        {item.action_type === 'discount' && (
                          <p className="mt-1 text-xs text-ui-subtle">
                            {ar ? 'قيمة الخصم: ' : 'Discount: '}
                            {String(item.payload.discount_amount ?? '')}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 text-[10px] text-ui-subtle">
                        {new Date(item.created_at).toLocaleTimeString(ar ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button type="button" disabled={busy === item.id} onClick={() => void decide(item.id, true)} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-ui-success px-3 py-2 text-sm font-semibold text-ui-primary-fg disabled:opacity-50">
                        <Check className="h-4 w-4" />{ar ? 'موافقة' : 'Approve'}
                      </button>
                      <button type="button" disabled={busy === item.id} onClick={() => void decide(item.id, false)} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-ui-danger px-3 py-2 text-sm font-semibold text-ui-primary-fg disabled:opacity-50">
                        <X className="h-4 w-4" />{ar ? 'رفض' : 'Reject'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
