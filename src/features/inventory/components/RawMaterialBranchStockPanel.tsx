import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Boxes } from 'lucide-react';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useBranches } from '@/hooks/useBranches';
import { formatRawMaterialQuantity } from '@/lib/format';
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
  min_stock?: number | null;
  measurement_unit?: MeasurementUnit | null;
};

type RawBalanceRow = {
  raw_material_id: string;
  branch_id: string;
  warehouse_id: string;
  quantity: number;
  avg_cost: number;
};

type RawStockRow = {
  id: string;
  raw_material_id: string;
  branch_id: string;
  quantity: number;
  avg_cost: number;
  min_stock: number;
  warehouse_id: string;
  warehouse_name: string;
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
  const [warehouses, setWarehouses] = useState<{ id: string; branch_id: string; name: string }[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
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
      const [materialsResult, warehousesResult, balancesResult] = await Promise.all([
        supabase
          .from('raw_materials')
          .select('id,branch_id,name,min_stock,measurement_unit:measurement_units!raw_materials_unit_id_fkey(name,symbol,code)')
          .eq('is_active', true)
          .in('branch_id', accessibleBranchIds)
          .order('name'),
        supabase
          .from('warehouses')
          .select('id,branch_id,name')
          .eq('is_active', true)
          .in('branch_id', accessibleBranchIds)
          .order('name'),
        supabase
          .from('raw_material_warehouse_inventory')
          .select('raw_material_id,branch_id,warehouse_id,quantity,avg_cost')
          .in('branch_id', accessibleBranchIds),
      ]);

      if (cancelled) return;
      const firstError = materialsResult.error || warehousesResult.error || balancesResult.error;
      if (firstError) {
        setRows([]);
        setWarehouses([]);
        setError(firstError.message);
        setLoading(false);
        return;
      }

      const balances = (balancesResult.data || []) as RawBalanceRow[];
      const balanceByMaterialWarehouse = new Map<string, RawBalanceRow>();
      for (const balance of balances) {
        balanceByMaterialWarehouse.set(
          `${balance.branch_id}:${balance.warehouse_id}:${balance.raw_material_id}`,
          balance,
        );
      }

      const materials = (materialsResult.data || []) as unknown as RawMaterialCatalogRow[];
      const loadedWarehouses = (warehousesResult.data || []) as { id: string; branch_id: string; name: string }[];
      setWarehouses(loadedWarehouses);

      const nextRows: RawStockRow[] = [];
      for (const material of materials) {
        for (const warehouse of loadedWarehouses.filter((row) => row.branch_id === material.branch_id)) {
          const balance = balanceByMaterialWarehouse.get(
            `${material.branch_id}:${warehouse.id}:${material.id}`,
          );
          nextRows.push({
            id: `raw:${material.branch_id}:${warehouse.id}:${material.id}`,
            raw_material_id: material.id,
            branch_id: material.branch_id,
            warehouse_id: warehouse.id,
            warehouse_name: warehouse.name,
            quantity: Number(balance?.quantity) || 0,
            avg_cost: Number(balance?.avg_cost) || 0,
            min_stock: Number(material.min_stock) || 0,
            raw_material: {
              name: material.name,
              measurement_unit: material.measurement_unit || null,
            },
          });
        }
      }
      setRows(nextRows);
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
          <>
          <p className="text-xs text-ui-muted">{isAr ? 'هذه الشاشة تعرض الكمية التشغيلية فقط. قيمة المخزون وتكلفة الخامات تعرض من تقييم FIFO المعتمد في التقارير المالية حتى لا يظهر رقمان مختلفان لنفس الرصيد.' : 'This screen shows operational quantity only. Inventory value and raw-material cost come from the authoritative FIFO valuation in financial reports so users do not see two values for the same stock.'}</p>
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
                      <td className="px-3 py-2 font-semibold text-ui-text"><div>{row.raw_material.name || '-'}</div><div className="text-xs font-normal text-ui-subtle">{unit}</div></td>
                      {showBranchColumn && <td className="px-3 py-2 text-ui-muted">{branchName}</td>}
                      <td className="px-3 py-2 text-ui-muted">{unit}</td>
                      <td className="px-3 py-2 text-end font-bold text-ui-text">{formatRawMaterialQuantity(quantity, measurementUnit, { lang })}</td>
                      <td className="px-3 py-2 text-end text-ui-muted">{formatRawMaterialQuantity(minimum, measurementUnit, { lang })}</td>
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
          </>
        )}
      </div>
    </DesignPanel>
  );
}
