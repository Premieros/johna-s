import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Boxes } from 'lucide-react';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useBranches } from '@/hooks/useBranches';
import { formatNumber } from '@/lib/format';
import { DesignPanel } from '@/components/design';
import { Select } from '@/components/Input';

type MeasurementUnit = {
  name?: string | null;
  symbol?: string | null;
  code?: string | null;
};

type RawMaterialCatalogRow = {
  id: string;
  branch_id: string;
  name: string;
  measurement_unit?: MeasurementUnit | null;
};

type RawBalanceRow = {
  id: string;
  raw_material_id: string;
  branch_id: string;
  quantity: number;
  avg_cost: number;
  min_stock: number;
};

type RawStockRow = {
  id: string;
  raw_material_id: string;
  branch_id: string;
  quantity: number;
  avg_cost: number;
  min_stock: number;
  raw_material: {
    name: string;
    measurement_unit?: MeasurementUnit | null;
  };
};

export function RawMaterialBranchStockPanel() {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const fixedBranchId = useBranchFilter();
  const { branches, loading: branchesLoading } = useBranches();
  const [selectedBranchId, setSelectedBranchId] = useState(fixedBranchId || '');
  const [rows, setRows] = useState<RawStockRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (fixedBranchId) setSelectedBranchId(fixedBranchId);
    else if (selectedBranchId && !branches.some((branch) => branch.id === selectedBranchId)) setSelectedBranchId('');
  }, [fixedBranchId, branches, selectedBranchId]);

  useEffect(() => {
    let cancelled = false;
    const accessibleBranchIds = selectedBranchId
      ? [selectedBranchId]
      : branches.map((branch) => branch.id);

    if (branchesLoading) return () => { cancelled = true; };
    if (accessibleBranchIds.length === 0) {
      setRows([]);
      setError('');
      setLoading(false);
      return () => { cancelled = true; };
    }

    setLoading(true);
    setError('');

    const load = async () => {
      const [materialsResult, balancesResult] = await Promise.all([
        supabase
          .from('raw_materials')
          .select('id,branch_id,name,measurement_unit:measurement_units!raw_materials_unit_id_fkey(name,symbol,code)')
          .eq('is_active', true)
          .in('branch_id', accessibleBranchIds)
          .order('name'),
        supabase
          .from('raw_material_inventory')
          .select('id,raw_material_id,branch_id,quantity,avg_cost,min_stock')
          .in('branch_id', accessibleBranchIds),
      ]);

      if (cancelled) return;
      if (materialsResult.error) {
        setRows([]);
        setError(materialsResult.error.message);
        setLoading(false);
        return;
      }
      if (balancesResult.error) {
        setRows([]);
        setError(balancesResult.error.message);
        setLoading(false);
        return;
      }

      const balances = (balancesResult.data || []) as RawBalanceRow[];
      const balanceByMaterial = new Map<string, RawBalanceRow>();
      for (const balance of balances) {
        const key = `${balance.branch_id}:${balance.raw_material_id}`;
        const existing = balanceByMaterial.get(key);
        if (!existing) {
          balanceByMaterial.set(key, { ...balance, quantity: Number(balance.quantity) || 0 });
        } else {
          balanceByMaterial.set(key, {
            ...existing,
            quantity: (Number(existing.quantity) || 0) + (Number(balance.quantity) || 0),
            min_stock: Math.max(Number(existing.min_stock) || 0, Number(balance.min_stock) || 0),
          });
        }
      }

      const materials = (materialsResult.data || []) as unknown as RawMaterialCatalogRow[];
      setRows(materials.map((material) => {
        const balance = balanceByMaterial.get(`${material.branch_id}:${material.id}`);
        return {
          id: balance?.id || `raw:${material.branch_id}:${material.id}`,
          raw_material_id: material.id,
          branch_id: material.branch_id,
          quantity: Number(balance?.quantity) || 0,
          avg_cost: Number(balance?.avg_cost) || 0,
          min_stock: Number(balance?.min_stock) || 0,
          raw_material: {
            name: material.name,
            measurement_unit: material.measurement_unit || null,
          },
        };
      }));
      setLoading(false);
    };

    void load();
    return () => { cancelled = true; };
  }, [branches, branchesLoading, selectedBranchId]);

  const selectedBranchName = useMemo(
    () => branches.find((branch) => branch.id === selectedBranchId)?.name || '',
    [branches, selectedBranchId],
  );
  const showBranchColumn = !selectedBranchId && branches.length > 1;

  return (
    <DesignPanel
      title={isAr ? 'خامات المخزون' : 'Raw Material Inventory'}
      testId="raw-material-branch-stock-panel"
    >
      <div className="space-y-4">
        {!fixedBranchId && branches.length > 1 && (
          <div className="max-w-sm">
            <Select
              label={isAr ? 'الفرع' : 'Branch'}
              value={selectedBranchId}
              onChange={(event) => setSelectedBranchId(event.target.value)}
              data-testid="raw-stock-branch-select"
            >
              <option value="">{isAr ? 'كل الفروع المسموح بها' : 'All accessible branches'}</option>
              {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
            </Select>
          </div>
        )}

        {branchesLoading || loading ? (
          <div className="py-6 text-center text-sm text-ui-muted">{isAr ? 'جاري تحميل الخامات...' : 'Loading raw materials...'}</div>
        ) : error ? (
          <div className="rounded-xl bg-ui-danger-soft p-4 text-sm text-ui-danger">{error}</div>
        ) : branches.length === 0 ? (
          <div className="rounded-xl border border-ui-border bg-ui-page-alt p-5 text-center">
            <Boxes className="mx-auto mb-2 h-6 w-6 text-ui-subtle" />
            <p className="font-semibold text-ui-text">{isAr ? 'لا توجد فروع متاحة لهذا المستخدم' : 'No accessible branches for this user'}</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-xl border border-ui-border bg-ui-page-alt p-5 text-center">
            <Boxes className="mx-auto mb-2 h-6 w-6 text-ui-subtle" />
            <p className="font-semibold text-ui-text">{isAr ? 'لا توجد خامات مسجلة ضمن النطاق المحدد' : 'No raw materials in the selected scope'}</p>
            {selectedBranchName && <p className="mt-1 text-xs text-ui-muted">{selectedBranchName}</p>}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-ui-border">
            <table className="w-full text-sm">
              <thead className="bg-ui-page-alt text-ui-muted">
                <tr>
                  <th className="px-3 py-2 text-start">{isAr ? 'الخامة' : 'Raw Material'}</th>
                  {showBranchColumn && <th className="px-3 py-2 text-start">{isAr ? 'الفرع' : 'Branch'}</th>}
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
                  const measurementUnit = row.raw_material.measurement_unit;
                  const unit = measurementUnit?.symbol || measurementUnit?.code || measurementUnit?.name || '-';
                  const branchName = branches.find((branch) => branch.id === row.branch_id)?.name || row.branch_id;
                  return (
                    <tr key={`${row.branch_id}:${row.raw_material_id}`} data-testid={`raw-stock-row-${row.raw_material_id}`}>
                      <td className="px-3 py-2 font-semibold text-ui-text">{row.raw_material.name || '-'}</td>
                      {showBranchColumn && <td className="px-3 py-2 text-ui-muted">{branchName}</td>}
                      <td className="px-3 py-2 text-ui-muted">{unit}</td>
                      <td className="px-3 py-2 text-end font-bold text-ui-text">{formatNumber(quantity)}</td>
                      <td className="px-3 py-2 text-end text-ui-muted">{formatNumber(minimum)}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${quantity <= 0 ? 'bg-ui-danger-soft text-ui-danger' : low ? 'bg-ui-warning-soft text-ui-warning' : 'bg-ui-success-soft text-ui-success'}`}>
                          {low && <AlertTriangle className="h-3.5 w-3.5" />}
                          {quantity <= 0 ? (isAr ? 'رصيد صفر' : 'Zero balance') : low ? (isAr ? 'منخفض' : 'Low') : (isAr ? 'متوفر' : 'Available')}
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
