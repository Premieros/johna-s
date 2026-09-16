import '../dashboardCompact.css';
import { DashboardDataPage } from './DashboardDataPage';

/**
 * Unified dashboard entry point.
 * All visible business numbers are loaded from the same period/branch-aware data surface.
 */
export function DashboardEnhancedPage() {
  return (
    <div className="dashboard-compact-cleanup">
      <DashboardDataPage />
    </div>
  );
}
