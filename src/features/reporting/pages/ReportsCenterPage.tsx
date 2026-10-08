import { useCallback, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ReportsPage } from './ReportsPage';
import { FinancialReportsPage } from '@/features/accounting/pages/FinancialReportsPage';
import { useCan, type Permission } from '@/lib/permissions';
import { useLanguage } from '@/context/LanguageContext';
import type { ReportType } from '../reportFilters';
import { permittedBasicReports, workspaceViewKey, type WorkspaceView } from '../reportWorkspace';

export function ReportsCenterPage() {
  const can = useCan();
  const { lang } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [search, setSearch] = useState('');
  const ar = lang === 'ar';
  const reports = useMemo(() => permittedBasicReports(permission => can(permission as Permission)), [can]);
  const financial = location.pathname.includes('financial-reports') || params.get('section') === 'financial' || !!params.get('view');
  const requested = financial ? `financial:${params.get('view') || 'trial_balance'}` : workspaceViewKey((params.get('type') || 'sales') as ReportType);
  const report = reports.find(item => item.views.some(view => view.key === requested)) || reports[0];
  const view = report?.views.find(item => item.key === requested) || report?.views[0];
  const query = search.trim().toLocaleLowerCase();
  const visible = reports.map(item => {
    const match = (value: string) => value.toLocaleLowerCase().includes(query);
    const groupMatches = [item.ar, item.en, item.descriptionAr, item.descriptionEn].some(match);
    return { ...item, views: groupMatches ? item.views : item.views.filter(value => match(value.ar) || match(value.en)) };
  }).filter(item => item.views.length);

  const select = useCallback((target: WorkspaceView) => {
    const next = new URLSearchParams();
    for (const key of ['from', 'to']) { const value = params.get(key); if (value) next.set(key, value); }
    if (target.financial) { next.set('section', 'financial'); next.set('view', target.financial); }
    else if (target.type) next.set('type', target.type);
    navigate(`/reports?${next}`, { replace: true });
  }, [navigate, params]);
  const selectOperational = useCallback((type: ReportType) => {
    const target = reports.flatMap(item => item.views).find(item => item.key === workspaceViewKey(type));
    if (target) select(target);
  }, [reports, select]);

  if (!report || !view) return <p role="status">{ar ? 'لا توجد تقارير متاحة لصلاحياتك.' : 'No reports are available for your permissions.'}</p>;
  return <div data-testid="unified-reports-center" className="space-y-3">
    <div className="grid min-w-0 gap-4 lg:grid-cols-[210px_minmax(0,1fr)]">
      <aside className="space-y-3 lg:sticky lg:top-2 lg:self-start" aria-label={ar ? 'التقارير الأساسية' : 'Basic reports'}>
        <div className="relative">
          <Search className="pointer-events-none absolute start-3 top-3 h-4 w-4 text-ui-muted" />
          <input type="search" aria-label={ar ? 'بحث في التقارير' : 'Search reports'} placeholder={ar ? 'ابحث عن تقرير أو عرض' : 'Find a report or view'} value={search} onChange={event => setSearch(event.target.value)} className="h-10 w-full rounded-lg border border-ui-border bg-ui-surface ps-9 pe-3 text-sm" />
        </div>
        <nav className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1">
          {visible.map(item => <button key={item.key} type="button" data-report-primary={item.key} aria-current={item.key === report.key ? 'page' : undefined} onClick={() => select(item.views[0])} className={`min-h-12 rounded-lg border px-3 py-3 text-start text-sm font-bold ${item.key === report.key ? 'border-ui-primary bg-ui-primary/10 text-ui-primary' : 'border-ui-border bg-ui-surface text-ui-text hover:bg-ui-page-alt'}`}>
            {ar ? item.ar : item.en}
          </button>)}
        </nav>
        {!visible.length && <p role="status" className="text-sm text-ui-muted">{ar ? 'لا توجد نتائج مطابقة.' : 'No matching results.'}</p>}
        {!!query && <div className="space-y-1">{visible.flatMap(item => item.views).map(item => <button type="button" key={item.key} onClick={() => select(item)} className="block w-full rounded px-2 py-2 text-start text-sm text-ui-primary">{ar ? item.ar : item.en}</button>)}</div>}
      </aside>
      <main className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-ui-border bg-ui-surface p-4">
          <div><h2 className="text-xl font-bold">{ar ? report.ar : report.en}</h2><p className="mt-1 text-sm text-ui-muted">{ar ? report.descriptionAr : report.descriptionEn}</p></div>
          <label className="min-w-56 text-sm font-semibold">{ar ? 'طريقة العرض' : 'Report view'}
            <select aria-label={ar ? 'طريقة العرض' : 'Report view'} value={view.key} onChange={event => { const target = report.views.find(item => item.key === event.target.value); if (target) select(target); }} className="mt-1 block h-10 w-full rounded-lg border border-ui-border bg-ui-page-alt px-3 font-normal">
              {report.views.map(item => <option key={item.key} value={item.key}>{ar ? item.ar : item.en}</option>)}
            </select>
          </label>
        </div>
        {view.financial ? <FinancialReportsPage hideViewPicker /> : <ReportsPage controlledReportType={view.type} onReportTypeChange={selectOperational} workspaceTitle={ar ? view.ar : view.en} />}
      </main>
    </div>
  </div>;
}
