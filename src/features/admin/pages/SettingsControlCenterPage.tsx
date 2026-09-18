import { useEffect, useState, useCallback } from 'react';
import {
  Palette,
  Languages,
  Store,
  Users,
  ShieldAlert,
  Sparkles,
  Save,
  Loader2,
  CalendarClock,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useTheme } from '@/context/ThemeContext';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { useToast } from '@/components/Toast';
import { Card } from '@/components/PageHeader';
import { Button } from '@/components/Button';
import { Input, Select, Textarea } from '@/components/Input';
import { logAudit } from '@/lib/audit';
import { findUiTheme, UI_THEMES } from '@/lib/themes';
import type { BranchSettings } from '@/lib/types';
import { APP_ROUTES } from '@/core/navigation/routes';

type SettingsTab = 'branch_profile' | 'business_day' | 'branch_staff' | 'appearance' | 'language';

interface UserRow {
  id: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
}

export function SettingsControlCenterPage() {
  const { user } = useAuth();
  const { t, lang, setLang } = useLanguage();
  const { theme, setTheme, setUiTheme } = useTheme();
  const { branchSettingsMap, saveBranchSettings } = useSettings();
  const { branches } = useBranches();
  const { show } = useToast();
  const isAr = lang === 'ar';

  const isSuperAdmin = user?.role === 'super_admin';

  const [active, setActive] = useState<SettingsTab>('branch_profile');
  const [saving, setSaving] = useState(false);

  const myBranchId = user?.branch_id || (branches[0]?.id ?? '');
  const [selectedBranchId, setSelectedBranchId] = useState<string>(myBranchId);
  const [branchForm, setBranchForm] = useState<Partial<BranchSettings>>({});

  const [branchStaff, setBranchStaff] = useState<UserRow[]>([]);
  const [loadingStaff, setLoadingStaff] = useState(false);

  const targetBranchId = selectedBranchId || myBranchId;
  useEffect(() => {
    if (targetBranchId) {
      const row = branchSettingsMap[targetBranchId] || null;
      setBranchForm({
        branch_id: targetBranchId,
        receipt_header: row?.receipt_header ?? '',
        receipt_footer: row?.receipt_footer ?? '',
        logo_url: row?.logo_url ?? '',
        tax_rate: row?.tax_rate ?? null,
        tax_enabled: row?.tax_enabled ?? null,
        currency: row?.currency ?? '',
        low_stock_threshold: row?.low_stock_threshold ?? null,
        business_day_mode: row?.business_day_mode ?? 'fixed_time',
        business_day_start: row?.business_day_start ?? '00:00',
        business_day_end: row?.business_day_end ?? '00:00',
        auto_close_shift_at_day_end: row?.auto_close_shift_at_day_end ?? false,
      });
    }
  }, [targetBranchId, branchSettingsMap]);

  const loadBranchStaff = useCallback(async () => {
    if (!targetBranchId) return;
    setLoadingStaff(true);
    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, email, role, is_active')
      .eq('branch_id', targetBranchId)
      .order('full_name');
    setLoadingStaff(false);
    if (!error && data) {
      setBranchStaff(data as UserRow[]);
    }
  }, [targetBranchId]);

  useEffect(() => {
    if (active === 'branch_staff') void loadBranchStaff();
  }, [active, loadBranchStaff]);

  const pickTheme = (key: string) => {
    const p = findUiTheme(key);
    if (!p) return;
    setUiTheme(key);
    setTheme(p.mode);
  };

  const saveBranchSpecific = async () => {
    if (!targetBranchId) return;
    setSaving(true);
    const patch: Partial<BranchSettings> = {
      receipt_header: branchForm.receipt_header || null,
      receipt_footer: branchForm.receipt_footer || null,
      logo_url: branchForm.logo_url || null,
      tax_rate: branchForm.tax_rate != null && !Number.isNaN(branchForm.tax_rate) ? branchForm.tax_rate : null,
      tax_enabled: branchForm.tax_enabled ?? null,
      currency: branchForm.currency || null,
      low_stock_threshold:
        branchForm.low_stock_threshold != null && !Number.isNaN(branchForm.low_stock_threshold)
          ? branchForm.low_stock_threshold
          : null,
      business_day_mode: branchForm.business_day_mode || 'fixed_time',
      business_day_start: branchForm.business_day_start || '00:00',
      business_day_end: branchForm.business_day_end || '00:00',
      auto_close_shift_at_day_end: branchForm.auto_close_shift_at_day_end ?? false,
    };
    const ok = await saveBranchSettings(targetBranchId, patch);
    if (ok) {
      await logAudit('update', 'branch_settings', targetBranchId);
      show(isAr ? 'تم حفظ إعدادات الفرع بنجاح' : 'Branch settings saved successfully', 'success');
    } else {
      show(isAr ? 'فشل حفظ إعدادات الفرع' : 'Failed to save branch settings', 'error');
    }
    setSaving(false);
  };

  const SECTIONS: { key: SettingsTab; label: string; icon: React.ReactNode }[] = [
    { key: 'branch_profile', label: isAr ? 'بيانات الفرع والطباعة' : 'Branch Profile & Receipts', icon: <Store className="w-4 h-4" /> },
    { key: 'business_day', label: isAr ? 'اليوم المالي والشفتات' : 'Business Day & Shifts', icon: <CalendarClock className="w-4 h-4" /> },
    { key: 'branch_staff', label: isAr ? 'طاقم عمل الفرع' : 'Branch Staff', icon: <Users className="w-4 h-4" /> },
    { key: 'appearance', label: isAr ? 'المظهر والثيم' : 'Appearance & Theme', icon: <Palette className="w-4 h-4" /> },
    { key: 'language', label: isAr ? 'اللغة والتوطين' : 'Language', icon: <Languages className="w-4 h-4" /> },
  ];

  return (
    <div className="space-y-6">
      {isSuperAdmin && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-gradient-to-r from-brand-600/15 via-indigo-600/10 to-transparent border border-brand-500/30">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <p className="font-bold text-sm text-ui-text">
                {isAr ? 'أنت مسجل بصلاحية المدير العام (Super Admin)' : 'You are logged in as Super Admin'}
              </p>
              <p className="text-xs text-ui-subtle">
                {isAr
                  ? 'لإدارة إعدادات المنشأة المركزية، المنظمات، والصلاحيات الكاملة، تفضل بزيارة لوحة المدير العام'
                  : 'Manage master enterprise settings, tenant organizations, and the full RBAC matrix in the Super Admin hub'}
              </p>
            </div>
          </div>
          <Link to={APP_ROUTES.superAdmin}>
            <Button size="sm" className="whitespace-nowrap">
              <Sparkles className="w-4 h-4" />
              <span>{isAr ? 'لوحة تحكم المدير العام' : 'Super Admin Hub'}</span>
            </Button>
          </Link>
        </div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-ui-border pb-4">
        <div>
          <h1 className="text-2xl font-black text-ui-text tracking-tight">{t('settings')}</h1>
          <p className="text-xs text-ui-subtle mt-0.5">
            {isAr ? 'إدارة وتخصيص إعدادات الفرع، الإيصالات، والمظهر' : 'Manage branch configurations, receipts, and appearance'}
          </p>
        </div>

        {branches.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-ui-subtle">{isAr ? 'الفرع:' : 'Branch:'}</span>
            <div className="w-52">
              <Select
                value={selectedBranchId}
                onChange={(e) => setSelectedBranchId(e.target.value)}
              >
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {isAr ? b.name : b.name_en || b.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="space-y-1 md:col-span-1">
          {SECTIONS.map((sec) => (
            <button
              key={sec.key}
              onClick={() => setActive(sec.key)}
              className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-semibold transition text-start ${
                active === sec.key
                  ? 'bg-brand-600 text-white shadow-sm shadow-brand-500/20'
                  : 'bg-ui-surface hover:bg-ui-page-alt text-ui-muted hover:text-ui-text border border-ui-border/50'
              }`}
            >
              {sec.icon}
              <span>{sec.label}</span>
            </button>
          ))}
        </div>

        <div className="md:col-span-3 space-y-6">
          {active === 'branch_profile' && (
            <Card className="p-6 space-y-6">
              <div>
                <h2 className="text-lg font-bold text-ui-text">{isAr ? 'بيانات وطباعة إيصالات الفرع' : 'Branch Profile & Receipts'}</h2>
                <p className="text-xs text-ui-subtle">{isAr ? 'تخصيص الإيصالات والطباعة الحرارية الخاصة بهذا الفرع' : 'Customize receipt texts and thermal layout for this branch'}</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label={isAr ? 'شعار خاص بهذا الفرع (رابط صورة)' : 'Branch Logo Image URL'}
                  value={branchForm.logo_url || ''}
                  onChange={(e) => setBranchForm({ ...branchForm, logo_url: e.target.value })}
                  placeholder="https://..."
                />
                <Input
                  label={isAr ? 'نسبة الضريبة الخاصة بالفرع (%)' : 'Branch Tax Rate (%)'}
                  type="number"
                  step="0.1"
                  value={branchForm.tax_rate ?? ''}
                  onChange={(e) => setBranchForm({ ...branchForm, tax_rate: e.target.value ? Number(e.target.value) : null })}
                  placeholder={isAr ? 'اتركه فارغاً لاستخدام الافتراضي' : 'Leave empty to inherit'}
                />
                <div className="sm:col-span-2">
                  <Textarea
                    label={isAr ? 'ترويسة إيصال الفرع (Header)' : 'Branch Receipt Header'}
                    rows={2}
                    value={branchForm.receipt_header || ''}
                    onChange={(e) => setBranchForm({ ...branchForm, receipt_header: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Textarea
                    label={isAr ? 'تذييل إيصال الفرع (Footer)' : 'Branch Receipt Footer'}
                    rows={2}
                    value={branchForm.receipt_footer || ''}
                    onChange={(e) => setBranchForm({ ...branchForm, receipt_footer: e.target.value })}
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-ui-border flex justify-end">
                <Button onClick={saveBranchSpecific} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>{isAr ? 'حفظ إعدادات الفرع' : 'Save Branch Profile'}</span>
                </Button>
              </div>
            </Card>
          )}

          {active === 'business_day' && (
            <Card className="p-6 space-y-6">
              <div>
                <h2 className="text-lg font-bold text-ui-text">{isAr ? 'تعريف بداية ونهاية اليوم المالي' : 'Business Day Boundaries'}</h2>
                <p className="text-xs text-ui-subtle">
                  {isAr
                    ? 'اختر هل اليومية تعتمد على أوقات ثابتة، أم تبدأ من أول شفت في اليوم وتنتهي عند إغلاق آخر شفت.'
                    : 'Choose fixed business hours, or span the day from the first opened shift through the last closed shift.'}
                </p>
              </div>

              <div className="space-y-4">
                <Select
                  label={isAr ? 'طريقة تحديد اليوم المالي' : 'Business Day Mode'}
                  value={branchForm.business_day_mode || 'fixed_time'}
                  onChange={(e) => setBranchForm({
                    ...branchForm,
                    business_day_mode: e.target.value as BranchSettings['business_day_mode'],
                  })}
                >
                  <option value="fixed_time">{isAr ? 'وقت بداية ونهاية ثابت' : 'Fixed start / end time'}</option>
                  <option value="shift_span">{isAr ? 'من أول شفت مفتوح إلى آخر شفت مغلق' : 'First opened shift → last closed shift'}</option>
                </Select>

                {(branchForm.business_day_mode || 'fixed_time') === 'fixed_time' ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input
                      type="time"
                      label={isAr ? 'وقت بداية اليوم' : 'Day Start Time'}
                      value={branchForm.business_day_start || '00:00'}
                      onChange={(e) => setBranchForm({ ...branchForm, business_day_start: e.target.value })}
                    />
                    <Input
                      type="time"
                      label={isAr ? 'وقت نهاية اليوم' : 'Day End Time'}
                      value={branchForm.business_day_end || '00:00'}
                      onChange={(e) => setBranchForm({ ...branchForm, business_day_end: e.target.value })}
                    />
                  </div>
                ) : (
                  <div className="rounded-xl border border-ui-border bg-ui-page-alt p-4 text-sm text-ui-muted">
                    {isAr
                      ? 'في هذا الوضع: بداية اليومية = وقت فتح أول شفت بتاريخ العمل، ونهايتها = وقت إغلاق آخر شفت. لا يمكن إغلاق اليوم طالما يوجد شفت مفتوح.'
                      : 'In this mode, day start is the first shift open time and day end is the final shift close time. Day close remains blocked while any shift is open.'}
                  </div>
                )}

                <label className="flex items-start gap-3 rounded-xl border border-ui-border p-4">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    checked={Boolean(branchForm.auto_close_shift_at_day_end)}
                    onChange={(e) => setBranchForm({ ...branchForm, auto_close_shift_at_day_end: e.target.checked })}
                  />
                  <span>
                    <span className="block font-semibold text-ui-text">
                      {isAr ? 'إغلاق الشفت تلقائيًا عند نهاية اليوم المالي' : 'Auto-close shift at business-day end'}
                    </span>
                    <span className="mt-1 block text-sm text-ui-muted">
                      {isAr
                        ? 'يعمل فقط إذا لم توجد أي طلبات مفتوحة أو معلقة. إذا وُجدت طلبات، يبقى الشفت مفتوحًا حتى يغلقها المستخدم.'
                        : 'Runs only when no open or held orders remain. Otherwise the shift stays open until the user resolves all orders.'}
                    </span>
                  </span>
                </label>

                <div className="rounded-xl border border-ui-border p-4 text-sm">
                  <p className="font-semibold text-ui-text">
                    {isAr ? 'قاعدة الشفت المفتوح' : 'Open Shift Rule'}
                  </p>
                  <p className="mt-1 text-ui-muted">
                    {isAr
                      ? 'مسموح بشفت واحد مفتوح فقط لكل فرع. جميع مستخدمي نقطة البيع يعملون داخل نفس شفت الفرع، ويظهر كل مستخدم بتفاصيل عملياته في تقرير الإغلاق.'
                      : 'Only one open shift is allowed per branch. POS users share that branch shift, while closing reports keep per-user activity details.'}
                  </p>
                </div>
              </div>

              <div className="pt-4 border-t border-ui-border flex justify-end">
                <Button onClick={saveBranchSpecific} disabled={saving}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  <span>{isAr ? 'حفظ إعدادات اليوم المالي' : 'Save Business Day Settings'}</span>
                </Button>
              </div>
            </Card>
          )}

          {active === 'branch_staff' && (
            <Card className="p-6 space-y-4">
              <div>
                <h2 className="text-lg font-bold text-ui-text">{isAr ? 'طاقم عمل الفرع' : 'Branch Staff'}</h2>
                <p className="text-xs text-ui-subtle">{isAr ? 'الموظفون المعينون للعمل في هذا الفرع' : 'Team members assigned to this branch location'}</p>
              </div>

              {loadingStaff ? (
                <div className="flex justify-center p-8">
                  <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
                </div>
              ) : branchStaff.length === 0 ? (
                <p className="text-sm text-ui-subtle italic py-4">{isAr ? 'لا يوجد موظفون مسجلون على هذا الفرع حالياً' : 'No staff assigned'}</p>
              ) : (
                <div className="overflow-x-auto rounded-xl border border-ui-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-ui-border bg-ui-page-alt text-start">
                        <th className="p-3 font-semibold text-ui-subtle">{isAr ? 'الاسم' : 'Name'}</th>
                        <th className="p-3 font-semibold text-ui-subtle">{isAr ? 'البريد الإلكتروني' : 'Email'}</th>
                        <th className="p-3 font-semibold text-ui-subtle">{isAr ? 'الدور الوظيفي' : 'Role'}</th>
                        <th className="p-3 font-semibold text-ui-subtle">{isAr ? 'الحالة' : 'Status'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {branchStaff.map((s) => (
                        <tr key={s.id} className="border-b border-ui-border/50 hover:bg-ui-page-alt/50">
                          <td className="p-3 font-bold text-ui-text">{s.full_name || '-'}</td>
                          <td className="p-3 text-xs text-ui-subtle font-mono">{s.email}</td>
                          <td className="p-3">
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-brand-500/10 text-brand-600">
                              {s.role}
                            </span>
                          </td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded-full text-xs font-semibold ${
                                s.is_active ? 'bg-ui-success-soft text-ui-success' : 'bg-ui-danger-soft text-ui-danger'
                              }`}
                            >
                              {s.is_active ? (isAr ? 'نشط' : 'Active') : (isAr ? 'معطل' : 'Disabled')}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          )}

          {active === 'appearance' && (
            <Card className="p-6 space-y-6">
              <div>
                <h2 className="text-lg font-bold text-ui-text">{isAr ? 'المظهر وسمات الواجهة' : 'Appearance & Themes'}</h2>
                <p className="text-xs text-ui-subtle">{isAr ? 'اختر السمة واللون المفضل لواجهة الاستخدام' : 'Select your preferred visual style and theme mode'}</p>
              </div>

              <div>
                <p className="text-xs font-bold text-ui-text mb-2">{isAr ? 'وضع الإضاءة:' : 'Theme Mode:'}</p>
                <div className="flex gap-2">
                  <Button
                    variant={theme === 'light' ? 'primary' : 'outline'}
                    size="sm"
                    onClick={() => setTheme('light')}
                  >
                    {isAr ? 'الوضع النهاري (Light)' : 'Light'}
                  </Button>
                  <Button
                    variant={theme === 'dark' ? 'primary' : 'outline'}
                    size="sm"
                    onClick={() => setTheme('dark')}
                  >
                    {isAr ? 'الوضع الليلي (Dark)' : 'Dark'}
                  </Button>
                </div>
              </div>

              <div>
                <p className="text-xs font-bold text-ui-text mb-2">{isAr ? 'سمات الواجهة المصممة بعناية:' : 'Curated Themes:'}</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {UI_THEMES.map((th) => (
                    <button
                      key={th.key}
                      onClick={() => pickTheme(th.key)}
                      className="p-3 rounded-xl border border-ui-border bg-ui-page hover:border-brand-500/50 flex items-center justify-between text-start transition"
                    >
                      <span className="text-xs font-bold text-ui-text">{isAr ? th.ar : th.en}</span>
                      <span className="text-[10px] text-ui-subtle px-1.5 py-0.5 rounded bg-ui-surface">
                        {th.mode}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {active === 'language' && (
            <Card className="p-6 space-y-4">
              <div>
                <h2 className="text-lg font-bold text-ui-text">{isAr ? 'لغة واجهة الاستخدام' : 'Language & Localization'}</h2>
                <p className="text-xs text-ui-subtle">{isAr ? 'اختر اللغة المفضلة للنظام' : 'Select interface language'}</p>
              </div>

              <div className="flex gap-3 pt-2">
                <Button
                  variant={lang === 'ar' ? 'primary' : 'outline'}
                  onClick={() => setLang('ar')}
                  className="w-32"
                >
                  العربية
                </Button>
                <Button
                  variant={lang === 'en' ? 'primary' : 'outline'}
                  onClick={() => setLang('en')}
                  className="w-32"
                >
                  English
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}