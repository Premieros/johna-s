import { useCallback, useEffect, useState } from 'react';
import { Cloud, Coffee, Printer, Receipt, RefreshCw, Save, TestTube2, UtensilsCrossed, WalletCards } from 'lucide-react';
import { supabase } from '@/api';
import { Button } from '@/components/Button';
import { Select } from '@/components/Input';
import { useToast } from '@/components/Toast';
import { useLanguage } from '@/context/LanguageContext';
import { useCan } from '@/lib/permissions';
import {
  applyLocalPrinterRoutes,
  executeCashDrawerKick,
  executeSilentPrint,
  getAvailablePrinters,
  getLocalPrinterRoutes,
  isAutoDrawerKickEnabled,
  isRunningInElectron,
  isSilentPrintEnabled,
  saveLocalPrinterRoutes,
  setAutoDrawerKick,
  setSilentPrintEnabled,
  type DetectedPrinter,
  type PrinterRouteConfig,
} from '../../services/localPrintAgent';
import {
  getCloudPrintAgentBranchId,
  isCloudPrintAgentEnabled,
  saveCloudPrintAgentConfig,
} from '../../services/cloudPrint';

interface PrinterSettingsPanelProps {
  branchId?: string;
  branchName?: string;
  isStandalonePage?: boolean;
}

type BranchOption = { id: string; name: string };

const STATION_ROUTE_ALIASES: Record<string, string[]> = {
  cashier: ['cashier', 'receipt'],
  main: ['main', 'kitchen', 'grill', 'salad', 'dessert', 'fryer'],
  drinks: ['drinks', 'barista', 'bar'],
};

const STATIONS = [
  { code: 'cashier', labelAr: 'الكاشير / إيصال العميل', labelEn: 'Cashier / Receipt', icon: Receipt },
  { code: 'main', labelAr: 'المطبخ الرئيسي', labelEn: 'Main Kitchen', icon: UtensilsCrossed },
  { code: 'drinks', labelAr: 'البار / الباريستا', labelEn: 'Bar / Barista', icon: Coffee },
] as const;

export function PrinterSettingsPanel({ branchId, branchName }: PrinterSettingsPanelProps) {
  const can = useCan();
  const canManagePrinters = can('settings.manage');
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const { show } = useToast();

  const [printers, setPrinters] = useState<DetectedPrinter[]>([]);
  const [routes, setRoutes] = useState<PrinterRouteConfig>({});
  const [silentPrint, setSilentPrint] = useState(true);
  const [autoDrawer, setAutoDrawer] = useState(true);
  const [cloudAgentEnabled, setCloudAgentEnabled] = useState(false);
  const [cloudBranchId, setCloudBranchId] = useState('');
  const [branchOptions, setBranchOptions] = useState<BranchOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [testingStation, setTestingStation] = useState<string | null>(null);
  const [testingDrawer, setTestingDrawer] = useState(false);

  const load = useCallback(async () => {
    if (!canManagePrinters) return;
    setLoading(true);
    try {
      setRoutes(getLocalPrinterRoutes());
      setSilentPrint(isSilentPrintEnabled());
      setAutoDrawer(isAutoDrawerKickEnabled());
      setCloudAgentEnabled(isCloudPrintAgentEnabled());
      const configuredBranch = getCloudPrintAgentBranchId();
      setCloudBranchId(configuredBranch || branchId || '');
      setPrinters(await getAvailablePrinters());

      if (isRunningInElectron()) {
        const { data } = await supabase
          .from('branches')
          .select('id,name')
          .eq('is_active', true)
          .order('name');
        setBranchOptions((data || []) as BranchOption[]);
      } else {
        setBranchOptions([]);
      }
    } finally {
      setLoading(false);
    }
  }, [branchId, canManagePrinters]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canManagePrinters) return null;

  const refresh = async () => {
    setRefreshing(true);
    try {
      const next = await getAvailablePrinters();
      setPrinters(next);
      show(
        isAr ? `تم اكتشاف ${next.length} طابعة على هذا الجهاز` : `Detected ${next.length} printers on this device`,
        next.length > 0 ? 'success' : 'info',
      );
    } finally {
      setRefreshing(false);
    }
  };

  const save = async () => {
    if (cloudAgentEnabled && isRunningInElectron() && !cloudBranchId) {
      show(isAr ? 'اختر فرع Print Agent أولاً' : 'Choose the Print Agent branch first', 'error');
      return;
    }
    setSilentPrintEnabled(silentPrint);
    setAutoDrawerKick(autoDrawer);
    saveLocalPrinterRoutes(routes);
    saveCloudPrintAgentConfig({
      enabled: isRunningInElectron() && cloudAgentEnabled,
      branchId: cloudBranchId,
    });
    const agentSynced = await applyLocalPrinterRoutes(routes);
    show(
      agentSynced
        ? (isAr ? 'تم حفظ الطابعات وإعداد Print Agent لهذا الجهاز' : 'Printers and Print Agent settings saved for this device')
        : (isAr ? 'تم الحفظ محلياً، لكن Local Print Agent غير متصل حالياً' : 'Saved locally, but the Local Print Agent is not currently connected'),
      agentSynced ? 'success' : 'warning',
    );
  };

  const setRoute = (station: string, printerName: string) => {
    setRoutes((previous) => {
      const next = { ...previous };
      const routeCodes = STATION_ROUTE_ALIASES[station] || [station];
      for (const routeCode of routeCodes) {
        if (printerName) next[routeCode] = printerName;
        else delete next[routeCode];
      }
      return next;
    });
  };

  const testStation = async (station: string) => {
    const printerName = routes[station];
    if (!printerName) {
      show(isAr ? 'اختر طابعة لهذه المحطة أولاً' : 'Choose a printer for this station first', 'error');
      return;
    }
    setTestingStation(station);
    try {
      const ok = await executeSilentPrint({
        printerName,
        text: [
          '================================',
          'JOHNS POS - PRINTER TEST',
          `Station: ${station}`,
          `Printer: ${printerName}`,
          branchName ? `Branch: ${branchName}` : '',
          new Date().toLocaleString(isAr ? 'ar-EG' : 'en-US'),
          '================================',
          '',
          '',
        ].filter(Boolean).join('\r\n'),
      });
      show(
        ok
          ? (isAr ? `تم إرسال اختبار الطباعة إلى ${printerName}` : `Test print sent to ${printerName}`)
          : (isAr ? 'فشل اختبار الطباعة. تحقق من اتصال الطابعة أو Print Agent.' : 'Test print failed. Check the printer or Print Agent.'),
        ok ? 'success' : 'error',
      );
    } finally {
      setTestingStation(null);
    }
  };

  const testDrawer = async () => {
    setTestingDrawer(true);
    try {
      const ok = await executeCashDrawerKick(routes.cashier);
      show(
        ok
          ? (isAr ? 'تم إرسال نبضة فتح درج النقدية' : 'Cash drawer pulse sent')
          : (isAr ? 'تعذر فتح الدرج. تحقق من طابعة الكاشير وتوصيل الدرج.' : 'Could not open the drawer. Check cashier printer and drawer cable.'),
        ok ? 'success' : 'error',
      );
    } finally {
      setTestingDrawer(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-ui-border bg-ui-surface p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-ui-text">
              <Printer className="h-5 w-5 text-brand-600" />
              <h2 className="font-bold">{isAr ? 'إدارة طابعات هذا الجهاز' : 'Device Printer Routing'}</h2>
            </div>
            <p className="mt-1 text-xs text-ui-subtle">
              {isAr
                ? 'الإعدادات محلية لهذا الجهاز فقط ولا تظهر إلا لمن يملك settings.manage.'
                : 'These settings are local to this device and are visible only with settings.manage.'}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              <span>{isAr ? 'تحديث الطابعات' : 'Refresh Printers'}</span>
            </Button>
            <Button size="sm" onClick={() => void save()}>
              <Save className="h-4 w-4" />
              <span>{isAr ? 'حفظ' : 'Save'}</span>
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-ui-border bg-ui-page px-2.5 py-1 text-ui-muted">
            {isRunningInElectron() ? (isAr ? 'Premier Print Agent متصل' : 'Premier Print Agent connected') : (isAr ? 'Browser / Local Agent' : 'Browser / Local Agent')}
          </span>
          <span className="rounded-full border border-ui-border bg-ui-page px-2.5 py-1 text-ui-muted">
            {isAr ? `${printers.length} طابعة مكتشفة` : `${printers.length} printers detected`}
          </span>
        </div>
      </div>

      {isRunningInElectron() && (
        <div className="rounded-2xl border border-ui-border bg-ui-surface p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600">
              <Cloud className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-ui-text">{isAr ? 'الطباعة السحابية من الهاتف' : 'Cloud printing from phones'}</p>
              <p className="mt-1 text-xs text-ui-subtle">
                {isAr
                  ? 'اربط هذا الكمبيوتر بفرع واحد. الهاتف يمكنه إرسال الطباعة عبر الإنترنت حتى لو كان على شبكة مختلفة.'
                  : 'Bind this computer to one branch. Phones can send print jobs over the internet from a different network.'}
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-[auto_minmax(220px,1fr)] sm:items-center">
            <label className="flex items-center gap-2 text-sm font-bold text-ui-text">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={cloudAgentEnabled}
                onChange={(event) => setCloudAgentEnabled(event.target.checked)}
              />
              <span>{isAr ? 'تفعيل Cloud Print Agent' : 'Enable Cloud Print Agent'}</span>
            </label>
            <Select value={cloudBranchId} onChange={(event) => setCloudBranchId(event.target.value)} disabled={!cloudAgentEnabled}>
              <option value="">{isAr ? 'اختر فرع هذا الجهاز' : 'Choose this device branch'}</option>
              {branchOptions.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </Select>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-ui-border bg-ui-surface p-10 text-sm text-ui-muted">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span>{isAr ? 'جاري فحص الطابعات...' : 'Detecting printers...'}</span>
        </div>
      ) : (
        <div className="grid gap-3">
          {STATIONS.map(({ code, labelAr, labelEn, icon: Icon }) => (
            <div key={code} className="rounded-2xl border border-ui-border bg-ui-surface p-4">
              <div className="grid gap-3 lg:grid-cols-[minmax(180px,0.8fr)_minmax(260px,1.4fr)_auto] lg:items-end">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-ui-text">{isAr ? labelAr : labelEn}</p>
                    <p className="text-[11px] font-mono text-ui-subtle">{code}</p>
                  </div>
                </div>

                <Select value={routes[code] || ''} onChange={(event) => setRoute(code, event.target.value)}>
                  <option value="">{isAr ? 'بدون طابعة محددة' : 'No printer selected'}</option>
                  {printers.map((printer) => (
                    <option key={printer.name} value={printer.name}>
                      {printer.displayName || printer.name}{printer.isDefault ? (isAr ? ' — الافتراضية' : ' — default') : ''}
                    </option>
                  ))}
                </Select>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void testStation(code)}
                  disabled={!routes[code] || testingStation === code}
                >
                  <TestTube2 className="h-4 w-4" />
                  <span>{isAr ? 'اختبار' : 'Test'}</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-ui-border bg-ui-surface p-4">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={silentPrint}
            onChange={(event) => setSilentPrint(event.target.checked)}
          />
          <div>
            <p className="text-sm font-bold text-ui-text">{isAr ? 'الطباعة الصامتة' : 'Silent printing'}</p>
            <p className="text-xs text-ui-subtle">
              {isAr ? 'تستخدم Electron أو Local Print Agent عند توفرهما.' : 'Uses Electron or the Local Print Agent when available.'}
            </p>
          </div>
        </label>

        <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-ui-border bg-ui-surface p-4">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={autoDrawer}
            onChange={(event) => setAutoDrawer(event.target.checked)}
          />
          <div>
            <p className="flex items-center gap-2 text-sm font-bold text-ui-text">
              <WalletCards className="h-4 w-4" />
              {isAr ? 'فتح درج النقدية تلقائيًا' : 'Automatic cash drawer'}
            </p>
            <p className="text-xs text-ui-subtle">
              {isAr ? 'يستخدم طابعة الكاشير المحددة لإرسال نبضة الدرج.' : 'Uses the selected cashier printer for the drawer pulse.'}
            </p>
          </div>
        </label>
      </div>

      <div className="flex justify-end">
        <Button variant="outline" onClick={() => void testDrawer()} disabled={!routes.cashier || testingDrawer}>
          <WalletCards className="h-4 w-4" />
          <span>{isAr ? 'اختبار درج النقدية' : 'Test Cash Drawer'}</span>
        </Button>
      </div>
    </div>
  );
}
