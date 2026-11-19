import { useCallback, useEffect, useState } from 'react';
import { EyeOff, Loader2, SlidersHorizontal } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { admin } from '@/api';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { useBranches } from '@/hooks/useBranches';
import { Modal } from '@/components/Modal';
import { useToast } from '@/components/Toast';
import { useCan } from '@/lib/permissions';
import { useLanguage } from '@/context/LanguageContext';
import { APP_ROUTES } from '@/core/navigation/routes';

export function FinancialVisibilityAdminControl() {
  const can = useCan();
  const { lang } = useLanguage();
  const { show } = useToast();
  const { branches } = useBranches();
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const location = useLocation();
  const ar = lang === 'ar';
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recentDays, setRecentDays] = useState(7);
  const [historicalPercent, setHistoricalPercent] = useState(30);

  const visible = can('settings.manage') && location.pathname === APP_ROUTES.superAdmin;

  const load = useCallback(async () => {
    if (!selectedBranchId) return;
    setLoading(true);
    try {
      const { data, error } = await admin.getBranchFinancialVisibilitySettings({ p_branch_id: selectedBranchId });
      if (error || !data?.success) throw new Error(data?.error || error?.message || 'LOAD_FAILED');
      setRecentDays(Number(data.recent_days ?? 7));
      setHistoricalPercent(Number(data.historical_percent ?? 30));
    } catch (err) {
      show(ar ? `تعذر تحميل سياسة عرض البيانات: ${String((err as Error).message || err)}` : `Failed to load visibility policy: ${String((err as Error).message || err)}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [ar, show, selectedBranchId]);

  useEffect(() => {
    if (!selectedBranchId || !branches.some((branch) => branch.id === selectedBranchId)) {
      setSelectedBranchId(branches[0]?.id || '');
    }
  }, [branches, selectedBranchId]);

  useEffect(() => {
    if (open && visible && selectedBranchId) void load();
  }, [open, visible, load]);

  if (!visible) return null;

  const save = async () => {
    if (!selectedBranchId || !branches.some((branch) => branch.id === selectedBranchId)) {
      show(ar ? 'اختر فرعًا مصرحًا به' : 'Select an authorized branch', 'error');
      return;
    }
    if (!Number.isInteger(recentDays) || recentDays < 1 || recentDays > 365) {
      show(ar ? 'عدد الأيام يجب أن يكون من 1 إلى 365' : 'Recent days must be between 1 and 365', 'error');
      return;
    }
    if (!Number.isInteger(historicalPercent) || historicalPercent < 0 || historicalPercent > 100) {
      show(ar ? 'النسبة التاريخية يجب أن تكون من 0 إلى 100' : 'Historical percentage must be between 0 and 100', 'error');
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await admin.updateBranchFinancialVisibilitySettings({
        p_branch_id: selectedBranchId,
        p_recent_days: recentDays,
        p_historical_percent: historicalPercent,
      });
      if (error || !data?.success) throw new Error(data?.error || error?.message || 'SAVE_FAILED');
      show(ar ? 'تم حفظ سياسة عرض البيانات للفرع المحدد فقط' : 'Visibility policy saved for the selected branch only', 'success');
      setOpen(false);
    } catch (err) {
      show(ar ? `فشل حفظ السياسة: ${String((err as Error).message || err)}` : `Failed to save policy: ${String((err as Error).message || err)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        data-testid="financial-visibility-admin-trigger"
        onClick={() => setOpen(true)}
        className="fixed bottom-5 end-5 z-[85] flex items-center gap-2 rounded-2xl border border-brand-500/30 bg-ui-surface px-4 py-3 text-sm font-black text-ui-text shadow-ui-lg transition hover:-translate-y-0.5 hover:bg-ui-page-alt"
        title={ar ? 'سياسة عرض البيانات المالية' : 'Financial visibility policy'}
      >
        <SlidersHorizontal className="h-4 w-4 text-brand-500" />
        <span>{ar ? 'سياسة عرض البيانات' : 'Visibility Policy'}</span>
      </button>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={ar ? 'إدارة سياسة عرض البيانات المالية' : 'Financial Visibility Policy'}
      >
        <div className="space-y-5" data-testid="financial-visibility-admin-panel">
          <div className="rounded-2xl border border-ui-border bg-ui-page-alt p-4">
            <div className="flex items-start gap-3">
              <EyeOff className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />
              <div className="text-xs leading-6 text-ui-muted">
                <p className="font-black text-ui-text">
                  {ar ? 'هذه السياسة تخص القراءة والعرض فقط.' : 'This policy changes read visibility only.'}
                </p>
                <p>
                  {ar
                    ? 'تُطبّق الإعدادات على الفرع المختار فقط. من يملك صلاحية عرض السجل التاريخي الكامل يرى كل تاريخ الفروع المصرح له بها؛ أما بقية المستخدمين فيخضعون لسياسة كل فرع.'
                    : 'Settings apply only to the selected branch. The single unlimited-history permission bypasses history sampling only for branches the user can access.'}
                </p>
              </div>
            </div>
          </div>

          <Select
            label={ar ? 'الفرع المطلوب تعديل سياسته' : 'Branch visibility policy'}
            value={selectedBranchId}
            onChange={(event) => setSelectedBranchId(event.target.value)}
            disabled={loading || saving || !selectedBranchId}
            data-testid="financial-visibility-branch"
          >
            <option value="">{ar ? 'اختر الفرع' : 'Select branch'}</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{ar ? branch.name : branch.name_en || branch.name}</option>)}
          </Select>

          {loading ? (
            <div className="flex min-h-28 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-brand-500" /></div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                data-testid="financial-visibility-recent-days"
                label={ar ? 'الأيام الأخيرة المعروضة بالكامل' : 'Recent days shown in full'}
                type="number"
                min={1}
                max={365}
                value={recentDays}
                onChange={(e) => setRecentDays(Number(e.target.value))}
              />
              <Input
                data-testid="financial-visibility-historical-percent"
                label={ar ? 'نسبة التاريخ الأقدم المعروضة (%)' : 'Older history visible (%)'}
                type="number"
                min={0}
                max={100}
                value={historicalPercent}
                onChange={(e) => setHistoricalPercent(Number(e.target.value))}
              />
            </div>
          )}

          <div className="rounded-xl border border-ui-border px-3 py-2 text-xs text-ui-subtle">
            {ar
              ? `الإعداد الحالي المقترح: آخر ${recentDays} يوم كاملة، ثم ${historicalPercent}% ثابتة من التاريخ الأقدم.`
              : `Current policy: last ${recentDays} days in full, then a stable ${historicalPercent}% of older history.`}
          </div>

          <div className="flex justify-end gap-2 border-t border-ui-border pt-4">
            <Button variant="outline" onClick={() => setOpen(false)}>{ar ? 'إلغاء' : 'Cancel'}</Button>
            <Button onClick={() => void save()} disabled={loading || saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {ar ? 'حفظ سياسة هذا الفرع' : 'Save Branch Policy'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
