import { useEffect, useState } from 'react';
import { supabase } from '@/api';
import { useCan } from '@/lib/permissions';
import { useToast } from '@/components/Toast';
import { Button } from '@/components/Button';

type OnlinePricingRow = {
  branch_id: string;
  enabled: boolean;
  markup_percent: number;
};

export function OnlinePricingSettings({
  branchId,
  isAr,
}: {
  branchId: string;
  isAr: boolean;
}) {
  const can = useCan();
  const { show } = useToast();
  const canEdit = can('settings.manage');
  const [enabled, setEnabled] = useState(false);
  const [percent, setPercent] = useState('26');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setEnabled(false);
    setPercent('26');
    if (!branchId) {
      setLoading(false);
      return;
    }
    void supabase.from('branch_online_pricing')
      .select('branch_id,enabled,markup_percent')
      .eq('branch_id', branchId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          show(isAr ? 'تعذر تحميل إعدادات الأونلاين' : 'Could not load online pricing', 'error');
        } else if (data) {
          const row = data as OnlinePricingRow;
          setEnabled(row.enabled);
          setPercent(String(row.markup_percent));
        }
        setLoading(false);
      });
    return () => { alive = false; };
  }, [branchId, isAr, show]);

  const value = Number(percent);
  const valid = Number.isFinite(value) && value >= 0 && value <= 100;

  const save = async () => {
    if (!branchId || !canEdit || !valid || saving) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('set_branch_online_pricing', {
        p_branch_id: branchId,
        p_enabled: enabled,
        p_markup_percent: value,
      });
      const result = data as { success?: boolean; error?: string } | null;
      if (error || !result?.success) throw new Error(error?.message || result?.error || 'SAVE_FAILED');
      show(isAr ? 'تم حفظ إعدادات أسعار الأونلاين لهذا الفرع' : 'Online pricing saved for this branch', 'success');
    } catch {
      show(isAr ? 'تعذر حفظ أسعار الأونلاين. تحقق من الصلاحية.' : 'Could not save online pricing. Check permissions.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-testid="branch-online-pricing" className="space-y-4">
      <div>
        <h2 className="text-lg font-bold text-ui-text">{isAr ? 'أسعار الأونلاين' : 'Online order pricing'}</h2>
        <p className="mt-1 text-xs text-ui-subtle">
          {isAr
            ? 'نسبة زيادة خاصة بهذا الفرع فوق سعر المنتج والإضافات، ثم تُطبق ضريبة الفرع الحالية. لا تتغير أسعار المنتجات الأساسية أو الطلبات السابقة.'
            : 'This branch-only markup applies to the product plus modifiers, before existing branch tax. Base prices and old orders stay unchanged.'}
        </p>
      </div>
      {loading ? <p className="text-sm text-ui-muted">{isAr ? 'جار التحميل...' : 'Loading...'}</p> : (
        <>
          <label className="flex items-center gap-3 text-sm font-semibold text-ui-text">
            <input data-testid="online-pricing-enabled" type="checkbox" checked={enabled}
              disabled={!canEdit} onChange={(event) => setEnabled(event.target.checked)} />
            {isAr ? 'تفعيل نوع طلب أونلاين لهذا الفرع' : 'Enable online orders for this branch'}
          </label>
          <label className="block space-y-1">
            <span className="block text-sm font-semibold text-ui-text">{isAr ? 'نسبة الزيادة (%)' : 'Price markup (%)'}</span>
            <input data-testid="online-pricing-percent" type="number" min="0" max="100" step="0.01"
              value={percent} disabled={!canEdit} onChange={(event) => setPercent(event.target.value)}
              className="w-full max-w-xs rounded-xl border border-ui-border bg-ui-surface-raised px-3 py-2 text-ui-text" />
          </label>
          {!valid && <p className="text-xs text-ui-danger">{isAr ? 'أدخل نسبة من 0 إلى 100' : 'Enter a percentage from 0 to 100'}</p>}
          <p className="text-xs text-ui-subtle">
            {isAr ? 'مثال: منتج 100 جنيه، نسبة 26% = 126 جنيه قبل الضريبة.' : 'Example: 100 + 26% = 126 before tax.'}
          </p>
          <Button data-testid="online-pricing-save" disabled={!canEdit || !valid || saving}
            onClick={() => void save()}>{saving ? (isAr ? 'جار الحفظ...' : 'Saving...') : (isAr ? 'حفظ إعدادات الأونلاين' : 'Save online pricing')}</Button>
          {!canEdit && <p className="text-xs text-ui-muted">{isAr ? 'تغيير النسبة يتطلب صلاحية إدارة الإعدادات.' : 'Changing pricing requires settings management permission.'}</p>}
        </>
      )}
    </div>
  );
}
