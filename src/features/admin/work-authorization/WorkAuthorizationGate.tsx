import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Clock3, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/Button';
import { Select } from '@/components/Input';
import type {
  MyWorkAuthorizationState,
  WorkAuthorizationClient,
} from './workAuthorizationContract';

type GateStatus = 'loading' | 'ready' | 'blocked' | 'error';
const WORK_AUTHORIZATION_REQUEST_WINDOW_MS = 60_000;

export function WorkAuthorizationGate({
  client,
  branchId,
  branchName,
  children,
  onSignOut,
  branchOptions = [],
  onBranchChange,
}: {
  client: WorkAuthorizationClient;
  branchId: string;
  branchName?: string | null;
  children: ReactNode;
  onSignOut: () => void | Promise<void>;
  branchOptions?: Array<{ id: string; name: string }>;
  onBranchChange?: (branchId: string) => void;
}) {
  const [state, setState] = useState<MyWorkAuthorizationState | null>(null);
  const [status, setStatus] = useState<GateStatus>('loading');
  const [requesting, setRequesting] = useState(false);
  const [pendingExpired, setPendingExpired] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const next = await client.getMyState(branchId);
      setState(next);
      setPendingExpired(next.status === 'expired' || (
        next.status === 'pending'
        && !!next.requestedAt
        && Date.now() >= new Date(next.requestedAt).getTime() + WORK_AUTHORIZATION_REQUEST_WINDOW_MS
      ));
      setStatus(next.canWork ? 'ready' : 'blocked');
    } catch {
      setStatus('error');
    }
  }, [branchId, client]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (state?.status !== 'pending' || pendingExpired || !state.requestedAt) return;

    const expiresAt = new Date(state.requestedAt).getTime() + WORK_AUTHORIZATION_REQUEST_WINDOW_MS;
    const remaining = Math.max(0, expiresAt - Date.now());
    let disposed = false;
    let unsubscribe: (() => void) | undefined;

    const expiryTimer = window.setTimeout(() => {
      if (!disposed) setPendingExpired(true);
    }, remaining);

    void client.subscribeToMyChanges(branchId, () => {
      if (!disposed) void load();
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unsubscribe = cleanup;
    });

    return () => {
      disposed = true;
      window.clearTimeout(expiryTimer);
      unsubscribe?.();
    };
  }, [branchId, client, load, pendingExpired, state?.requestedAt, state?.status]);

  const request = async () => {
    setRequesting(true);
    try {
      const next = await client.requestAuthorization(branchId);
      setState(next);
      setPendingExpired(false);
      setStatus(next.canWork ? 'ready' : 'blocked');
    } finally {
      setRequesting(false);
    }
  };

  if (status === 'ready') return <>{children}</>;

  const displayBranch = state?.branchName || branchName || 'الفرع الحالي';
  const isPending = state?.status === 'pending' && !pendingExpired;
  const isDormant = pendingExpired || state?.status === 'expired';

  return (
    <main
      data-testid="work-authorization-gate"
      className="flex min-h-screen items-center justify-center bg-ui-page px-4 py-8"
      dir="rtl"
    >
      <section className="w-full max-w-lg rounded-2xl border border-ui-border bg-ui-surface p-5 shadow-sm md:p-7">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-ui-primary/10 text-ui-primary">
          {status === 'loading' ? <RefreshCw className="h-7 w-7 animate-spin" /> : <ShieldCheck className="h-7 w-7" />}
        </div>

        <div className="mt-4 text-center">
          <p className="text-xs font-semibold text-ui-muted">بوابة تصريح العمل</p>
          <h1 className="mt-1 text-xl font-bold text-ui-text">
            {status === 'loading'
              ? 'جاري التحقق من تصريح الدخول...'
              : status === 'error'
                ? 'تعذر التحقق من تصريح العمل'
                : isPending
                  ? 'في انتظار تصريح بدء العمل'
                  : isDormant
                    ? 'انتهت مهلة طلب التصريح'
                    : 'يلزم تصريح لبدء العمل'}
          </h1>
          <p className="mt-2 text-sm text-ui-muted">{displayBranch}</p>
        </div>

        {status === 'blocked' && (
          <div className="mt-5 rounded-xl border border-ui-border bg-ui-page-alt p-4 text-center">
            <Clock3 className="mx-auto h-5 w-5 text-ui-muted" />
            <p className="mt-2 text-sm text-ui-text">
              {isPending
                ? 'تم إرسال طلبك للمسؤول. الطلب صالح لمدة دقيقة واحدة وستفتح مساحة العمل تلقائيًا إذا تمت الموافقة خلالها.'
                : isDormant
                  ? 'انتهت الدقيقة بدون موافقة. تم إيقاف المتابعة تلقائيًا لتقليل الاستهلاك؛ أرسل طلبًا جديدًا عندما تكون جاهزًا.'
                  : 'أرسل طلب تصريح بدء العمل للمسؤول.'}
            </p>
          </div>
        )}

        {status === 'error' && (
          <div className="mt-5 rounded-xl border border-ui-border bg-ui-page-alt p-4 text-center text-sm text-ui-muted">
            لم يتم تسجيل خروجك. أعد المحاولة عندما يعود الاتصال.
          </div>
        )}

        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {status === 'blocked' && !isPending && (
            <Button className="sm:col-span-2" disabled={requesting} onClick={() => void request()}>
              <ShieldCheck className="h-4 w-4" />
              {requesting ? 'جاري الإرسال...' : isDormant ? 'طلب تصريح جديد' : 'طلب تصريح بدء العمل'}
            </Button>
          )}

          {status === 'error' && (
            <Button variant="outline" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
              تحديث الحالة
            </Button>
          )}

          {onBranchChange && branchOptions.length > 1 && (
            <Select
              value={branchId}
              onChange={(event) => onBranchChange(event.target.value)}
              aria-label="تغيير الفرع"
            >
              {branchOptions.map((branch) => (
                <option key={branch.id} value={branch.id}>{branch.name}</option>
              ))}
            </Select>
          )}

          <Button variant="secondary" onClick={() => void onSignOut()}>
            <LogOut className="h-4 w-4" />
            تسجيل خروج
          </Button>
        </div>

        <p className="mt-4 text-center text-xs text-ui-muted">
          أثناء الدقيقة الأولى ننتظر عبر Realtime فقط بدون polling. بعد انتهاء الدقيقة يتوقف الاشتراك تمامًا حتى ترسل طلبًا جديدًا.
        </p>
      </section>
    </main>
  );
}
