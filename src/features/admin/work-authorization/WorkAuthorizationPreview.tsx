import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  Clock3,
  Eye,
  History,
  PlayCircle,
  RotateCcw,
  Settings2,
  ShieldCheck,
  UserCheck,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import { Button } from '@/components/Button';
import { Select } from '@/components/Input';
import { TabContent, TabList, Tabs, TabTrigger } from '@/components/Tabs';
import { createMockWorkAuthorizationClient } from './mockWorkAuthorizationProvider';
import type {
  WorkAuthorizationClient,
  WorkAuthorizationHistoryEntry,
  WorkAuthorizationRecord,
  WorkAuthorizationSnapshot,
} from './workAuthorizationContract';

type Branch = { id: string; name: string };

const EMPTY_SNAPSHOT: WorkAuthorizationSnapshot = {
  pending: [],
  active: [],
  history: [],
  policies: [],
};

function formatDate(value: string, ar: boolean) {
  return new Date(value).toLocaleString(ar ? 'ar-EG' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: 'short',
  });
}

function statusLabel(kind: WorkAuthorizationHistoryEntry['kind'], ar: boolean) {
  const labels = {
    requested: ar ? 'طلب بدء عمل' : 'Work requested',
    approved: ar ? 'تمت الموافقة' : 'Approved',
    rejected: ar ? 'تم الرفض' : 'Rejected',
    revoked: ar ? 'تم سحب الاعتماد' : 'Revoked',
    expired: ar ? 'انتهى الاعتماد' : 'Expired',
  };
  return labels[kind];
}

function PersonIdentity({ row }: { row: WorkAuthorizationRecord }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ui-primary/10 text-ui-primary">
        <UserRound className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="truncate font-semibold text-ui-text">{row.person.fullName}</p>
        <p className="truncate text-xs text-ui-muted">{row.person.positionLabel} · {row.branchName}</p>
      </div>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-xl border border-dashed border-ui-border p-8 text-center text-sm text-ui-muted">{text}</div>;
}

export function WorkAuthorizationPreview({
  ar,
  branches,
  canManageSettings,
  client: providedClient,
  live = false,
}: {
  ar: boolean;
  branches: Branch[];
  canManageSettings: boolean;
  client?: WorkAuthorizationClient;
  live?: boolean;
}) {
  const client = useMemo(
    () => providedClient ?? createMockWorkAuthorizationClient(branches),
    [branches, providedClient],
  );
  const [branchId, setBranchId] = useState('');
  const [snapshot, setSnapshot] = useState<WorkAuthorizationSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [employeePreview, setEmployeePreview] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setSnapshot(await client.getSnapshot({ branchId: branchId || null }));
    setLoading(false);
  }, [branchId, client]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, action: 'approve' | 'reject' | 'revoke') => {
    setBusy(id);
    try {
      if (action === 'approve') await client.approve(id);
      if (action === 'reject') {
        const reason = window.prompt(ar ? 'سبب الرفض في المعاينة:' : 'Preview rejection reason:');
        if (reason === null) return;
        await client.reject(id, reason.trim() || (ar ? 'غير متاح لبدء العمل الآن' : 'Not available to start work now'));
      }
      if (action === 'revoke') {
        const reason = window.prompt(ar ? (live ? 'سبب إيقاف التصريح:' : 'سبب سحب الاعتماد في المعاينة:') : (live ? 'Reason for stopping authorization:' : 'Preview revoke reason:'));
        if (reason === null) return;
        await client.revoke(id, reason.trim() || (ar ? 'تم إنهاء اعتماد العمل' : 'Work authorization ended'));
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  const toggleRequirement = async (userId: string, branchId: string, required: boolean) => {
    const busyKey = `${userId}:${branchId}`;
    setBusy(busyKey);
    try {
      await client.setRequirement(userId, branchId, required);
      await load();
    } finally {
      setBusy(null);
    }
  };

  const pendingEmployee = snapshot.pending[0];

  return (
    <section data-testid="work-authorization-preview" className="overflow-hidden rounded-2xl border border-ui-border bg-ui-surface">
      <div className="border-b border-ui-border bg-ui-page-alt/60 p-4 md:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-ui-primary" />
              <h2 className="text-lg font-bold text-ui-text">{ar ? 'اعتماد بدء العمل' : 'Work Authorization'}</h2>
              <span className="rounded-full border border-ui-border bg-ui-surface px-2.5 py-1 text-[11px] font-semibold text-ui-muted">
                {live ? (ar ? 'تشغيل فعلي' : 'Live') : (ar ? 'معاينة فقط' : 'Preview only')}
              </span>
            </div>
            <p className="mt-1 text-sm text-ui-muted">
              {live
                ? (ar
                    ? 'اعرض المصرح لهم حسب الفرع وأوقف التصريح فورًا. المستخدم الموقوف يعود تلقائيًا إلى انتظار التصريح.'
                    : 'View authorized users by branch and stop authorization immediately. Revoked users return to the waiting queue.')
                : (ar
                    ? 'واجهة تجريبية لا تمنع أي مستخدم ولا تكتب في بيانات التشغيل.'
                    : 'Preview UI only. It does not block users or write operational data.')}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={branchId} onChange={(event) => setBranchId(event.target.value)} className="min-w-48">
              <option value="">{ar ? 'كل الفروع المصرح بها' : 'All accessible branches'}</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </Select>
            {!live && (
              <Button variant="outline" onClick={() => setEmployeePreview((value) => !value)}>
                <Eye className="h-4 w-4" />
                {employeePreview ? (ar ? 'إخفاء شاشة الموظف' : 'Hide employee view') : (ar ? 'معاينة شاشة الموظف' : 'Preview employee view')}
              </Button>
            )}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
          <div className="rounded-xl border border-ui-border bg-ui-surface p-3">
            <p className="text-xs text-ui-muted">{ar ? 'بانتظار الموافقة' : 'Pending'}</p>
            <p className="mt-1 text-2xl font-bold text-ui-text">{snapshot.pending.length}</p>
          </div>
          <div className="rounded-xl border border-ui-border bg-ui-surface p-3">
            <p className="text-xs text-ui-muted">{ar ? 'يعملون الآن' : 'Working now'}</p>
            <p className="mt-1 text-2xl font-bold text-ui-text">{snapshot.active.length}</p>
          </div>
          <div className="rounded-xl border border-ui-border bg-ui-surface p-3">
            <p className="text-xs text-ui-muted">{ar ? 'أحداث السجل' : 'History events'}</p>
            <p className="mt-1 text-2xl font-bold text-ui-text">{snapshot.history.length}</p>
          </div>
          <div className="rounded-xl border border-ui-border bg-ui-surface p-3">
            <p className="text-xs text-ui-muted">{ar ? 'مستخدمون تحت السياسة' : 'Policy users'}</p>
            <p className="mt-1 text-2xl font-bold text-ui-text">{snapshot.policies.length}</p>
          </div>
        </div>
      </div>

      {!live && employeePreview && (
        <div className="border-b border-ui-border p-4 md:p-5">
          <div className="mx-auto max-w-xl rounded-2xl border border-ui-border bg-ui-page-alt p-5 text-center shadow-sm">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-ui-primary/10 text-ui-primary">
              <Clock3 className="h-7 w-7" />
            </div>
            <p className="mt-3 text-xs font-semibold text-ui-muted">{ar ? 'معاينة شاشة الموظف' : 'Employee screen preview'}</p>
            <h3 className="mt-1 text-xl font-bold text-ui-text">{ar ? 'في انتظار الموافقة لبدء العمل' : 'Waiting for approval to start work'}</h3>
            <p className="mt-2 text-sm text-ui-muted">
              {pendingEmployee
                ? pendingEmployee.person.fullName + ' · ' + pendingEmployee.branchName
                : (ar ? 'لا يوجد طلب معلق في الفرع المحدد' : 'No pending request in the selected branch')}
            </p>
            <div className="mt-4 rounded-xl border border-ui-border bg-ui-surface p-3 text-sm text-ui-muted">
              {ar
                ? 'ستفتح مساحة العمل تلقائيًا بعد اعتماد المسؤول. لا يحتاج الموظف إلى تحديث الصفحة يدويًا.'
                : 'The workspace will open automatically after approval. The employee does not need to refresh manually.'}
            </div>
            <div className="mt-4 flex justify-center gap-2">
              <Button variant="outline" disabled>{ar ? 'تغيير الفرع' : 'Change branch'}</Button>
              <Button variant="secondary" disabled>{ar ? 'تسجيل خروج' : 'Sign out'}</Button>
            </div>
          </div>
        </div>
      )}

      <div className="p-4 md:p-5">
        <Tabs defaultValue="pending">
          <TabList className="overflow-x-auto">
            <TabTrigger value="pending">
              <span className="inline-flex items-center gap-2"><Clock3 className="h-4 w-4" />{ar ? 'بانتظار الموافقة' : 'Pending'} <b>{snapshot.pending.length}</b></span>
            </TabTrigger>
            <TabTrigger value="active">
              <span className="inline-flex items-center gap-2"><UsersRound className="h-4 w-4" />{ar ? 'يعملون الآن' : 'Working now'} <b>{snapshot.active.length}</b></span>
            </TabTrigger>
            <TabTrigger value="history">
              <span className="inline-flex items-center gap-2"><History className="h-4 w-4" />{ar ? 'السجل' : 'History'}</span>
            </TabTrigger>
            {canManageSettings && (
              <TabTrigger value="settings">
                <span className="inline-flex items-center gap-2"><Settings2 className="h-4 w-4" />{ar ? 'الإعدادات' : 'Settings'}</span>
              </TabTrigger>
            )}
          </TabList>

          <TabContent value="pending">
            {loading ? (
              <div className="p-8 text-center text-sm text-ui-muted">{ar ? 'جاري تحميل المعاينة...' : 'Loading preview...'}</div>
            ) : snapshot.pending.length === 0 ? (
              <EmptyState text={ar ? 'لا توجد طلبات بدء عمل معلقة' : 'No pending work-start requests'} />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {snapshot.pending.map((row) => (
                  <article key={row.id} className="rounded-xl border border-ui-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <PersonIdentity row={row} />
                      <span className="whitespace-nowrap text-xs text-ui-muted">{formatDate(row.requestedAt, ar)}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ui-muted">
                      <span className="rounded-full bg-ui-page-alt px-2.5 py-1">{row.shiftLabel}</span>
                      <span>{ar ? 'طلب بدء العمل' : 'Start-work request'}</span>
                    </div>
                    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
                      <Button disabled={busy === row.id} onClick={() => void act(row.id, 'approve')}>
                        <Check className="h-4 w-4" />{ar ? 'موافقة' : 'Approve'}
                      </Button>
                      <Button variant="secondary" disabled={busy === row.id} onClick={() => void act(row.id, 'reject')}>
                        <X className="h-4 w-4" />{ar ? 'رفض' : 'Reject'}
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </TabContent>

          <TabContent value="active">
            {snapshot.active.length === 0 ? (
              <EmptyState text={ar ? 'لا يوجد مستخدمون معتمدون حاليًا' : 'No users are currently authorized'} />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {snapshot.active.map((row) => (
                  <article key={row.id} className="rounded-xl border border-ui-border p-4">
                    <div className="flex items-start justify-between gap-3">
                      <PersonIdentity row={row} />
                      <span className="inline-flex items-center gap-1 rounded-full bg-ui-success/10 px-2.5 py-1 text-xs font-semibold text-ui-success">
                        <UserCheck className="h-3.5 w-3.5" />{ar ? 'معتمد' : 'Authorized'}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-ui-muted sm:grid-cols-2">
                      <span>{ar ? 'بدأ:' : 'Started:'} {row.startedAt ? formatDate(row.startedAt, ar) : '—'}</span>
                      <span>{ar ? 'اعتمد بواسطة:' : 'Approved by:'} {row.approverName || '—'}</span>
                    </div>
                    <div className="mt-4 flex justify-end">
                      <Button variant="outline" disabled={busy === row.id} onClick={() => void act(row.id, 'revoke')}>
                        <RotateCcw className="h-4 w-4" />{live ? (ar ? 'إيقاف التصريح' : 'Stop authorization') : (ar ? 'سحب الاعتماد' : 'Revoke')}
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </TabContent>

          <TabContent value="history">
            {snapshot.history.length === 0 ? (
              <EmptyState text={ar ? 'لا توجد أحداث في السجل' : 'No authorization history'} />
            ) : (
              <div className="overflow-hidden rounded-xl border border-ui-border">
                {snapshot.history.map((row) => (
                  <div key={row.id} className="flex flex-col gap-2 border-b border-ui-border p-3 last:border-b-0 md:flex-row md:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ui-text">{row.person.fullName}</p>
                      <p className="text-xs text-ui-muted">{row.person.positionLabel} · {row.branchName}</p>
                    </div>
                    <div className="text-sm text-ui-text">{statusLabel(row.kind, ar)}</div>
                    <div className="text-xs text-ui-muted">{formatDate(row.occurredAt, ar)}</div>
                    <div className="max-w-xs text-xs text-ui-muted">{row.note || row.actorName || '—'}</div>
                  </div>
                ))}
              </div>
            )}
          </TabContent>

          {canManageSettings && (
            <TabContent value="settings">
              <div className="mb-3 rounded-xl border border-ui-border bg-ui-page-alt p-3 text-sm text-ui-muted">
                {ar
                  ? 'هذه إعدادات معاينة فقط. في الربط الحقيقي ستظهر وتُعدل حسب صلاحية إدارة سياسات الموافقات ونطاق الفروع المسموح بها.'
                  : 'Preview settings only. Production settings will be permission- and branch-scoped.'}
              </div>
              <div className="space-y-2">
                {snapshot.policies.map((row) => (
                  <div key={row.id} className="flex flex-col gap-3 rounded-xl border border-ui-border p-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ui-text">{row.userName}</p>
                      <p className="text-xs text-ui-muted">{row.positionLabel} · {row.branchName}</p>
                    </div>
                    <button
                      type="button"
                      disabled={busy === `${row.userId}:${row.branchId}`}
                      onClick={() => void toggleRequirement(row.userId, row.branchId, !row.requiresAuthorization)}
                      className={
                        'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border px-3 text-sm font-semibold transition-colors ' +
                        (row.requiresAuthorization
                          ? 'border-ui-primary/30 bg-ui-primary/10 text-ui-primary'
                          : 'border-ui-border bg-ui-surface text-ui-muted')
                      }
                    >
                      <PlayCircle className="h-4 w-4" />
                      {row.requiresAuthorization
                        ? (ar ? 'يتطلب موافقة' : 'Approval required')
                        : (ar ? 'لا يحتاج موافقة' : 'No approval required')}
                    </button>
                  </div>
                ))}
              </div>
            </TabContent>
          )}
        </Tabs>
      </div>
    </section>
  );
}
