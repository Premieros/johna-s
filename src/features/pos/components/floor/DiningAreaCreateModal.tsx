import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/Modal';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { userFacingErrorMessage } from '@/lib/userFacingError';

type AreaInput = { branchId: string; name: string; tableCount: number };
type Props = {
  open: boolean;
  branchId: string;
  createArea: (input: AreaInput) => Promise<void>;
  onClose: () => void;
  onCreated: () => Promise<void>;
};

export function DiningAreaCreateModal({ open, branchId, createArea, onClose, onCreated }: Props) {
  const { t, lang } = useLanguage();
  const ar = lang === 'ar';
  const { show } = useToast();
  const [name, setName] = useState('');
  const [count, setCount] = useState('1');
  const [saving, setSaving] = useState(false);
  const generation = useRef(0);
  const currentBranch = useRef(branchId);
  currentBranch.current = branchId;
  useEffect(() => {
    generation.current += 1;
    setName(''); setCount('1'); setSaving(false);
    return () => { generation.current += 1; };
  }, [open, branchId]);

  const save = async () => {
    if (saving) return;
    const tableCount = Number(count);
    if (!branchId || !name.trim() || name.trim().length > 70 || count.trim() === '' || !Number.isInteger(tableCount) || tableCount < 0 || tableCount > 100) {
      show(ar ? 'أدخل اسم المنطقة وعدد طاولات صحيحًا من 0 إلى 100.' : 'Enter an area name and a whole table count from 0 to 100.', 'error');
      return;
    }
    const request = ++generation.current;
    const requestBranch = branchId;
    setSaving(true);
    let created = false;
    try {
      await createArea({ branchId: requestBranch, name: name.trim(), tableCount });
      created = true;
    } catch (error) {
      if (generation.current === request && currentBranch.current === requestBranch) {
        const code = error instanceof Error ? error.message : '';
        const message = code === 'AREA_NAME_EXISTS'
          ? (ar ? 'توجد منطقة بهذا الاسم في الفرع بالفعل.' : 'An area with this name already exists in this branch.')
          : code === 'AREA_CREATE_BUSY'
            ? (ar ? 'يجري حفظ منطقة أخرى، حاول مرة أخرى بعد لحظة.' : 'Another area is being saved. Try again shortly.')
            : userFacingErrorMessage(error, ar ? 'ar' : 'en');
        show(message, 'error');
      }
    } finally {
      if (generation.current === request) setSaving(false);
    }
    if (!created || generation.current !== request || currentBranch.current !== requestBranch) return;
    show(t('saveSuccess'), 'success');
    onClose();
    // A refresh failure must not present a successful creation as failed or
    // invite a second creation. The branch list can be refreshed independently.
    try { await onCreated(); } catch (error) { show(userFacingErrorMessage(error, ar ? 'ar' : 'en'), 'error'); }
  };

  return <Modal open={open} onClose={saving ? () => {} : onClose} title={t('addArea')} size="sm">
    <div className="space-y-4">
      <Input label={t('areaName')} value={name} maxLength={70} disabled={saving} onChange={event => setName(event.target.value)} placeholder={ar ? 'مثال: التراس' : 'e.g. Terrace'} />
      <Input label={ar ? 'عدد الطاولات' : 'Number of tables'} type="number" min={0} max={100} step={1} value={count} disabled={saving} onChange={event => setCount(event.target.value)} />
      <p className="text-xs text-ui-subtle">{ar ? 'تُنشأ المنطقة وطاولاتها معًا. أدخل 0 لإنشاء منطقة فارغة. تبقى الطاولات الحالية كما هي.' : 'The area and its tables are created together. Enter 0 for an empty area. Existing tables are preserved.'}</p>
      <Button className="w-full" disabled={saving || !branchId} onClick={() => void save()}>{saving ? (ar ? 'جارٍ الحفظ…' : 'Saving…') : t('saveSuccess')}</Button>
    </div>
  </Modal>;
}
