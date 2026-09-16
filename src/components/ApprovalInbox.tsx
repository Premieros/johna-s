import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Bell, Check, CheckCircle2, Printer, X } from 'lucide-react';
import { supabase } from '@/api';
import { useAuth } from '@/context/AuthContext';

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
};

type PrintAlert = {
  id: string;
  kind: 'kitchen' | 'receipt' | 'test';
  station_code: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

type StoredAlertState = {
  hidden: string[];
  read: string[];
};

const ALERT_STATE_PREFIX = 'johns_pos_system_alerts_v1';
const MAX_STORED_ALERT_KEYS = 200;

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

function stationLabel(code: string | null, ar: boolean) {
  const normalized = (code ?? '').trim().toLowerCase();
  if (normalized === 'kit') return ar ? 'المطبخ' : 'Kitchen';
  if (normalized === 'cashier') return ar ? 'الكاشير' : 'Cashier';
  if (normalized === 'بار') return ar ? 'البار' : 'Bar';
  if (normalized === 'main') return ar ? 'المحطة الرئيسية' : 'Main station';
  return code || (ar ? 'الطابعة' : 'Printer');
}

function printAlertText(item: PrintAlert, ar: boolean) {
  const station = stationLabel(item.station_code, ar);
  const error = item.last_error ?? '';

  if (item.status === 'submitted' && item.attempts > 1) {
    return {
      title: ar ? `تمت استعادة الطباعة — ${station}` : `Printing recovered — ${station}`,
      detail: ar
        ? `نجحت الطباعة بعد ${item.attempts} محاولات.`
        : `Printing succeeded after ${item.attempts} attempts.`,
      resolved: true,
    };
  }

  if (error.startsWith('PRINTER_ROUTE_MISSING:')) {
    return {
      title: ar ? `مسار الطابعة غير مضبوط — ${station}` : `Printer route missing — ${station}`,
      detail: ar ? 'تحقق من ربط المحطة بالطابعة على جهاز الطباعة.' : 'Check the station-to-printer route on the print device.',
      resolved: false,
    };
  }

  if (error === 'INVALID_APPROVAL') {
    return {
      title: ar ? 'تعذر تنفيذ إعادة الطباعة' : 'Reprint could not be completed',
      detail: ar ? 'الموافقة غير صالحة أو انتهت صلاحيتها.' : 'The approval is invalid or expired.',
      resolved: false,
    };
  }

  const retrying = item.attempts < 5;
  return {
    title: retrying
      ? (ar ? `الطباعة في انتظار إعادة المحاولة — ${station}` : `Waiting to retry printing — ${station}`)
      : (ar ? `فشلت الطباعة — ${station}` : `Printing failed — ${station}`),
    detail: retrying
      ? (ar ? `المحاولة ${item.attempts}/5 — سيحاول النظام تلقائيًا.` : `Attempt ${item.attempts}/5 — the system will retry automatically.`)
      : (ar ? 'انتهت محاولات الطباعة التلقائية.' : 'Automatic print retries are exhausted.'),
    resolved: false,
  };
}

function alertKey(item: PrintAlert) {
  return `${item.id}:${item.status}:${item.attempts}:${item.last_error ?? ''}`;
}

function readStoredAlertState(storageKey: string): StoredAlertState {
  if (typeof window === 'undefined') return { hidden: [], read: [] };
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return { hidden: [], read: [] };
    const parsed = JSON.parse(raw) as Partial<StoredAlertState>;
    return {
      hidden: Array.isArray(parsed.hidden) ? parsed.hidden.filter((value): value is string => typeof value === 'string') : [],
      read: Array.isArray(parsed.read) ? parsed.read.filter((value): value is string => typeof value === 'string') : [],
    };
  } catch {
    return { hidden: [], read: [] };
  }
}

function writeStoredAlertState(storageKey: string, state: StoredAlertState) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, JSON.stringify({
      hidden: state.hidden.slice(-MAX_STORED_ALERT_KEYS),
      read: state.read.slice(-MAX_STORED_ALERT_KEYS),
    }));
  } catch {
    // Notification state is a UI convenience. Printing/audit data must never depend on local storage.
  }
}

export function ApprovalInbox({ ar }: { ar: boolean }) {
  const { user } = useAuth();
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [items, setItems] = useState<ApprovalRequest[]>([]);
  const [printAlerts, setPrintAlerts] = useState<PrintAlert[]>([]);
  const [hiddenAlertKeys, setHiddenAlertKeys] = useState<string[]>([]);
  const [readAlertKeys, setReadAlertKeys] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const allowed =
    user?.role === 'branch_manager' ||
    user?.role === 'owner' ||
    user?.role === 'super_admin';
  const alertStorageKey = user?.id && user?.branch_id
    ? `${ALERT_STATE_PREFIX}:${user.id}:${user.branch_id}`
    : null;

  useEffect(() => {
    if (!alertStorageKey) {
      setHiddenAlertKeys([]);
      setReadAlertKeys([]);
      return;
    }
    const stored = readStoredAlertState(alertStorageKey);
    setHiddenAlertKeys(stored.hidden);
    setReadAlertKeys(stored.read);
  }, [alertStorageKey]);

  const load = useCallback(async () => {
    if (!allowed || !user?.branch_id) return;

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [approvalsResult, printResult] = await Promise.all([
      supabase
        .from('approval_requests')
        .select('id,action_type,entity_type,entity_id,payload,reason,status,created_at,requester_id,expires_at')
        .eq('branch_id', user.branch_id)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(30),
      supabase
        .from('cloud_print_jobs')
        .select('id,kind,station_code,status,attempts,last_error,created_at,updated_at')
        .eq('branch_id', user.branch_id)
        .in('status', ['failed', 'submitted'])
        .gte('updated_at', since)
        .order('updated_at', { ascending: false })
        .limit(40),
    ]);

    setItems((approvalsResult.data ?? []) as ApprovalRequest[]);
    const recent = ((printResult.data ?? []) as PrintAlert[])
      .filter((item) => item.status === 'failed' || (item.status === 'submitted' && item.attempts > 1))
      .slice(0, 20);
    setPrintAlerts(recent);
  }, [allowed, user?.branch_id]);

  useEffect(() => {
    void load();
    if (!allowed || !user?.branch_id) return;
    const channel = supabase
      .channel(`approval-inbox-${user.branch_id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'approval_requests', filter: `branch_id=eq.${user.branch_id}` },
        () => void load(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'cloud_print_jobs', filter: `branch_id=eq.${user.branch_id}` },
        () => void load(),
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [allowed, user?.branch_id, load]);

  const decide = async (id: string, approve: boolean) => {
    setBusy(id);
    try {
      await supabase.rpc('decide_manager_approval', {
        p_request_id: id,
        p_approve: approve,
        p_note: null,
      });
      await load();
    } finally {
      setBusy(null);
    }
  };

  const persistAlertState = (nextHidden: string[], nextRead: string[]) => {
    setHiddenAlertKeys(nextHidden);
    setReadAlertKeys(nextRead);
    if (alertStorageKey) writeStoredAlertState(alertStorageKey, { hidden: nextHidden, read: nextRead });
  };

  const dismissAlert = (item: PrintAlert) => {
    const key = alertKey(item);
    if (hiddenAlertKeys.includes(key)) return;
    persistAlertState([...hiddenAlertKeys, key], readAlertKeys.filter((value) => value !== key));
  };

  const visiblePrintAlerts = printAlerts.filter((item) => !hiddenAlertKeys.includes(alertKey(item)));
  const unreadVisibleAlertKeys = visiblePrintAlerts
    .map(alertKey)
    .filter((key) => !readAlertKeys.includes(key));

  const markAllAlertsRead = () => {
    if (unreadVisibleAlertKeys.length === 0) return;
    persistAlertState(hiddenAlertKeys, Array.from(new Set([...readAlertKeys, ...unreadVisibleAlertKeys])));
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
            setAlertsOpen(false);
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
            <div className="max-h-96 overflow-y-auto p-2">
              {items.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-ui-muted">{ar ? 'لا توجد طلبات معلقة' : 'No pending requests'}</p>
              ) : items.map((item) => {
                const label = labels[item.action_type];
                return (
                  <div key={item.id} className="mb-2 rounded-xl border border-ui-border bg-ui-page-alt p-3 last:mb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-semibold text-ui-text">{label ? (ar ? label.ar : label.en) : item.action_type}</p>
                        <p className="mt-1 text-sm text-ui-muted">{item.reason}</p>
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

      <div className="relative">
        <button
          type="button"
          data-testid="system-alerts-button"
          onClick={() => {
            setAlertsOpen((v) => !v);
            setApprovalOpen(false);
          }}
          className="relative rounded-xl p-2 text-ui-muted transition-colors hover:bg-ui-page-alt hover:text-ui-text"
          aria-label={ar ? 'إشعارات النظام' : 'System notifications'}
        >
          <AlertTriangle className="h-5 w-5" />
          {unreadVisibleAlertKeys.length > 0 && (
            <span data-testid="system-alerts-count" className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ui-warning px-1 text-[9px] font-bold text-ui-primary-fg">
              {unreadVisibleAlertKeys.length}
            </span>
          )}
        </button>

        {alertsOpen && (
          <div data-testid="system-alerts-panel" className="absolute end-0 top-full z-[80] mt-2 w-[min(92vw,390px)] overflow-hidden rounded-xl border border-ui-border bg-ui-surface shadow-ui-lg">
            <div className="flex items-start justify-between gap-3 border-b border-ui-border px-4 py-3">
              <div>
                <p className="font-semibold text-ui-text">{ar ? 'إشعارات النظام' : 'System notifications'}</p>
                <p className="text-xs text-ui-muted">{ar ? 'مشاكل الطباعة والأحداث التشغيلية المهمة' : 'Important printing and operational events'}</p>
              </div>
              {unreadVisibleAlertKeys.length > 0 && (
                <button
                  type="button"
                  onClick={markAllAlertsRead}
                  className="shrink-0 rounded-lg px-2 py-1 text-xs font-semibold text-ui-primary hover:bg-ui-primary-soft"
                >
                  {ar ? 'تحديد الكل كمقروء' : 'Mark all read'}
                </button>
              )}
            </div>
            <div className="max-h-96 overflow-y-auto p-2">
              {visiblePrintAlerts.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-ui-muted">{ar ? 'لا توجد إشعارات مهمة' : 'No important notifications'}</p>
              ) : visiblePrintAlerts.map((item) => {
                const alert = printAlertText(item, ar);
                const key = alertKey(item);
                const isUnread = !readAlertKeys.includes(key);
                return (
                  <div key={`print-${key}`} className={`mb-2 rounded-xl border p-3 last:mb-0 ${isUnread ? 'border-ui-primary/30 bg-ui-primary-soft/40' : 'border-ui-border bg-ui-page-alt'}`}>
                    <div className="flex items-start gap-2.5">
                      {alert.resolved ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ui-success" />
                      ) : item.attempts < 5 ? (
                        <Printer className="mt-0.5 h-4 w-4 shrink-0 text-ui-warning" />
                      ) : (
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-ui-danger" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              {isUnread && <span className="h-2 w-2 shrink-0 rounded-full bg-ui-primary" aria-label={ar ? 'غير مقروء' : 'Unread'} />}
                              <p className="font-semibold text-ui-text">{alert.title}</p>
                            </div>
                            <p className="mt-1 text-sm text-ui-muted">{alert.detail}</p>
                          </div>
                          <div className="flex shrink-0 items-start gap-1">
                            <span className="pt-1 text-[10px] text-ui-subtle">
                              {new Date(item.updated_at).toLocaleTimeString(ar ? 'ar-EG' : 'en-US', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                            <button
                              type="button"
                              data-testid={`dismiss-system-alert-${item.id}`}
                              onClick={() => dismissAlert(item)}
                              className="rounded-md p-1 text-ui-subtle transition-colors hover:bg-ui-surface hover:text-ui-danger"
                              aria-label={ar ? 'إخفاء الإشعار' : 'Dismiss notification'}
                              title={ar ? 'إخفاء الإشعار' : 'Dismiss notification'}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
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
