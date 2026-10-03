import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  Building2,
  Clock3,
  Printer,
  RefreshCw,
  ReceiptText,
  ShoppingCart,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import { admin } from '@/api';
import { Button } from '@/components/Button';
import { Card } from '@/components/PageHeader';
import { useLanguage } from '@/context/LanguageContext';
import { formatNumber } from '@/lib/format';
import { useBranchFilter } from '@/lib/useBranchFilter';

type RangePreset = '30m' | '1h' | '3h' | '6h' | '12h' | 'today' | '24h' | 'custom';
type PulseStatus = 'ok' | 'quiet' | 'warning';

type BranchPulseRow = {
  branch_id: string;
  branch_name: string;
  branch_name_en?: string | null;
  order_count?: number;
  completed_sales_count?: number;
  completed_sales_value?: number | string;
  print_submitted_count?: number;
  print_confirmed_count?: number;
  print_failed_count?: number;
  purchase_count?: number;
  purchase_value?: number | string;
  expense_count?: number;
  expense_value?: number | string;
  open_shift_count?: number;
  open_operator_count?: number;
  signal_status?: PulseStatus;
  warnings?: string[];
};

type UserIssueRow = {
  branch_name?: string | null;
  issue_kind?: 'expected' | 'technical';
  error_code?: string;
  screen?: string;
  action?: string;
  user_message?: string;
  occurrences?: number;
  affected_users?: number;
  latest_at?: string;
};

type PulseEnvelope = { success?: boolean; error?: string; branches?: BranchPulseRow[]; generated_at?: string };
type IssueEnvelope = { success?: boolean; error?: string; issues?: UserIssueRow[] };

const PRESETS: Array<{ key: RangePreset; ar: string; en: string }> = [
  { key: '30m', ar: '30د', en: '30m' },
  { key: '1h', ar: '1س', en: '1h' },
  { key: '3h', ar: '3س', en: '3h' },
  { key: '6h', ar: '6س', en: '6h' },
  { key: '12h', ar: '12س', en: '12h' },
  { key: 'today', ar: 'اليوم', en: 'Today' },
  { key: '24h', ar: '24س', en: '24h' },
  { key: 'custom', ar: 'مخصص', en: 'Custom' },
];

const WARNING_LABELS: Record<string, { ar: string; en: string }> = {
  PRINT_FAILURES: { ar: 'فشل طباعة', en: 'Print failures' },
  STALE_OPEN_ORDERS: { ar: 'طلبات مفتوحة عالقة', en: 'Stale open orders' },
  SALES_WITHOUT_SHIFT_COVERAGE: { ar: 'مبيعات بدون تغطية شفت مطابقة', en: 'Sales without matching shift coverage' },
  SALES_WITHOUT_PRINT_SUBMISSION: { ar: 'مبيعات بدون إرسال طباعة', en: 'Sales without print submission' },
};

const STATUS_META: Record<PulseStatus, { ar: string; en: string; className: string }> = {
  ok: { ar: 'إشارات مستقرة', en: 'Signals stable', className: 'border-ui-success/30 bg-ui-success-soft text-ui-success' },
  quiet: { ar: 'هادئ', en: 'Quiet', className: 'border-ui-border bg-ui-page-alt text-ui-muted' },
  warning: { ar: 'يحتاج مراجعة', en: 'Needs review', className: 'border-ui-warning/30 bg-ui-warning-soft text-ui-warning' },
};

function n(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function localInputValue(date: Date): string {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return shifted.toISOString().slice(0, 16);
}

function resolveRange(preset: RangePreset, customFrom: string, customTo: string): { from: Date; to: Date } | null {
  const to = preset === 'custom' ? new Date(customTo) : new Date();
  if (Number.isNaN(to.getTime())) return null;

  if (preset === 'custom') {
    const from = new Date(customFrom);
    if (Number.isNaN(from.getTime()) || from >= to) return null;
    return { from, to };
  }

  if (preset === 'today') {
    const from = new Date(to);
    from.setHours(0, 0, 0, 0);
    return { from, to };
  }

  const hours = preset === '24h' ? 24
    : preset === '12h' ? 12
      : preset === '6h' ? 6
        : preset === '3h' ? 3
          : preset === '1h' ? 1
            : 0.5;

  return { from: new Date(to.getTime() - hours * 60 * 60 * 1000), to };
}

function Metric({ icon, label, value, detail }: { icon: ReactNode; label: string; value: string; detail?: string }) {
  return (
    <div className="rounded-2xl border border-ui-border bg-ui-page-alt/60 p-3">
      <div className="flex items-center gap-2 text-[11px] font-bold text-ui-muted">{icon}{label}</div>
      <div className="mt-1 text-lg font-black text-ui-text">{value}</div>
      {detail ? <div className="mt-0.5 text-[10px] font-bold text-ui-subtle">{detail}</div> : null}
    </div>
  );
}

export function BranchPulsePanel() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const branchFilter = useBranchFilter();
  const initialNow = useMemo(() => new Date(), []);
  const [preset, setPreset] = useState<RangePreset>('30m');
  const [customFrom, setCustomFrom] = useState(() => localInputValue(new Date(initialNow.getTime() - 60 * 60 * 1000)));
  const [customTo, setCustomTo] = useState(() => localInputValue(initialNow));
  const [branches, setBranches] = useState<BranchPulseRow[]>([]);
  const [issues, setIssues] = useState<UserIssueRow[]>([]);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRunAt, setLastRunAt] = useState<string | null>(null);

  const runPulse = useCallback(async () => {
    const range = resolveRange(preset, customFrom, customTo);
    if (!range) {
      setError(ar ? 'الفترة المحددة غير صحيحة.' : 'The selected time range is invalid.');
      return;
    }

    setRunning(true);
    setError(null);
    const args = {
      p_from: range.from.toISOString(),
      p_to: range.to.toISOString(),
      p_branch_id: branchFilter || null,
    };

    const [pulseResult, issueResult] = await Promise.all([
      admin.getBranchActivitySnapshot(args),
      admin.getUserIssueSummary({ ...args, p_limit: 80 }),
    ]);

    const pulse = pulseResult.data as PulseEnvelope | null;
    const issueSummary = issueResult.data as IssueEnvelope | null;

    if (pulseResult.error || !pulse || pulse.success === false) {
      setError(pulseResult.error?.message || pulse?.error || (ar ? 'تعذر تنفيذ نبضة الفروع.' : 'Could not run Branch Pulse.'));
      setRunning(false);
      return;
    }

    setBranches(Array.isArray(pulse.branches) ? pulse.branches : []);
    setIssues(
      issueResult.error || !issueSummary || issueSummary.success === false || !Array.isArray(issueSummary.issues)
        ? []
        : issueSummary.issues,
    );
    setLastRunAt(new Date(pulse.generated_at || Date.now()).toLocaleString());
    setRunning(false);
  }, [ar, branchFilter, customFrom, customTo, preset]);

  useEffect(() => {
    void runPulse();
  }, [runPulse]);

  const visibleBranches = useMemo(
    () => problemsOnly ? branches.filter((row) => row.signal_status === 'warning') : branches,
    [branches, problemsOnly],
  );
  const warningCount = useMemo(
    () => branches.filter((row) => row.signal_status === 'warning').length,
    [branches],
  );

  return (
    <div className="space-y-4" data-testid="system-health-branch-pulse">
      <Card className="overflow-hidden">
        <div className="border-b border-ui-border p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Activity className="h-5 w-5 text-brand-600" />
                <h2 className="text-lg font-black text-ui-text">{ar ? 'نبضة الفروع' : 'Branch Pulse'}</h2>
              </div>
              <p className="mt-1 text-xs font-bold text-ui-subtle">
                {ar
                  ? 'قراءة سريعة لنشاط كل فرع. عدم وجود مبيعات أو طلبات وحده لا يعني وجود عطل.'
                  : 'A quick read of branch activity. Zero sales or orders alone does not mean the branch is unhealthy.'}
              </p>
              {lastRunAt ? <p className="mt-1 text-[10px] font-bold text-ui-muted">{ar ? 'آخر نبضة' : 'Last pulse'}: {lastRunAt}</p> : null}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                data-testid="branch-pulse-problems-only"
                onClick={() => setProblemsOnly((value) => !value)}
                className={problemsOnly
                  ? 'rounded-xl bg-ui-warning-soft px-3 py-2 text-xs font-black text-ui-warning ring-1 ring-ui-warning/30'
                  : 'rounded-xl bg-ui-page-alt px-3 py-2 text-xs font-black text-ui-muted ring-1 ring-ui-border'}
              >
                {ar ? 'عرض المشاكل فقط' : 'Problems only'}{warningCount > 0 ? ' · ' + warningCount : ''}
              </button>
              <Button onClick={() => void runPulse()} disabled={running}>
                <RefreshCw className={running ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
                {ar ? 'نبضة الفروع' : 'Run pulse'}
              </Button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {PRESETS.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setPreset(item.key)}
                className={preset === item.key
                  ? 'rounded-xl bg-ui-primary px-3 py-2 text-xs font-black text-ui-primary-fg'
                  : 'rounded-xl bg-ui-page-alt px-3 py-2 text-xs font-black text-ui-muted ring-1 ring-ui-border'}
              >
                {ar ? item.ar : item.en}
              </button>
            ))}
          </div>

          {preset === 'custom' ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-bold text-ui-muted">
                {ar ? 'من' : 'From'}
                <input
                  type="datetime-local"
                  value={customFrom}
                  onChange={(event) => setCustomFrom(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-ui-border bg-ui-surface px-3 py-2 text-sm text-ui-text"
                />
              </label>
              <label className="text-xs font-bold text-ui-muted">
                {ar ? 'إلى' : 'To'}
                <input
                  type="datetime-local"
                  value={customTo}
                  onChange={(event) => setCustomTo(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-ui-border bg-ui-surface px-3 py-2 text-sm text-ui-text"
                />
              </label>
            </div>
          ) : null}

          {error ? (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-ui-danger/30 bg-ui-danger-soft p-3 text-xs font-bold text-ui-danger">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 p-4 xl:grid-cols-2">
          {visibleBranches.map((row) => {
            const status = row.signal_status || 'quiet';
            const meta = STATUS_META[status];
            const warningCodes = Array.isArray(row.warnings) ? row.warnings : [];
            const branchName = ar ? row.branch_name : (row.branch_name_en || row.branch_name);

            return (
              <div key={row.branch_id} className="rounded-3xl border border-ui-border bg-ui-surface p-4 shadow-ui-xs">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-ui-page-alt">
                      <Building2 className="h-5 w-5 text-brand-600" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-black text-ui-text">{branchName}</div>
                      <div className="text-[10px] font-bold text-ui-subtle">
                        {status === 'quiet'
                          ? (ar ? 'لا توجد إشارات مشكلة؛ قد يكون الفرع هادئًا فقط.' : 'No problem signal; the branch may simply be quiet.')
                          : (ar ? 'مؤشرات الفترة المحددة' : 'Signals for the selected window')}
                      </div>
                    </div>
                  </div>
                  <span className={'rounded-full border px-3 py-1 text-[10px] font-black ' + meta.className}>
                    {ar ? meta.ar : meta.en}
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Metric icon={<ShoppingCart className="h-3.5 w-3.5" />} label={ar ? 'الطلبات' : 'Orders'} value={formatNumber(n(row.order_count), 0)} />
                  <Metric icon={<ReceiptText className="h-3.5 w-3.5" />} label={ar ? 'المبيعات المكتملة' : 'Completed sales'} value={formatNumber(n(row.completed_sales_count), 0)} detail={formatNumber(n(row.completed_sales_value), 2)} />
                  <Metric icon={<Printer className="h-3.5 w-3.5" />} label={ar ? 'الطباعة' : 'Printing'} value={formatNumber(n(row.print_submitted_count), 0) + ' / ' + formatNumber(n(row.print_failed_count), 0)} detail={ar ? 'مقبول للنظام / فشل' : 'Accepted / failed'} />
                  <Metric icon={<WalletCards className="h-3.5 w-3.5" />} label={ar ? 'المشتريات' : 'Purchases'} value={formatNumber(n(row.purchase_count), 0)} detail={formatNumber(n(row.purchase_value), 2)} />
                  <Metric icon={<WalletCards className="h-3.5 w-3.5" />} label={ar ? 'المصروفات' : 'Expenses'} value={formatNumber(n(row.expense_count), 0)} detail={formatNumber(n(row.expense_value), 2)} />
                  <Metric icon={<UsersRound className="h-3.5 w-3.5" />} label={ar ? 'الشفتات / المشغلون' : 'Shifts / operators'} value={formatNumber(n(row.open_shift_count), 0) + ' / ' + formatNumber(n(row.open_operator_count), 0)} />
                </div>

                {warningCodes.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {warningCodes.map((code) => (
                      <span key={code} className="rounded-full bg-ui-warning-soft px-2.5 py-1 text-[10px] font-black text-ui-warning">
                        {WARNING_LABELS[code] ? (ar ? WARNING_LABELS[code].ar : WARNING_LABELS[code].en) : code}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}

          {!running && visibleBranches.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-ui-border p-6 text-center text-sm font-bold text-ui-muted xl:col-span-2">
              {problemsOnly
                ? (ar ? 'لا توجد فروع عليها إشارات مشكلة في الفترة المحددة.' : 'No branches have problem signals in this window.')
                : (ar ? 'لا توجد فروع متاحة ضمن نطاقك الحالي.' : 'No branches are available in your current scope.')}
            </div>
          ) : null}
        </div>
      </Card>

      <Card className="overflow-hidden" data-testid="system-health-user-issues">
        <div className="flex items-center gap-3 border-b border-ui-border p-5">
          <AlertTriangle className="h-5 w-5 text-ui-warning" />
          <div>
            <h2 className="font-black text-ui-text">{ar ? 'مشاكل المستخدمين' : 'User issues'}</h2>
            <p className="text-xs font-bold text-ui-subtle">
              {ar
                ? 'أخطاء ورسائل ظهرت للمستخدمين، مجمعة بدون كلمات مرور أو رموز دخول أو بيانات خام.'
                : 'User-visible issues grouped without passwords, access tokens, or raw payloads.'}
            </p>
          </div>
        </div>

        <div className="divide-y divide-ui-border">
          {issues.map((issue, index) => (
            <div key={(issue.error_code || 'issue') + '-' + (issue.screen || '') + '-' + index} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={issue.issue_kind === 'technical'
                      ? 'rounded-full bg-ui-danger-soft px-2 py-1 text-[10px] font-black text-ui-danger'
                      : 'rounded-full bg-ui-warning-soft px-2 py-1 text-[10px] font-black text-ui-warning'}>
                      {issue.issue_kind === 'technical'
                        ? (ar ? 'تقني' : 'Technical')
                        : (ar ? 'تشغيلي / تحقق' : 'Operational / validation')}
                    </span>
                    <span className="font-mono text-[11px] font-bold text-ui-muted">{issue.error_code || 'CLIENT_ERROR'}</span>
                    {issue.branch_name ? <span className="text-[11px] font-bold text-ui-subtle">· {issue.branch_name}</span> : null}
                  </div>
                  <p className="mt-2 text-sm font-bold text-ui-text">{issue.user_message || (ar ? 'تعذر إكمال العملية.' : 'The action could not be completed.')}</p>
                  <p className="mt-1 truncate text-[10px] font-bold text-ui-subtle">
                    {issue.screen || '/unknown'} · {issue.action || 'unknown'}
                  </p>
                </div>
                <div className="text-end">
                  <div className="text-sm font-black text-ui-text">{formatNumber(n(issue.occurrences), 0)}×</div>
                  <div className="text-[10px] font-bold text-ui-subtle">{formatNumber(n(issue.affected_users), 0)} {ar ? 'مستخدم' : 'users'}</div>
                  {issue.latest_at ? (
                    <div className="mt-1 flex items-center justify-end gap-1 text-[10px] font-bold text-ui-muted">
                      <Clock3 className="h-3 w-3" />
                      {new Date(issue.latest_at).toLocaleString()}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          ))}

          {!running && issues.length === 0 ? (
            <div className="p-6 text-center text-sm font-bold text-ui-muted">
              {ar ? 'لا توجد مشاكل مستخدمين مسجلة في الفترة المحددة.' : 'No user issues were recorded in the selected window.'}
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
