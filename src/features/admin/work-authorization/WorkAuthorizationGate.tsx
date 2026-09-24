import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Clock3, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/Button';
import type {
  MyWorkAuthorizationState,
  WorkAuthorizationClient,
} from './workAuthorizationContract';

type GateStatus = 'loading' | 'ready' | 'blocked' | 'error';

export function WorkAuthorizationGate({
  client,
  branchId,
  branchName,
  children,
  onSignOut,
  onChangeBranch,
}: {
  client: WorkAuthorizationClient;
  branchId: string;
  branchName?: string | null;
  children: ReactNode;
  onSignOut: () => void | Promise<void>;
  onChangeBranch?: () => void;
}) {
  const [state, setState] = useState<MyWorkAuthorizationState | null>(null);
  const [status, setStatus] = useState<GateStatus>('loading');
  const [requesting, setRequesting] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    try {
      const next = await client.getMyState(branchId);
      setState(next);
      setStatus(next.canWork ? 'ready' : 'blocked');
    } catch {
      setStatus('error');
    }
  }, [branchId, client]);

  useEffect(() => {
    void load();
  }, [load]);

  const request = async () => {
    setRequesting(true);
    try {
      const next = await client.requestAuthorization(branchId);
      setState(next);
      setStatus(next.canWork ? 'ready' : 'blocked');
    } finally {
      setRequesting(false);
    }
  };

  if (status === 'ready') return <>{children}</>;

  const displayBranch = state?.branchName || branchName || 'الفرع الحالي';
  const isPending = state?.status === 'pending';

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
                  : 'يلزم تصريح لبدء العمل'}
          </h1>
          <p className="mt-2 text-sm text-ui-muted">{displayBranch}</p>
        </div>

        {status === 'blocked' && (
          <div className="mt-5 rounded-xl border border-ui-border bg-ui-page-alt p-4 text-center">
            <Clock3 className="mx-auto h-5 w-5 text-ui-muted" />
            <p className="mt-2 text-sm text-ui-text">
              {isPending
                ? 'تم إرسال طلبك للمسؤول. ستفتح مساحة العمل تلقائيًا بعد الموافقة.'
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
              {requesting ? 'جاري الإرسال...' : 'طلب تصريح بدء العمل'}
            </Button>
          )}

          {(status === 'error' || isPending) && (
            <Button variant="outline" onClick={() => void load()}>
              <RefreshCw className="h-4 w-4" />
              تحديث الحالة
            </Button>
          )}

          {onChangeBranch && (
            <Button variant="outline" onClick={onChangeBranch}>
              تغيير الفرع
            </Button>
          )}

          <Button variant="secondary" onClick={() => void onSignOut()}>
            <LogOut className="h-4 w-4" />
            تسجيل خروج
          </Button>
        </div>

        <p className="mt-4 text-center text-xs text-ui-muted">
          يتم التحقق عند الدخول أو تغيير الفرع فقط. لا يوجد فحص دوري مستمر.
        </p>
      </section>
    </main>
  );
}
