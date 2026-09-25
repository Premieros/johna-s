import { useCallback, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { BarChart3, Landmark } from 'lucide-react';
import { ReportingShell } from '../ReportingShell';
import { ReportsPage } from './ReportsPage';
import { FinancialReportsPage } from '@/features/accounting/pages/FinancialReportsPage';
import { useCan } from '@/lib/permissions';
import { useLanguage } from '@/context/LanguageContext';
import type { ReportType } from '../reportFilters';

type ReportsSection = 'operational' | 'financial';

export function ReportsCenterPage() {
  const can = useCan();
  const { lang } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const canOperational = can('reports.view');
  const canFinancial = can('reports.financial');
  const requestedFinancial = location.pathname.includes('financial-reports') || searchParams.get('section') === 'financial' || Boolean(searchParams.get('view'));
  const initialSection: ReportsSection = requestedFinancial && canFinancial ? 'financial' : (canOperational ? 'operational' : 'financial');
  const [section, setSection] = useState<ReportsSection>(initialSection);
  const [activeReport, setActiveReport] = useState<ReportType>('sales');
  const handleSelect = useCallback((type: ReportType) => setActiveReport(type), []);

  const effectiveSection = useMemo<ReportsSection>(() => {
    if (section === 'financial' && canFinancial) return 'financial';
    if (section === 'operational' && canOperational) return 'operational';
    return canOperational ? 'operational' : 'financial';
  }, [section, canFinancial, canOperational]);

  const selectSection = (next: ReportsSection) => {
    setSection(next);
    if (next === 'financial') {
      const params = new URLSearchParams(searchParams);
      params.set('section', 'financial');
      navigate(`/reports?${params.toString()}`, { replace: true });
    } else {
      navigate('/reports', { replace: true });
    }
  };

  const sectionButton = (target: ReportsSection, labelAr: string, labelEn: string, icon: React.ReactNode) => (
    <button
      type="button"
      onClick={() => selectSection(target)}
      className={`flex min-h-10 items-center gap-2 rounded-lg px-4 text-sm font-bold transition ${effectiveSection === target ? 'bg-ui-primary text-ui-primary-fg' : 'bg-ui-page-alt text-ui-muted hover:text-ui-primary'}`}
    >
      {icon}
      {lang === 'ar' ? labelAr : labelEn}
    </button>
  );

  return (
    <div className="space-y-3" data-testid="unified-reports-center">
      {canOperational && canFinancial && (
        <div className="sticky top-0 z-30 flex gap-2 rounded-xl border border-ui-border bg-ui-surface/95 p-2 shadow-ui-sm backdrop-blur">
          {sectionButton('operational', 'التقارير التشغيلية والمخزون والتكلفة', 'Operations, Inventory & Costing', <BarChart3 className="h-4 w-4" />)}
          {sectionButton('financial', 'المالية والمحاسبة', 'Finance & Accounting', <Landmark className="h-4 w-4" />)}
        </div>
      )}

      {effectiveSection === 'financial' ? (
        <FinancialReportsPage />
      ) : (
        <ReportingShell activeReport={activeReport} onSelectReport={handleSelect}>
          <ReportsPage controlledReportType={activeReport} onReportTypeChange={handleSelect} />
        </ReportingShell>
      )}
    </div>
  );
}
