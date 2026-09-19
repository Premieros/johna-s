import { useState } from 'react';
import { AlertCircle, Trash2 } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { Button } from '@/components/Button';
import { Modal } from '@/components/Modal';
import type { CartItem } from '@/lib/types';
import { cartLineKey } from '../../utils/cart';

interface VoidItemModalProps {
  open: boolean;
  onClose: () => void;
  item: CartItem | null;
  sentQty: number;
  onConfirmVoid: (lineKey: string, voidQuantity: number, reason: string) => Promise<void> | void;
}

const COMMON_REASONS = [
  'طلب الزبون إلغاء الصنف',
  'خطأ في تسجيل الصنف',
  'تأخر تحضير الطلب في المطبخ',
  'نفاد المكونات / غير متوفر',
  'أخرى',
];

export function VoidItemModal({
  open,
  onClose,
  item,
  sentQty,
  onConfirmVoid,
}: VoidItemModalProps) {
  const { lang, t } = useLanguage();
  const isAr = lang === 'ar';

  const [quantity, setQuantity] = useState(1);
  const [selectedReason, setSelectedReason] = useState(COMMON_REASONS[0]);
  const [customReason, setCustomReason] = useState('');
  const [loading, setLoading] = useState(false);

  if (!open || !item) return null;

  const handleConfirm = async () => {
    const finalReason = selectedReason === 'أخرى' && customReason.trim() ? customReason.trim() : selectedReason;
    setLoading(true);
    try {
      await onConfirmVoid(cartLineKey(item), Math.min(quantity, sentQty), finalReason);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isAr ? 'إلغاء صنف مرسل للمطبخ (Void Item)' : 'Void Sent Item'}
      size="md"
    >
      <div className="space-y-4">
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3.5 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <p className="font-black text-rose-700">
              {isAr
                ? `هذا الصنف تم إرساله مسبقاً للمطبخ (الكمية المرسلة: ${sentQty})`
                : `This item was previously sent to kitchen (Sent Qty: ${sentQty})`}
            </p>
            <p className="text-rose-600">
              {isAr
                ? 'سيتم تنفيذ الإلغاء عبر مسار Void المعتمد مع تسجيل السبب وتحديث الطلب والمخزون حسب الكمية المرسلة. من يملك صلاحية إلغاء الصنف (pos.void) ينفذ مباشرة؛ ومن لا يملكها يبقى خاضعًا لمسار الموافقة.'
                : 'The item will be voided through the controlled Void flow with an audited reason and the sent quantity reconciled. Users with pos.void execute directly; users without it remain on the approval path.'}
            </p>
          </div>
        </div>

        <div className="rounded-2xl border border-ui-border bg-ui-page p-3.5 flex items-center justify-between">
          <div>
            <p className="text-sm font-black text-ui-text">
              {isAr ? item.product.name : item.product.name_en || item.product.name}
            </p>
            {item.modifiers?.length ? (
              <p className="text-[11px] font-bold text-ui-muted">{item.modifiers.map((m) => m.name).join(' · ')}</p>
            ) : null}
            <p className="text-xs text-ui-subtle">
              {isAr ? `إجمالي بالطلب: ${item.quantity} · مرسل: ${sentQty}` : `Total: ${item.quantity} · Sent: ${sentQty}`}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-bold text-ui-subtle">
              {isAr ? 'الكمية الملغاة:' : 'Qty to void:'}
            </label>
            <select
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              className="rounded-xl border border-ui-border bg-ui-surface px-2.5 py-1.5 text-xs font-black text-ui-text shadow-ui-xs"
            >
              {Array.from({ length: sentQty }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-black text-ui-text">
            {isAr ? 'سبب الإلغاء (مطلوب للرقابة والتدقيق):' : 'Void Reason (Audit Log):'}
          </label>
          <div className="space-y-1.5">
            {COMMON_REASONS.map((r) => (
              <label
                key={r}
                className={`flex items-center gap-2.5 rounded-xl border p-2.5 text-xs font-semibold cursor-pointer transition ${
                  selectedReason === r
                    ? 'border-ui-primary bg-ui-primary-soft text-ui-primary'
                    : 'border-ui-border bg-ui-surface text-ui-text hover:bg-ui-page'
                }`}
              >
                <input
                  type="radio"
                  name="voidReason"
                  checked={selectedReason === r}
                  onChange={() => setSelectedReason(r)}
                  className="text-ui-primary focus:ring-ui-primary"
                />
                <span>{r}</span>
              </label>
            ))}
          </div>

          {selectedReason === 'أخرى' && (
            <input
              type="text"
              value={customReason}
              onChange={(e) => setCustomReason(e.target.value)}
              placeholder={isAr ? 'اكتب سبب الإلغاء بالتفصيل...' : 'Enter custom reason...'}
              className="mt-2 w-full rounded-xl border border-ui-border bg-ui-surface p-2.5 text-xs text-ui-text placeholder:text-ui-muted"
            />
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-ui-border">
          <Button variant="secondary" onClick={onClose} disabled={loading}>{t('cancel')}</Button>
          <Button variant="danger" onClick={handleConfirm} disabled={loading}>
            <Trash2 className="h-4 w-4" />
            <span>{isAr ? 'تأكيد إلغاء الصنف (Void)' : 'Confirm Void'}</span>
          </Button>
        </div>
      </div>
    </Modal>
  );
}
