import { useCallback, useEffect, useMemo, useState } from 'react';
import { Coffee, Printer, Receipt, RefreshCw, Save, TestTube2, UtensilsCrossed, WalletCards } from 'lucide-react';
import { catalog } from '@/api/domains/catalog';
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

interface PrinterSettingsPanelProps {
  branchId?: string;
  branchName?: string;
  isStandalonePage?: boolean;
}

interface BranchPrintStation {
  id: string;
  code: string;
  name_ar: string;
  name_en?: string | null;
  is_active?: boolean;
  sort_order?: number;
}

interface StationOption {
  code: string;
  labelAr: string;
  labelEn: string;
  icon: typeof Receipt;
  mirrorLegacyAliases?: boolean;
}

const STATION_ROUTE_ALIASES: Record<string, string[]> = {
  cashier: ['cashier', 'receipt'],
  main: ['main', 'kitchen', 'grill', 'salad', 'dessert', 'fryer'],
  drinks: ['drinks', 'barista', 'bar'],
};

const CASHIER_STATION: StationOption = {
  code: 'cashier',
  labelAr: 'الكاشير / إيصال العميل',
  labelEn: 'Cashier / Receipt',
  icon: Receipt,
  mirrorLegacyAliases: true,
};

const LEGACY_FALLBACK_STATIONS: StationOption[] = [
  {
    code: 'main',
    labelAr: 'المطبخ الرئيسي',
    labelEn: 'Main Kitchen',
    icon: UtensilsCrossed,
    mirrorLegacyAliases: true,
  },
  {
    code: 'drinks',
    labelAr: 'البار / الباريستا',
    labelEn: 'Bar / Barista',
    icon: Coffee,
    mirrorLegacyAliases: true,
  },
];

function iconForStation(code: string): typeof Receipt {
  const normalized = code.toLowerCase();
  return normalized.includes('drink') || normalized.includes('bar') || normalized.includes('coffee')
    ? Coffee
    : UtensilsCrossed;
}

export function PrinterSettingsPanel({ branchId, branchName }: PrinterSettingsPanelProps) {
  const can = useCan();
  const canManagePrinters = can('settings.manage');
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const { show } = useToast();

  const [printers, setPrinters] = useState<DetectedPrinter[]>([]);
  const [routes, setRoutes] = useState<PrinterRouteConfig>({});
  const [branchStations, setBranchStations] = useState<BranchPrintStation[]>([]);
  const [stationLoadFailed, setStationLoadFailed] = useState(false);
  const [silentPrint, setSilentPrint] = useState(true);
  const [autoDrawer, setAutoDrawer] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [testingStation, setTestingStation] = useState<string | null>(null);
  const [testingDrawer, setTestingDrawer] = useState(false);

  const stationOptions = useMemo<StationOption[]>(() => {
    if (!branchId || stationLoadFailed) return [CASHIER_STATION, ...LEGACY_FALLBACK_STATIONS];

    const dynamicStations = branchStations
      .filter((station) => station.is_active !== false && station.code.trim())
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      .filter((station) => station.code.toLowerCase() !== 'cashier')
      .map<StationOption>((station) => ({
        code: station.code,
        labelAr: station.name_ar || station.code,
        labelEn: station.name_en || station.name_ar || station.code,
        icon: iconForStation(station.code),
      }));

    return [CASHIER_STATION, ...dynamicStations];
  }, [branchId, branchStations, stationLoadFailed]);

  const loadBranchStations = useCallback(async () => {
    if (!branchId) {
      setBranchStations([]);
      setStationLoadFailed(false);
      return;
    }

    try {
      const { data, error } = await catalog.getKitchenStationAssignments(branchId);
      if (error) throw error;
      const response = data as { success?: boolean; error?: string; stations?: BranchPrintStation[] } | null;
      if (!response?.success) throw new Error(response?.error || 'STATIONS_LOAD_FAILED');
      setBranchStations(response.stations || []);
      setStationLoadFailed(false);
    } catch {
      // Preserve the proven legacy routes when the branch contract is temporarily unavailable.
      setBranchStations([]);
      setStationLoadFailed(true);
    }
  }, [branchId]);

  const load = useCallback(async () => {
    if (!canManagePrinters) return;
    setLoading(true);
    try {
      setRoutes(getLocalPrinterRoutes());
      setSilentPrint(isSilentPrintEnabled());
      setAutoDrawer(isAutoDrawerKickEnabled());
      const [detectedPrinters] = await Promise.all([
        getAvailablePrinters(),
        loadBranchStations(),
      ]);
      setPrinters(detectedPrinters);
    } finally {
      setLoading(false);
    }
  }, [canManagePrinters, loadBranchStations]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!canManagePrinters) return null;

  const refresh = async () => {
    setRefreshing(true);
    try {
      const [next] = await Promise.all([
        getAvailablePrinters(),
        loadBranchStations(),
      ]);
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
    setSilentPrintEnabled(silentPrint);
    setAutoDrawerKick(autoDrawer);
    saveLocalPrinterRoutes(routes);
    const agentSynced = await applyLocalPrinterRoutes(routes);
    show(
      agentSynced
        ? (isAr ? 'تم حفظ مسارات الطابعات وتفعيلها على هذا الجهاز' : 'Printer routes saved and activated on this device')
        : (isAr ? 'تم الحفظ محلياً، لكن Local Print Agent غير متصل حالياً' : 'Saved locally, but the Local Print Agent is not currently connected'),
      agentSynced ? 'success' : 'warning',
    );
  };

  const setRoute = (station: StationOption, printerName: string) => {
    setRoutes((previous) => {
      const next = { ...previous };
      const routeCodes = station.mirrorLegacyAliases
        ? (STATION_ROUTE_ALIASES[station.code] || [station.code])
        : [station.code];
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
          : (isAr ? 'فشل اختبار الطباعة. تحقق من اتصال الطابعة أو Local Print Agent.' : 'Test print failed. Check the printer or Local Print Agent.'),
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
                ? 'الإعدادات محلية لهذا الجهاز فقط، ومسارات المطبخ تُحمّل من محطات الفرع الحالية. لا تظهر إلا لمن يملك settings.manage.'
                : 'These settings are local to this device. Kitchen routes are loaded from the current branch stations and are visible only with settings.manage.'}
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
            {isRunningInElectron() ? (isAr ? 'Electron Desktop متصل' : 'Electron Desktop connected') : (isAr ? 'Browser / Local Agent' : 'Browser / Local Agent')}
          </span>
          <span className="rounded-full border border-ui-border bg-ui-page px-2.5 py-1 text-ui-muted">
            {isAr ? `${printers.length} طابعة مكتشفة` : `${printers.length} printers detected`}
          </span>
          {branchName ? (
            <span className="rounded-full border border-ui-border bg-ui-page px-2.5 py-1 text-ui-muted">
              {isAr ? `الفرع: ${branchName}` : `Branch: ${branchName}`}
            </span>
          ) : null}
          {stationLoadFailed ? (
            <span className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-amber-700">
              {isAr ? 'تم استخدام مسارات الطباعة القديمة مؤقتًا' : 'Using legacy printer routes temporarily'}
            </span>
          ) : null}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-ui-border bg-ui-surface p-10 text-sm text-ui-muted">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span>{isAr ? 'جاري فحص الطابعات...' : 'Detecting printers...'}</span>
        </div>
      ) : (
        <div className="grid gap-3">
          {stationOptions.map((station) => {
            const Icon = station.icon;
            return (
              <div key={station.code} className="rounded-2xl border border-ui-border bg-ui-surface p-4">
                <div className="grid gap-3 lg:grid-cols-[minmax(180px,0.8fr)_minmax(260px,1.4fr)_auto] lg:items-end">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500/10 text-brand-600">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-ui-text">{isAr ? station.labelAr : station.labelEn}</p>
                      <p className="text-[11px] font-mono text-ui-subtle">{station.code}</p>
                    </div>
                  </div>

                  <Select value={routes[station.code] || ''} onChange={(event) => setRoute(station, event.target.value)}>
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
                    onClick={() => void testStation(station.code)}
                    disabled={!routes[station.code] || testingStation === station.code}
                  >
                    <TestTube2 className="h-4 w-4" />
                    <span>{isAr ? 'اختبار' : 'Test'}</span>
                  </Button>
                </div>
              </div>
            );
          })}
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
