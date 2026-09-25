import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { REPORT_REGISTRY } from './reportRegistry';
import type { ReportType } from './reportFilters';

interface ReportingShellProps {
  activeReport: ReportType;
  onSelectReport: (type: ReportType) => void;
  children: React.ReactNode;
}

export function ReportingShell({ onSelectReport, children }: ReportingShellProps) {
  const [searchParams] = useSearchParams();

  useEffect(() => {
    const deepType = searchParams.get('type') || searchParams.get('reportType');
    if (deepType && REPORT_REGISTRY.some((report) => report.key === deepType)) {
      onSelectReport(deepType as ReportType);
    }
  }, [searchParams, onSelectReport]);

  return (
    <div className="ui-accent-top ui-accent-system min-w-0">
      {children}
    </div>
  );
}
