import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ReportsPage } from './ReportsPage';
import { FinancialReportsPage } from '@/features/accounting/pages/FinancialReportsPage';
import { useCan, type Permission } from '@/lib/permissions';
import { useLanguage } from '@/context/LanguageContext';
import { REPORT_REGISTRY } from '../reportRegistry';
import type { ReportType } from '../reportFilters';

type FinancialView =
  | 'trial_balance'
  | 'ledger'
  | 'treasury_statement'
  | 'inventory_movement'
  | 'income'
  | 'balance_sheet'
  | 'ar_aging'
  | 'ap_aging'
  | 'aging_summary'
  | 'cash_flow'
  | 'party_statement';

const LEGACY_HIDDEN_REPORTS = new Set<ReportType>([
  'component_consumption',
  'recipe_costs',
  'top_consumed_components',
  'top_consumed_products',
]);

const FINANCIAL_REPORTS: Array<{ key: FinancialView; ar: string; en: string }> = [
  { key: 'treasury_statement', ar: 'كشف حساب بنك / خزنة', en: 'Bank / Treasury Statement' },
  { key: 'inventory_movement', ar: 'حركة صنف', en: 'Item Movement' },
  { key: 'ledger', ar: 'دفتر الأستاذ', en: 'General Ledger' },
  { key: 'trial_balance', ar: 'ميزان المراجعة', en: 'Trial Balance' },
  { key: 'income', ar: 'قائمة الدخل', en: 'Income Statement' },
  { key: 'balance_sheet', ar: 'الميزانية', en: 'Balance Sheet' },
  { key: 'ar_aging', ar: 'أعمار ديون العملاء', en: 'AR Aging' },
  { key: 'ap_aging', ar: 'أعمار ديون الموردين', en: 'AP Aging' },
  { key: 'aging_summary', ar: 'ملخص الذمم', en: 'Aging Summary' },
  { key: 'cash_flow', ar: 'التدفقات النقدية', en: 'Cash Flow' },
  { key: 'party_statement', ar: 'كشف حساب عميل / مورد', en: 'Party Statement' },
];

export function ReportsCenterPage() {
  const can = useCan();
  const { lang } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [mobileListOpen, setMobileListOpen] = useState(false);

  const requestedType = searchParams.get('type') as ReportType | null;
  const requestedFinancialView = searchParams.get('view') as FinancialView | null;
  const requestedFinancial =
    location.pathname.includes('financial-reports')
    || searchParams.get('section') === 'financial'
    || Boolean(requestedFinancialView);

  const permittedOperational = useMemo(
    () => REPORT_REGISTRY.filter((report) =>
      !LEGACY_HIDDEN_REPORTS.has(report.key)
      && report.permissions.every((permission) => can(permission as Permission))
    ),
    [can],
  );

  const initialOperational =
    requestedType && permittedOperational.some((report) => report.key === requestedType)
      ? requestedType
      : permittedOperational[0]?.key || 'sales';

  const [activeReport, setActiveReport] = useState<ReportType>(initialOperational);

  useEffect(() => {
    if (requestedType && permittedOperational.some((report) => report.key === requestedType)) {
      setActiveReport(requestedType);
    }
  }, [requestedType, permittedOperational]);

  const canFinancial = can('reports.financial');
  const activeFinancialView: FinancialView =
    requestedFinancialView && FINANCIAL_REPORTS.some((report) => report.key === requestedFinancialView)
      ? requestedFinancialView
      : 'trial_balance';

  const filteredOperational = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return permittedOperational;
    return permittedOperational.filter((report) =>
      report.title.toLowerCase().includes(q)
      || report.titleEn.toLowerCase().includes(q)
      || report.key.toLowerCase().includes(q)
    );
  }, [search, permittedOperational]);

  const filteredFinancial = useMemo(() => {
    if (!canFinancial) return [];
    const q = search.trim().toLowerCase();
    if (!q) return FINANCIAL_REPORTS;
    return FINANCIAL_REPORTS.filter((report) =>
      report.ar.toLowerCase().includes(q)
      || report.en.toLowerCase().includes(q)
      || report.key.toLowerCase().includes(q)
    );
  }, [search, canFinancial]);

  const selectOperational = useCallback((type: ReportType) => {
    setActiveReport(type);
    setMobileListOpen(false);
    navigate(`/reports?type=${type}`, { replace: true });
  }, [navigate]);

  const selectFinancial = useCallback((view: FinancialView) => {
    setMobileListOpen(false);
    navigate(`/reports?section=financial&view=${view}`, { replace: true });
  }, [navigate]);

  const currentName = requestedFinancial
    ? FINANCIAL_REPORTS.find((report) => report.key === activeFinancialView)
    : permittedOperational.find((report) => report.key === activeReport);

  const reportList = (
    <div className="rounded-lg border border-ui-border bg-ui-surface">
      <div className="border-b border-ui-border p-2">
        <div className="relative">
          <Search className="pointer-events-none absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ui-subtle" />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={lang === 'ar' ? 'بحث في التقارير' : 'Search reports'}
            className="h-9 w-full rounded-md border border-ui-border bg-ui-page-alt ps-8 pe-2 text-xs font-semibold text-ui-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-ring"
          />
        </div>
      </div>

      <div className="max-h-[calc(100vh-12rem)] overflow-y-auto">
        {filteredOperational.map((report) => {
          const selected = !requestedFinancial && activeReport === report.key;
          return (
            <button
              key={report.key}
              type="button"
              onClick={() => selectOperational(report.key)}
              className={`flex min-h-9 w-full items-center border-b border-ui-border/70 px-3 text-start text-xs font-bold transition last:border-b-0 ${
                selected
                  ? 'bg-ui-primary/10 text-ui-primary'
                  : 'bg-ui-surface text-ui-text hover:bg-ui-page-alt'
              }`}
            >
              <span className="truncate">{lang === 'ar' ? report.title : report.titleEn}</span>
            </button>
          );
        })}

        {filteredFinancial.map((report) => {
          const selected = requestedFinancial && activeFinancialView === report.key;
          return (
            <button
              key={report.key}
              type="button"
              onClick={() => selectFinancial(report.key)}
              className={`flex min-h-9 w-full items-center border-b border-ui-border/70 px-3 text-start text-xs font-bold transition last:border-b-0 ${
                selected
                  ? 'bg-ui-primary/10 text-ui-primary'
                  : 'bg-ui-surface text-ui-text hover:bg-ui-page-alt'
              }`}
            >
              <span className="truncate">{lang === 'ar' ? report.ar : report.en}</span>
            </button>
          );
        })}

        {filteredOperational.length === 0 && filteredFinancial.length === 0 && (
          <div className="px-3 py-6 text-center text-xs text-ui-subtle">
            {lang === 'ar' ? 'لا توجد تقارير مطابقة' : 'No matching reports'}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-2" data-testid="unified-reports-center">
      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setMobileListOpen((open) => !open)}
          className="flex h-10 w-full items-center justify-between rounded-lg border border-ui-border bg-ui-surface px-3 text-sm font-bold text-ui-text"
        >
          <span className="truncate">
            {currentName
              ? ('title' in currentName
                ? (lang === 'ar' ? currentName.title : currentName.titleEn)
                : (lang === 'ar' ? currentName.ar : currentName.en))
              : (lang === 'ar' ? 'التقارير' : 'Reports')}
          </span>
          {mobileListOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
        {mobileListOpen && <div className="mt-2">{reportList}</div>}
      </div>

      <div className="grid min-w-0 gap-3 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="hidden lg:block lg:sticky lg:top-2 lg:self-start">
          {reportList}
        </aside>

        <main className="min-w-0">
          {requestedFinancial && canFinancial ? (
            <FinancialReportsPage hideViewPicker />
          ) : (
            <ReportsPage controlledReportType={activeReport} onReportTypeChange={selectOperational} />
          )}
        </main>
      </div>
    </div>
  );
}
