import { useEffect, useRef, useState } from 'react';
import { catalog } from '@/api/domains/catalog';
import { Button } from '@/components/Button';
import { useToast } from '@/components/Toast';

type Area = { id: string; name: string; secondary: boolean };
type Settings = { success?: boolean; error?: string; station?: { secondary_name: string; enabled: boolean } | null; areas?: Area[] };

export function CashierAreaSettings({ branchId, isAr }: { branchId: string; isAr: boolean }) {
  const { show } = useToast();
  const [areas, setAreas] = useState<Area[]>([]);
  const [name, setName] = useState('');
  const [added, setAdded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const alive = useRef(true);
  const inFlight = useRef(false);
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    setLoading(true);
    void Promise.resolve(catalog.getCashierAreaSettings({ p_branch_id: branchId })).then(({ data, error: readError }) => {
      if (cancelled) return;
      const value = data as Settings | null;
      if (readError || !value?.success) {
        setError(readError?.message || value?.error || 'CASHIER_SETTINGS_UNAVAILABLE');
        return;
      }
      setAreas(value.areas || []);
      setAdded(!!value.station);
      setName(value.station?.secondary_name || (isAr ? 'الكاشير الثاني' : 'Second cashier'));
      setEnabled(value.station?.enabled || false);
    }).catch((e: unknown) => {
      if (!cancelled) setError(e instanceof Error ? e.message : 'CASHIER_SETTINGS_UNAVAILABLE');
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; alive.current = false; };
  }, [branchId, isAr]);

  const save = async () => {
    if (inFlight.current || loading || error || !name.trim() || (enabled && !ready)) return;
    inFlight.current = true; setSaving(true);
    try {
      const { data, error: writeError } = await catalog.saveCashierAreaSettings({
        p_branch_id: branchId, p_name: name.trim(), p_enabled: enabled,
        p_area_ids: areas.filter(a => a.secondary).map(a => a.id),
      });
      const result = data as Settings | null;
      if (writeError || !result?.success) throw new Error(writeError?.message || result?.error || 'SAVE_FAILED');
      if (alive.current) show(isAr ? 'تم حفظ توزيع مناطق الكاشير' : 'Cashier areas saved', 'success');
    } catch (e) {
      if (alive.current) show(e instanceof Error ? e.message : 'SAVE_FAILED', 'error');
    } finally {
      inFlight.current = false;
      if (alive.current) setSaving(false);
    }
  };
  return <section className="rounded-2xl border border-ui-border bg-ui-surface p-4 space-y-3" data-testid="cashier-area-settings">
    <h3 className="font-bold">{isAr ? 'محطات الكاشير حسب مناطق الطاولات' : 'Cashier stations by table area'}</h3>
    <p className="text-sm text-ui-subtle">{isAr
      ? 'كاشير أساسي + كاشير ثانٍ على نفس كمبيوتر سموحة. المناطق غير المحددة والطلبات بدون طاولة وتقرير Z تبقى على الكاشير الأساسي. المطبخ والبار لا يتغيران.'
      : 'Primary + second cashier on one Smouha computer. Unassigned areas, orders without a table and Z reports use the primary cashier. Kitchen and bar stay unchanged.'}</p>
    {loading ? <p>{isAr ? 'جارٍ التحميل…' : 'Loading…'}</p> : error ? <p role="alert">{error}</p> : !added
      ? <Button onClick={() => setAdded(true)}>{isAr ? 'إضافة محطة كاشير ثانية' : 'Add second cashier station'}</Button>
      : <>
        <label className="block text-sm">{isAr ? 'اسم المحطة الثانية (cashier_2)' : 'Second station name (cashier_2)'}
          <input className="block w-full rounded border border-ui-border bg-ui-page p-2" maxLength={70} value={name} onChange={e => setName(e.target.value)} disabled={saving} />
        </label>
        <fieldset disabled={saving} className="space-y-2">
          <legend className="text-sm font-bold">{isAr ? 'مناطق تطبع على الكاشير الثاني' : 'Areas for the second cashier'}</legend>
          {areas.map(area => <label key={area.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={area.secondary} onChange={e => setAreas(current => current.map(a => a.id === area.id ? { ...a, secondary: e.target.checked } : a))} />{area.name}
          </label>)}
        </fieldset>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} disabled={saving} />{isAr ? 'تفعيل توزيع الكاشير حسب المناطق' : 'Enable cashier area routing'}</label>
        {enabled && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={ready} onChange={e => setReady(e.target.checked)} disabled={saving} />{isAr ? 'ثبّتُّ V8.2 وضبطتُ طابعة cashier_2 وأوقفتُ برنامج الطباعة السابق على نفس الكمبيوتر' : 'V8.2 is installed, cashier_2 is mapped and the old print agent is stopped on this computer'}</label>}
        <Button onClick={() => void save()} disabled={saving || !name.trim() || (enabled && !ready)}>{isAr ? 'حفظ توزيع الكاشير' : 'Save cashier routing'}</Button>
      </>}
  </section>;
}
