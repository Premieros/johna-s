import { useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { supabase } from '@/api';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import { useLanguage } from '@/context/LanguageContext';
import { calculateCostBreakdown, costingBreakdownMatches } from '@/lib/costBreakdown';
import { formatCurrency, formatDateTime, formatExactQuantity, formatRawMaterialQuantity, type MeasurementUnitDisplay } from '@/lib/format';

type SourceKind = 'product' | 'raw_material';

type SourceRow = {
  id: string;
  batch_number: string | null;
  quantity: number;
  unit_cost: number;
  source_type: string | null;
  source_id: string | null;
  created_at: string;
};

interface Props {
  kind: SourceKind;
  itemId: string;
  itemName: string;
  lineQuantity: number;
  usedUnitCost: number;
  lineCost: number;
  branchId: string | null;
  unit?: MeasurementUnitDisplay;
}

export function CostBreakdownButton({ kind, itemId, itemName, lineQuantity, usedUnitCost, lineCost, branchId, unit }: Props) {
  const { lang } = useLanguage();
  const isAr = lang === 'ar';
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<SourceRow[]>([]);

  const totals = useMemo(() => calculateCostBreakdown(rows), [rows]);
  const reconciles = totals.totalQuantity > 0 && costingBreakdownMatches(usedUnitCost, totals.weightedAverage);
  const money = (value: number) => formatCurrency(Number(value || 0), 'EGP', lang);
  const quantity = (value: number) => kind === 'raw_material'
    ? formatRawMaterialQuantity(value, unit, { lang })
    : formatExactQuantity(value);

  const load = async () => {
    setOpen(true);
    setLoading(true);
    setError(null);
    setRows([]);

    const table = kind === 'raw_material' ? 'raw_material_batches' : 'inventory_batches';
    const itemColumn = kind === 'raw_material' ? 'raw_material_id' : 'product_id';
    let query = supabase
      .from(table)
      .select('id, batch_number, quantity, unit_cost, source_type, source_id, created_at')
      .eq(itemColumn, itemId)
      .order('created_at', { ascending: true });
    if (branchId) query = query.eq('branch_id', branchId);

    const result = await query;
    setLoading(false);
    if (result.error) {
      setError(result.error.message);
      return;
    }
    setRows(((result.data || []) as SourceRow[]).filter((row) => Number(row.quantity) > 0));
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={(event) => { event.stopPropagation(); void load(); }}>
        <Info className="w-3.5 h-3.5" /> {isAr ? 'توضيح' : 'Explain'}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title={`${isAr ? 'توضيح التكلفة' : 'Cost explanation'} — ${itemName}`} size="2xl">
        <div className="space-y-4" data-testid={`cost-breakdown-${kind}-${itemId}`}>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-2">
            <div className="rounded-ui-lg border border-ui-border bg-ui-page p-3">
              <p className="text-xs text-ui-subtle">{isAr ? 'كمية المكوّن' : 'Component quantity'}</p>
              <p className="font-bold text-ui-text">{quantity(lineQuantity)}</p>
            </div>
            <div className="rounded-ui-lg border border-ui-border bg-ui-page p-3">
              <p className="text-xs text-ui-subtle">{isAr ? 'السعر المستخدم' : 'Used unit cost'}</p>
              <p className="font-bold text-ui-text">{money(usedUnitCost)}</p>
            </div>
            <div className="rounded-ui-lg border border-ui-border bg-ui-page p-3">
              <p className="text-xs text-ui-subtle">{isAr ? 'تكلفة السطر' : 'Line cost'}</p>
              <p className="font-bold text-ui-text">{money(lineCost)}</p>
            </div>
            <div className="rounded-ui-lg border border-ui-border bg-ui-page p-3">
              <p className="text-xs text-ui-subtle">{isAr ? 'كمية الدفعات المسجلة' : 'Recorded batch quantity'}</p>
              <p className="font-bold text-ui-text">{quantity(totals.totalQuantity)}</p>
            </div>
            <div className="rounded-ui-lg border border-ui-border bg-ui-page p-3">
              <p className="text-xs text-ui-subtle">{isAr ? 'متوسط الدفعات' : 'Batch weighted average'}</p>
              <p className="font-bold text-ui-text">{money(totals.weightedAverage)}</p>
            </div>
          </div>

          {loading && <p className="text-sm text-ui-subtle">{isAr ? 'جاري تحميل مصادر السعر...' : 'Loading price sources...'}</p>}
          {error && <div className="rounded-ui-lg border border-ui-danger/30 bg-ui-danger-soft p-3 text-sm text-ui-danger">{error}</div>}

          {!loading && !error && rows.length === 0 && (
            <div className="rounded-ui-lg border border-ui-border bg-ui-page p-3 text-sm text-ui-subtle">
              {isAr ? 'لا توجد دفعات سعر موجبة مسجلة لهذا الصنف في النطاق الحالي.' : 'No positive price batches are recorded for this item in the current scope.'}
            </div>
          )}

          {!loading && !error && rows.length > 0 && (
            <>
              <div className={`rounded-ui-lg border p-3 text-sm ${reconciles ? 'border-ui-success/30 bg-ui-success-soft text-ui-success' : 'border-ui-warning/30 bg-ui-warning-soft text-ui-warning'}`}>
                {reconciles
                  ? (isAr ? 'متوسط الأسعار والكميات المعروضة يطابق السعر المستخدم في مركز التكلفة.' : 'The displayed prices and quantities reconcile with the unit cost used by Costing Center.')
                  : (isAr ? 'متوسط الدفعات المعروضة لا يساوي السعر المستخدم حاليًا. قد يكون السعر متأثرًا برصيد افتتاحي أو تسوية أو دفعات تاريخية لم تعد ظاهرة؛ لذلك لا يتم اعتبار هذه الدفعات تفسيرًا نهائيًا للسعر.' : 'The displayed batch average does not equal the currently used cost. Opening balances, adjustments, or historical batches may also contribute, so these rows are not presented as a definitive reconstruction.')}
              </div>

              <div className="overflow-x-auto rounded-ui-lg border border-ui-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-ui-page-alt text-xs text-ui-subtle">
                      <th className="px-3 py-2 text-start">{isAr ? 'التاريخ' : 'Date'}</th>
                      <th className="px-3 py-2 text-start">{isAr ? 'الدفعة' : 'Batch'}</th>
                      <th className="px-3 py-2 text-start">{isAr ? 'المصدر' : 'Source'}</th>
                      <th className="px-3 py-2 text-start">{isAr ? 'الكمية بهذا السعر' : 'Quantity at price'}</th>
                      <th className="px-3 py-2 text-start">{isAr ? 'السعر' : 'Unit cost'}</th>
                      <th className="px-3 py-2 text-start">{isAr ? 'القيمة' : 'Contribution'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id} className="border-t border-ui-border">
                        <td className="px-3 py-2 whitespace-nowrap">{formatDateTime(row.created_at, lang)}</td>
                        <td className="px-3 py-2">{row.batch_number || '-'}</td>
                        <td className="px-3 py-2">{row.source_type || '-'}</td>
                        <td className="px-3 py-2 font-medium">{quantity(Number(row.quantity))}</td>
                        <td className="px-3 py-2">{money(Number(row.unit_cost))}</td>
                        <td className="px-3 py-2 font-medium">{money(Number(row.quantity) * Number(row.unit_cost))}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-ui-border bg-ui-page-alt font-semibold">
                      <td className="px-3 py-2" colSpan={3}>{isAr ? 'الإجمالي / المتوسط المرجح' : 'Total / weighted average'}</td>
                      <td className="px-3 py-2">{quantity(totals.totalQuantity)}</td>
                      <td className="px-3 py-2">{money(totals.weightedAverage)}</td>
                      <td className="px-3 py-2">{money(totals.totalValue)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="text-xs text-ui-subtle">
                {isAr ? 'التوضيح للقراءة فقط، ويعرض الدفعات المتاحة وفق صلاحيات المستخدم والفرع المختار، ولا يغيّر المخزون أو طريقة حساب التكلفة.' : 'This is a read-only explanation of batches visible to the user in the selected branch. It does not change stock or costing logic.'}
              </p>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
