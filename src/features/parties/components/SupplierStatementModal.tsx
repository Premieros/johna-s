import { useEffect, useState } from 'react';
import * as api from '@/api';
import { Modal } from '@/components/Modal';
import { formatCurrency, formatDateTime } from '@/lib/format';
import { useLanguage } from '@/context/LanguageContext';

type SupplierStatementSummary = {
  supplier_id: string;
  supplier_name: string;
  total_purchases: number;
  total_returns: number;
  total_paid: number;
  open_balance: number;
  recorded_cash_payments: number;
  recorded_card_payments: number;
  recorded_transfer_payments: number;
  recorded_other_payments: number;
  recorded_payments_total: number;
  invoice_time_paid: number;
};

type SupplierStatementEntry = {
  event_at: string;
  entry_type: 'purchase' | 'payment' | 'invoice_time_payment' | string;
  source_id: string;
  reference_number: string | null;
  debit: number;
  credit: number;
  payment_method: string | null;
  description: string | null;
  running_balance: number;
};

type SupplierStatementResult = {
  success?: boolean;
  error?: string;
  summary?: SupplierStatementSummary;
  entries?: SupplierStatementEntry[];
};

interface Props {
  open: boolean;
  supplierId: string | null;
  branchId: string | null;
  currency: string;
  onClose: () => void;
}

const paymentLabel = (method: string | null, ar: boolean) => {
  if (!method) return '-';
  const labels: Record<string, [string, string]> = {
    cash: ['كاش', 'Cash'],
    card: ['بطاقة', 'Card'],
    transfer: ['تحويل', 'Transfer'],
    bank_transfer: ['تحويل بنكي', 'Bank transfer'],
    invoice_time: ['عند إنشاء الفاتورة', 'At invoice creation'],
  };
  const label = labels[method];
  return label ? label[ar ? 0 : 1] : method;
};

const entryLabel = (entryType: string, ar: boolean) => {
  if (entryType === 'purchase') return ar ? 'فاتورة شراء' : 'Purchase';
  if (entryType === 'invoice_time_payment') return ar ? 'مدفوع عند إنشاء الفاتورة (تجميعي)' : 'Invoice-time payment (aggregate)';
  return ar ? 'دفعة' : 'Payment';
};

export function SupplierStatementModal({ open, supplierId, branchId, currency, onClose }: Props) {
  const { lang } = useLanguage();
  const ar = lang === 'ar';
  const [data, setData] = useState<SupplierStatementResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    if (!open || !supplierId || !branchId) {
      setData(null);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    void api.accounting.getSupplierStatement({ p_supplier_id: supplierId, p_branch_id: branchId })
      .then(({ data: result, error: rpcError }) => {
        if (cancelled) return;
        const payload = result as SupplierStatementResult | null;
        if (rpcError || !payload?.success) {
          setData(null);
          setError(rpcError?.message || payload?.error || (ar ? 'تعذر تحميل كشف حساب المورد' : 'Could not load supplier statement'));
        } else {
          setData(payload);
        }
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [open, supplierId, branchId, ar]);

  const s = data?.summary;
  const cards = s ? [
    [ar ? 'إجمالي المشتريات' : 'Purchases', s.total_purchases],
    [ar ? 'المرتجعات' : 'Returns', s.total_returns],
    [ar ? 'إجمالي المدفوع' : 'Total paid', s.total_paid],
    [ar ? 'الرصيد الآجل' : 'Open credit', s.open_balance],
  ] as const : [];

  return (
    <Modal open={open} onClose={onClose} title={ar ? 'كشف حساب المورد' : 'Supplier Statement'} size="xl">
      {loading ? (
        <div className="py-10 text-center text-sm text-ui-muted">{ar ? 'جاري تحميل كشف الحساب...' : 'Loading statement...'}</div>
      ) : error ? (
        <div className="rounded-xl bg-ui-danger-soft p-4 text-sm text-ui-danger">{error}</div>
      ) : s ? (
        <div className="space-y-5" data-testid="supplier-statement">
          <div>
            <p className="text-xs text-ui-subtle">{ar ? 'المورد' : 'Supplier'}</p>
            <p className="text-lg font-black text-ui-text">{s.supplier_name}</p>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {cards.map(([label, value]) => (
              <div key={label} className="rounded-2xl border border-ui-border bg-ui-page-alt p-3">
                <p className="text-xs font-bold text-ui-muted">{label}</p>
                <p className="mt-1 font-black text-ui-text">{formatCurrency(Number(value || 0), currency, lang)}</p>
              </div>
            ))}
          </div>
          <div className="rounded-2xl border border-ui-border p-4">
            <p className="mb-3 text-sm font-black text-ui-text">{ar ? 'تفصيل الدفعات المسجلة' : 'Recorded payment breakdown'}</p>
            <div className="grid grid-cols-2 gap-2 text-sm lg:grid-cols-4">
              <div>{ar ? 'كاش' : 'Cash'}: <b>{formatCurrency(s.recorded_cash_payments, currency, lang)}</b></div>
              <div>{ar ? 'بطاقة' : 'Card'}: <b>{formatCurrency(s.recorded_card_payments, currency, lang)}</b></div>
              <div>{ar ? 'تحويل' : 'Transfer'}: <b>{formatCurrency(s.recorded_transfer_payments, currency, lang)}</b></div>
              <div>{ar ? 'أخرى' : 'Other'}: <b>{formatCurrency(s.recorded_other_payments, currency, lang)}</b></div>
            </div>
            {s.invoice_time_paid > 0.009 && (
              <p className="mt-3 rounded-xl bg-ui-warning-soft p-3 text-xs text-ui-warning">
                {ar
                  ? `مدفوع عند إنشاء فواتير الشراء دون سجل دفع منفصل: ${formatCurrency(s.invoice_time_paid, currency, lang)}. يظهر كسطر تجميعي للمصالحة ولا ينسب له النظام طريقة دفع تاريخية غير محفوظة.`
                  : `Paid at purchase creation without a separate payment record: ${formatCurrency(s.invoice_time_paid, currency, lang)}. It is shown as an aggregate reconciliation line; no historical payment method is invented.`}
              </p>
            )}
          </div>
          <div className="overflow-x-auto rounded-xl border border-ui-border">
            <table className="w-full text-sm">
              <thead className="bg-ui-page-alt text-ui-muted"><tr>
                <th className="px-3 py-2 text-start">{ar ? 'التاريخ' : 'Date'}</th>
                <th className="px-3 py-2 text-start">{ar ? 'البيان' : 'Entry'}</th>
                <th className="px-3 py-2 text-start">{ar ? 'المرجع' : 'Reference'}</th>
                <th className="px-3 py-2 text-end">{ar ? 'مدين' : 'Debit'}</th>
                <th className="px-3 py-2 text-end">{ar ? 'دائن' : 'Credit'}</th>
                <th className="px-3 py-2 text-start">{ar ? 'طريقة الدفع' : 'Payment'}</th>
                <th className="px-3 py-2 text-end">{ar ? 'الرصيد' : 'Balance'}</th>
              </tr></thead>
              <tbody className="divide-y divide-ui-border">
                {(data.entries || []).map((entry) => (
                  <tr key={`${entry.entry_type}-${entry.source_id}`}>
                    <td className="whitespace-nowrap px-3 py-2">{formatDateTime(entry.event_at, lang)}</td>
                    <td className="px-3 py-2">{entryLabel(entry.entry_type, ar)}</td>
                    <td className="px-3 py-2 font-mono text-xs">{entry.reference_number || '-'}</td>
                    <td className="px-3 py-2 text-end">{formatCurrency(Number(entry.debit || 0), currency, lang)}</td>
                    <td className="px-3 py-2 text-end">{formatCurrency(Number(entry.credit || 0), currency, lang)}</td>
                    <td className="px-3 py-2">{paymentLabel(entry.payment_method, ar)}</td>
                    <td className="px-3 py-2 text-end font-bold">{formatCurrency(Number(entry.running_balance || 0), currency, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </Modal>
  );
}
