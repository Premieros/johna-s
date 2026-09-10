import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Boxes } from 'lucide-react';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useBranches } from '@/hooks/useBranches';
import { formatNumber } from '@/lib/format';
import { DesignPanel } from '@/components/design';
import { Select } from '@/components/Input';

type RawStockRow = {
  id: string;
  raw_material_id: string;
  branch_id: string;
  quantity: number;
  avg_cost: number;
  min_stock: number;
  raw_material?: {
    name?: string | null;
    unit?: { name?: string | null; symbol?: string | null } | null;
  } | null;
};

export function RawMaterialBranchStockPanel() {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const fixedBranchId = useBranchFilter();
  const { branches } = useBranches();
  const [selectedBranchId, setSelectedBranchId] = useState(fixedBranchId || '');
  const [rows, setRows] = useState<RawStockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (fixedBranchId) setSelectedBranchId(fixedBranchId);
  }, [fixedBranchId]);

  useEffect(() => {
    let cancelled = false;
    if (!selectedBranchId) {
      setRows([]);
      setError('');
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    void supabase
      .from('raw_material_inventory')
      .select('id,raw_material_id,branch_id,quantity,avg_cost,min_stock,raw_material:raw_materials(name,unit:units(name,symbol))')
      .eq('branch_id', selectedBranchId)
      .order('updated_at', { ascending: false })
      .then(({ data, error: queryError }) => {
        if (cancelled) return;
        if (queryError) {
          setRows([]);
          setError(queryError.message);
        } else {
          setRows(((data || []) as unknown as RawStockRow[]).filter((row) => row.branch_id === selectedBranchId));
        }
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedBranchId]);

  const selectedBranchName = useMemo(
    () => branches.find((branch) => branch.id === selectedBranchId)?.name || '',
    [branches, selectedBranchId],
  );

  return (
    <DesignPanel
      title={isAr ? 'خامات الفرع المتاحة' : 'Available Branch Raw Materials'}
      testId="raw-material-branch-stock-panel"
    >
      <div className="space-y-4">
        {!fixedBranchId && (
          <div className="max-w-sm">
            <Select
              label={isAr ? 'الفرع' : 'Branch'}
              value={selectedBranchId}
              onChange={(event) => setSelectedBranchId(event.target.value)}
              data-testid="raw-stock-branch-select"
            >
              <option value="">{isAr ? 'اختر الفرع لعرض خاماته' : 'Select a branch to view raw stock'}</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </Select>
          </div>
        )}

        {!selectedBranchId ? (
          <div className="rounded-xl border border-ui-border bg-ui-page-alt p-4 text-sm text-ui-muted">
            {isAr ? 'اختر فرعًا أولًا. لا يتم استخدام أي فرع بديل تلقائيًا.' : 'Select a branch first. No fallback branch is used.'}
          </div>
        ) : loading ? (
          <div className="py-6 text-center text-sm text-ui-muted">{isAr ? 'جاري تحميل خامات الفرع...' : 'Loading branch raw materials...'}</div>
        ) : error ? (
          <div className="rounded-xl bg-ui-danger-soft p-4 text-sm text-ui-danger">{error}</div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-ui-border bg-ui-page-alt p-5 text-center">
            <Boxes className="mx-auto mb-2 h-6 w-6 text-ui-subtle" />
            <p className="font-semibold text-ui-text">{isAr ? 'لا توجد خامات مسجلة لهذا الفرع' : 'No raw-material balances for this branch'}</p>
            <p className="mt-1 text-xs text-ui-muted">{selectedBranchName || selectedBranchId}</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-ui-border">
            <table className="w-full text-sm">
              <thead className="bg-ui-page-alt text-ui-muted">
                <tr>
                  <th className="px-3 py-2 text-start">{isAr ? 'الخامة' : 'Raw Material'}</th>
                  <th className="px-3 py-2 text-start">{isAr ? 'الوحدة' : 'Unit'}</th>
                  <th className="px-3 py-2 text-end">{isAr ? 'المتاح' : 'Available'}</th>
                  <th className="px-3 py-2 text-end">{isAr ? 'الحد الأدنى' : 'Minimum'}</th>
                  <th className="px-3 py-2 text-start">{isAr ? 'الحالة' : 'Status'}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ui-border">
                {rows.map((row) => {
                  const quantity = Number(row.quantity || 0);
                  const minimum = Number(row.min_stock || 0);
                  const low = quantity <= minimum;
                  const unit = row.raw_material?.unit?.symbol || row.raw_material?.unit?.name || '-';
                  return (
                    <tr key={row.id} data-testid={`raw-stock-row-${row.raw_material_id}`}>
                      <td className="px-3 py-2 font-semibold text-ui-text">{row.raw_material?.name || '-'}</td>
                      <td className="px-3 py-2 text-ui-muted">{unit}</td>
                      <td className="px-3 py-2 text-end font-bold text-ui-text">{formatNumber(quantity)}</td>
                      <td className="px-3 py-2 text-end text-ui-muted">{formatNumber(minimum)}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${quantity <= 0 ? 'bg-ui-danger-soft text-ui-danger' : low ? 'bg-ui-warning-soft text-ui-warning' : 'bg-ui-success-soft text-ui-success'}`}>
                          {low && <AlertTriangle className="h-3.5 w-3.5" />}
                          {quantity <= 0 ? (isAr ? 'غير متوفر' : 'Out') : low ? (isAr ? 'منخفض' : 'Low') : (isAr ? 'متوفر' : 'Available')}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </DesignPanel>
  );
}
