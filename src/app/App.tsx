import { AppProviders } from './providers';
import { AppRoutes } from './routes';
import { FinancialVisibilityAdminControl } from '@/features/admin/components/FinancialVisibilityAdminControl';
import { SessionProfileGuard } from '@/core/security/SessionProfileGuard';
import { PrinterSettingsLauncher } from '@/features/pos/components/settings/PrinterSettingsLauncher';

export default function App() {
  return (
    <AppProviders>
      <SessionProfileGuard>
        <AppRoutes />
        <FinancialVisibilityAdminControl />
        <PrinterSettingsLauncher />
      </SessionProfileGuard>
    </AppProviders>
  );
}
