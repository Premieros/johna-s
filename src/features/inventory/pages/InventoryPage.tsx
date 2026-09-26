import { useLanguage } from '@/context/LanguageContext';
import { DesignSurface, DesignPageHeader } from '@/components/design';
import { RawMaterialBranchStockPanel } from '../components/RawMaterialBranchStockPanel';

export function InventoryPage() {
  const { t, lang } = useLanguage();
  const isAr = lang === 'ar';

  return (
    <DesignSurface testId="inventory-page">
      <DesignPageHeader
        title={t('inventory')}
        subtitle={isAr
          ? 'الرصيد التشغيلي الحالي للخامات حسب الفرع والمخزن'
          : 'Current operational raw-material stock by branch and warehouse'}
      />
      <RawMaterialBranchStockPanel />
    </DesignSurface>
  );
}
