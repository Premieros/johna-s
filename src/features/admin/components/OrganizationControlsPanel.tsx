import { useEffect, useState } from 'react';
import { supabase } from '@/api';
import { Button } from '@/components/Button';
import { ENFORCED_ORGANIZATION_MODULE_KEYS } from '@/lib/permissionFeatureKey';

const UNSUPPORTED_MODULE_REASONS: Record<string, { ar: string; en: string }> = {
  ai_assistant: { ar: 'المساعد الذكي لم يكتمل تنفيذه وربطه بالصلاحيات بعد.', en: 'AI assistant is not yet implemented with independent access enforcement.' },
  api_access: { ar: 'الربط الخارجي يحتاج بوابة API تتحقق من صلاحية المنظمة في كل طلب.', en: 'External APIs need a per-request organization authorization gateway.' },
  multi_branch: { ar: 'الفروع المتعددة تعتمد على صلاحيات الوصول والعمليات المشتركة، وتحتاج تدقيقًا قبل التعطيل.', en: 'Multi-branch access is shared with existing business workflows and needs a dedicated audit.' },
  units: { ar: 'وحدات القياس مرتبطة بالمخزون والمشتريات؛ لا توجد صلاحية مستقلة لتعطيلها حاليًا.', en: 'Measurement units are shared by inventory and purchasing without an independent feature gate.' },
  excel_import: { ar: 'الاستيراد يكتب مباشرة عبر خدمات البيانات؛ يلزم فصل الاستيراد في خدمة محمية.', en: 'Imports write via data services; a protected server-side import boundary is required.' },
  excel_export: { ar: 'التصدير يتم عبر المتصفح من البيانات المسموح قراءتها، وليس عبر خدمة تصدير محمية.', en: 'Exports run in the browser from readable data; no protected export-service boundary exists.' },
  customer_display: { ar: 'شاشة العميل ليست مرتبطة حتى الآن بحارس وصول مستقل.', en: 'Customer display does not yet have a separately enforceable access guard.' },
};

type Feature = { id: string; key: string; name: string; category: string; is_system: boolean };
type OrgSettings = {
  phone: string | null; address: string | null; logo_url: string | null; currency: string | null;
};
type Override = { feature_id: string; enabled: boolean };

export function OrganizationControlsPanel({
  organizationId, organizationName, isAr, onSaved,
}: {
  organizationId: string; organizationName: string; isAr: boolean; onSaved?: () => void;
}) {
  const [name, setName] = useState(organizationName);
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [logo, setLogo] = useState('');
  const [currency, setCurrency] = useState('');
  const [features, setFeatures] = useState<Feature[]>([]);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyFeature, setBusyFeature] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setName(organizationName);
    setPhone(''); setAddress(''); setLogo(''); setCurrency('');
    setOverrides({}); setFeatures([]); setError('');
    void Promise.all([
      supabase.from('organization_settings').select('phone,address,logo_url,currency')
        .eq('organization_id', organizationId).maybeSingle(),
      supabase.from('features').select('id,key,name,category,is_system')
        .eq('is_active', true).order('category').order('key'),
      supabase.from('organization_feature_overrides').select('feature_id,enabled')
        .eq('organization_id', organizationId),
    ]).then(([settings, registry, access]) => {
      if (!active) return;
      if (settings.error || registry.error || access.error) {
        setError(isAr ? 'تعذر تحميل إعدادات المنظمة والموديولات' : 'Failed to load organization controls');
      } else {
        const row = settings.data as OrgSettings | null;
        setPhone(row?.phone || ''); setAddress(row?.address || '');
        setLogo(row?.logo_url || ''); setCurrency(row?.currency || '');
        setFeatures((registry.data || []) as Feature[]);
        setOverrides(Object.fromEntries(((access.data || []) as Override[])
          .map((item) => [item.feature_id, item.enabled])));
      }
      setLoading(false);
    }).catch(() => {
      if (active) { setError(isAr ? 'تعذر الاتصال' : 'Connection error'); setLoading(false); }
    });
    return () => { active = false; };
  }, [organizationId, organizationName, isAr]);

  async function saveProfile() {
    if (saving || loading || !!error || !name.trim()) return;
    setSaving(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('super_admin_set_organization_profile', {
        p_organization_id: organizationId, p_name: name.trim(),
        p_phone: phone, p_address: address, p_logo_url: logo, p_currency: currency,
      });
      const result = data as { success?: boolean; error?: string } | null;
      if (rpcError || !result?.success) throw new Error(result?.error || rpcError?.message || 'SAVE_FAILED');
      setError('');
      onSaved?.();
    } catch {
      setError(isAr ? 'تعذر حفظ بيانات المنظمة' : 'Could not save organization profile');
    } finally {
      setSaving(false);
    }
  }

  async function setFeature(feature: Feature, state: 'default' | 'on' | 'off') {
    if (busyFeature || loading || !!error) return;
    setBusyFeature(feature.id);
    try {
      const { data, error: rpcError } = state === 'default'
        ? await supabase.rpc('super_admin_reset_organization_module', {
            p_organization_id: organizationId, p_feature_key: feature.key,
          })
        : await supabase.rpc('super_admin_set_organization_module', {
            p_organization_id: organizationId, p_feature_key: feature.key, p_enabled: state === 'on',
          });
      const result = data as { success?: boolean; error?: string } | null;
      if (rpcError || !result?.success) throw new Error(result?.error || rpcError?.message || 'SAVE_FAILED');
      setOverrides((old) => {
        const next = { ...old };
        if (state === 'default') delete next[feature.id];
        else next[feature.id] = state === 'on';
        return next;
      });
    } catch {
      setError(isAr ? 'تعذر تعديل الموديول. لم يُطبق التغيير.' : 'Could not update module. No change applied.');
    } finally {
      setBusyFeature(null);
    }
  }

  return (
    <section data-testid="super-admin-organization-controls" className="space-y-5 rounded-2xl border border-ui-border bg-ui-surface p-4 sm:p-6">
      <header>
        <h3 className="font-black text-lg text-ui-text">{isAr ? 'إدارة المنظمة' : 'Organization Management'}: {organizationName}</h3>
        <p className="text-xs text-ui-subtle mt-1">
          {isAr ? 'إعدادات وموديولات هذه المنظمة فقط. تبقى إعدادات كل فرع مستقلة داخل تبويب الفروع.' :
            'Settings and modules for this organization only. Branch operating settings remain separate.'}
        </p>
      </header>
      {error && <p role="alert" className="rounded-lg bg-ui-danger-soft px-3 py-2 text-sm text-ui-danger">{error}</p>}
      {loading ? <p className="text-sm text-ui-muted">{isAr ? 'جار التحميل...' : 'Loading...'}</p> : (
        <>
          <div className="space-y-3">
            <h4 className="font-bold text-ui-text">{isAr ? 'بيانات المنظمة' : 'Organization Profile'}</h4>
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                ['name',isAr?'اسم المنظمة':'Organization name',name,setName],
                ['phone',isAr?'هاتف المنظمة':'Organization phone',phone,setPhone],
                ['address',isAr?'العنوان':'Address',address,setAddress],
                ['currency',isAr?'العملة الافتراضية للمنظمة':'Organization currency',currency,setCurrency],
                ['logo',isAr?'رابط الشعار':'Logo URL',logo,setLogo],
              ] as const).map(([id,label,value,setValue]) => (
                <label key={id} className="space-y-1 text-sm font-semibold text-ui-text">
                  <span className="block">{label}</span>
                  <input value={value} onChange={(e) => setValue(e.target.value)}
                    className="w-full rounded-xl border border-ui-border bg-ui-page p-2 text-ui-text" />
                </label>
              ))}
            </div>
            <Button data-testid="save-organization-profile" disabled={saving || !!error || name.trim().length < 2}
              onClick={() => void saveProfile()}>{saving ? (isAr?'جار الحفظ...':'Saving...') : (isAr?'حفظ بيانات هذه المنظمة':'Save Organization Profile')}</Button>
          </div>
          <div className="space-y-3 border-t border-ui-border pt-4">
            <h4 className="font-bold text-ui-text">{isAr ? 'موديولات المنظمة' : 'Organization Modules'}</h4>
            <p className="text-xs text-ui-subtle">{isAr
              ? 'الافتراضي يحتفظ بالسلوك الحالي. تعطيل موديول يقيّد نقاط الوصول المرتبطة بحارس الموديولات؛ تكامل الحراسة في كل الشاشات والخدمات يحتاج تدقيقًا منفصلًا.'
              : 'Default retains existing behavior. Disabled modules are denied through the feature-access guard; full route and API coverage is subject to a separate audit.'}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {features.map((feature) => {
                const value = overrides[feature.id];
                const selected = value === undefined ? 'default' : value ? 'on' : 'off';
                const supported = ENFORCED_ORGANIZATION_MODULE_KEYS.has(feature.key);
                return (
                  <label key={feature.id} className="flex items-center justify-between gap-3 rounded-xl border border-ui-border p-3 text-sm">
                    <span className="min-w-0"><strong className="block text-ui-text">{feature.name}</strong><span className="text-xs text-ui-subtle">{feature.key}</span>
                      {!supported && <span className="block text-xs text-ui-warning">{UNSUPPORTED_MODULE_REASONS[feature.key]?.[isAr ? 'ar' : 'en']
                        ?? (isAr ? 'يتطلب هذا الموديول حارس وصول مستقل قبل إتاحة التحكم.' : 'This module needs an independent access guard before controls are enabled.')}</span>}
                    </span>
                    <select value={selected} disabled={!supported || !!busyFeature || !!error}
                      aria-label={feature.key}
                      onChange={(e) => void setFeature(feature,e.target.value as 'default'|'on'|'off')}
                      className="max-w-32 rounded-lg border border-ui-border bg-ui-page p-2 text-ui-text">
                      <option value="default">{isAr?'افتراضي':'Default'}</option>
                      <option value="on">{isAr?'مفعّل':'Enabled'}</option>
                      {!feature.is_system && <option value="off">{isAr?'معطّل':'Disabled'}</option>}
                    </select>
                  </label>
                );
              })}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
