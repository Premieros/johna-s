import { useState } from 'react';
import { Printer } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { Modal } from '@/components/Modal';
import { useLanguage } from '@/context/LanguageContext';
import { useCan } from '@/lib/permissions';
import { APP_ROUTES } from '@/core/navigation/routes';
import { PrinterSettingsPanel } from './PrinterSettingsPanel';

export function PrinterSettingsLauncher() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const { lang } = useLanguage();
  const can = useCan();
  const isAr = lang === 'ar';

  if (!pathname.startsWith(APP_ROUTES.settings) || !can('settings.manage')) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] end-4 z-[55] flex h-12 items-center gap-2 rounded-2xl border border-ui-border bg-ui-surface px-4 text-sm font-bold text-ui-text shadow-ui-lg transition hover:bg-ui-page-alt focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ui-ring"
        aria-label={isAr ? 'إدارة الطابعات' : 'Printer settings'}
      >
        <Printer className="h-5 w-5 text-brand-600" />
        <span className="hidden sm:inline">{isAr ? 'الطابعات' : 'Printers'}</span>
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={isAr ? 'إدارة طابعات الجهاز' : 'Device Printer Settings'}
        size="xl"
      >
        <PrinterSettingsPanel />
      </Modal>
    </>
  );
}
