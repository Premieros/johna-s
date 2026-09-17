import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Loader2, Printer, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/Button';
import { Select } from '@/components/Input';
import { useLanguage } from '@/context/LanguageContext';
import { useBranches } from '@/hooks/useBranches';
import { useCan } from '@/lib/permissions';
import {
  getCloudPrintAgentBranchId,
  getCloudPrintQueue,
  type CloudPrintQueueJob,
  type CloudPrintQueueSnapshot,
} from '../../services/cloudPrint';

const EMPTY: CloudPrintQueueSnapshot = { jobs: [], agents: [] };
const REFRESH_MS = 2_000;

function statusLabel(status: CloudPrintQueueJob['status'], ar: boolean): string {
  const labels: Record<CloudPrintQueueJob['status'], [string, string]> = {
    pending: ['معلق', 'Pending'],
    claimed: ['تم استلامه', 'Claimed'],
    printing: ['قيد الطباعة', 'Printing'],
    submitted: ['أُرسل للطابعة', 'Submitted'],
    printed: ['مطبوع', 'Printed'],
    failed: ['فشل', 'Failed'],
  };
  return labels[status]?.[ar ? 0 : 1] || status;
}

function statusClass(status: CloudPrintQueueJob['status']): string {
  if (status === 'failed') return 'border-ui-danger/30 bg-ui-danger/10 text-ui-danger';
  if (status === 'printing' || status === 'claimed') return 'border-ui-warning/30 bg-ui-warning/10 text-ui-warning';
  if (status === 'submitted' || status === 'printed') return 'border-ui-success/30 bg-ui-success/10 text-ui-success';
  return 'border-ui-border bg-ui-page-alt text-ui-muted';
}

function age(value: string, ar: boolean): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return ar ? `${seconds} ث` : `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return ar ? `${minutes} د` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return ar ? `${hours} س` : `${hours}h`;
}

export function PrintQueueMonitor() {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const can = useCan();
  const { branches } = useBranches();
  const [branchId, setBranchId] = useState('');
  const [snapshot, setSnapshot] = useState<CloudPrintQueueSnapshot>(EMPTY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!can('settings.manage')) return;
    const allowed = new Set(branches.filter((branch) => branch.is_active !== false).map((branch) => branch.id));
    const stored = getCloudPrintAgentBranchId();
    setBranchId((current) => {
      if (current && allowed.has(current)) return current;
      if (stored && allowed.has(stored)) return stored;
      if (allowed.size === 1) return Array.from(allowed)[0] || '';
      return '';
    });
  }, [branches, can]);

  const load = useCallback(async (showSpinner = false) => {
    if (!branchId || !can('settings.manage')) {
      setSnapshot(EMPTY);
      return;
    }
    if (showSpinner) setLoading(true);
    try {
      const next = await getCloudPrintQueue(branchId, 120);
      setSnapshot(next);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'PRINT_QUEUE_LOAD_FAILED');
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [branchId, can]);

  useEffect(() => {
    void load(true);
    if (!branchId) return;
    const timer = window.setInterval(() => void load(false), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [branchId, load]);

  const activeJobs = useMemo(
    () => snapshot.jobs.filter((job) => job.status !== 'submitted' && job.status !== 'printed'),
    [snapshot.jobs],
  );
  const grouped = useMemo(() => {
    const map = new Map<string, CloudPrintQueueJob[]>();
    for (const job of activeJobs) {
      const key = job.station_code || 'unknown';
      const jobs = map.get(key) || [];
      jobs.push(job);
      map.set(key, jobs);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [activeJobs]);
  const onlineAgents = snapshot.agents.filter((agent) => agent.is_online);

  if (!can('settings.manage')) return null;

  return (
    <section className="space-y-4 border-t border-ui-border pt-5" data-testid="print-queue-monitor">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-ui-text">
            <Printer className="h-5 w-5 text-brand-600" />
            <h3 className="font-bold">{ar ? 'طابور محطات الطباعة' : 'Print Station Queue'}</h3>
          </div>
          <p className="mt-1 text-xs text-ui-subtle">
            {ar
              ? 'الأوامر تبقى هنا حتى يلتقطها برنامج الطباعة المثبت على جهاز الفرع.'
              : 'Jobs stay here until the installed branch print program claims them.'}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Select value={branchId} onChange={(event) => setBranchId(event.target.value)}>
            <option value="">{ar ? 'اختر الفرع' : 'Choose branch'}</option>
            {branches.filter((branch) => branch.is_active !== false).map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.name}</option>
            ))}
          </Select>
          <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={!branchId || loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            <span>{ar ? 'تحديث' : 'Refresh'}</span>
          </Button>
        </div>
      </div>

      {branchId && (
        <div className="flex flex-wrap gap-2 text-xs">
          <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${onlineAgents.length > 0 ? 'border-ui-success/30 bg-ui-success/10 text-ui-success' : 'border-ui-danger/30 bg-ui-danger/10 text-ui-danger'}`}>
            {onlineAgents.length > 0 ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
            {onlineAgents.length > 0
              ? (ar ? `${onlineAgents.length} برنامج طباعة متصل` : `${onlineAgents.length} print agent online`)
              : (ar ? 'لا يوجد برنامج طباعة متصل الآن' : 'No print agent online')}
          </span>
          <span className="rounded-full border border-ui-border bg-ui-page-alt px-2.5 py-1 text-ui-muted">
            {ar ? `${activeJobs.length} أمر معلق` : `${activeJobs.length} active jobs`}
          </span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-ui-danger/30 bg-ui-danger/10 px-3 py-2 text-xs text-ui-danger">
          <AlertTriangle className="h-4 w-4" /> {error}
        </div>
      )}

      {!branchId ? (
        <div className="rounded-xl border border-dashed border-ui-border p-5 text-center text-sm text-ui-muted">
          {ar ? 'اختر فرعًا لعرض طابور الطباعة.' : 'Choose a branch to view its print queue.'}
        </div>
      ) : grouped.length === 0 ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-ui-border bg-ui-page-alt p-5 text-sm text-ui-success">
          <CheckCircle2 className="h-4 w-4" />
          {ar ? 'لا توجد أوامر طباعة معلقة.' : 'No pending print jobs.'}
        </div>
      ) : (
        <div className="grid gap-3">
          {grouped.map(([station, jobs]) => (
            <div key={station} className="rounded-2xl border border-ui-border bg-ui-surface p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-ui-text">{station}</p>
                  <p className="text-[11px] text-ui-subtle">{ar ? `${jobs.length} أمر في المحطة` : `${jobs.length} jobs at station`}</p>
                </div>
                <span className="rounded-full bg-ui-page-alt px-2.5 py-1 text-xs font-bold text-ui-muted">{jobs.length}</span>
              </div>
              <div className="space-y-2">
                {jobs.map((job) => (
                  <div key={job.id} className="grid gap-2 rounded-xl border border-ui-border bg-ui-page-alt p-3 text-xs sm:grid-cols-[auto_1fr_auto] sm:items-center">
                    <span className={`inline-flex w-fit items-center gap-1 rounded-full border px-2 py-1 font-semibold ${statusClass(job.status)}`}>
                      {job.status === 'printing' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Clock3 className="h-3 w-3" />}
                      {statusLabel(job.status, ar)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-ui-text">{job.kind === 'receipt' ? (ar ? 'إيصال عميل' : 'Customer receipt') : (ar ? 'تذكرة مطبخ' : 'Kitchen ticket')}</p>
                      <p className="truncate text-ui-subtle">{job.last_error || (ar ? `محاولة ${job.attempts}` : `Attempt ${job.attempts}`)}</p>
                    </div>
                    <span className="text-ui-subtle">{age(job.created_at, ar)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
