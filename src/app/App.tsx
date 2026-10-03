import { lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { AppProviders } from './providers';
import { AppRoutes } from './routes';
import { SessionProfileGuard } from '@/core/security/SessionProfileGuard';
import { CloudPrintAgent } from '@/features/pos/components/settings/CloudPrintAgent';
import { APP_ROUTES } from '@/core/navigation/routes';
import { WorkAuthorizationAppBoundary } from '@/features/admin/work-authorization/WorkAuthorizationAppBoundary';
import { PageLoadProgressProvider } from '@/components/PageProgressLoader';

const FinancialVisibilityAdminControl = lazy(() =>
  import('@/features/admin/components/FinancialVisibilityAdminControl').then((module) => ({
    default: module.FinancialVisibilityAdminControl,
  })),
);

const PrinterSettingsLauncher = lazy(() =>
  import('@/features/pos/components/settings/PrinterSettingsLauncher').then((module) => ({
    default: module.PrinterSettingsLauncher,
  })),
);

function RouteScopedExtras() {
  const { pathname } = useLocation();
  const onSuperAdmin = pathname === APP_ROUTES.superAdmin;
  const onSettings = pathname.startsWith(APP_ROUTES.settings);

  return (
    <>
      {onSuperAdmin && (
        <Suspense fallback={null}>
          <FinancialVisibilityAdminControl />
        </Suspense>
      )}
      {onSettings && (
        <Suspense fallback={null}>
          <PrinterSettingsLauncher />
        </Suspense>
      )}
    </>
  );
}

export default function App() {
  return (
    <AppProviders>
      <SessionProfileGuard>
        <WorkAuthorizationAppBoundary>
          <PageLoadProgressProvider>
            <>
              <AppRoutes />
              <RouteScopedExtras />
            </>
          </PageLoadProgressProvider>
        </WorkAuthorizationAppBoundary>
        <CloudPrintAgent />
      </SessionProfileGuard>
    </AppProviders>
  );
}
