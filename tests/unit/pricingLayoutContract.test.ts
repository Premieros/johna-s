import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pricing = readFileSync('src/features/catalog/pages/PricingPage.tsx', 'utf8');
const utilities = readFileSync('src/components/PageUtilityControls.tsx', 'utf8');

describe('pricing workspace responsive layout', () => {
  it('keeps import, export and refresh grouped outside the page heading', () => {
    expect(pricing).toContain('data-testid="pricing-actions-panel"');
    expect(pricing).toContain('data-testid="pricing-file-actions"');
    expect(pricing).toContain('استيراد الأسعار');
    expect(pricing).toContain('تصدير Excel');
    expect(pricing).toContain('تحديث');
    expect(pricing).not.toContain('actions={(');
  });

  it('provides table-local navigation instead of overlapping floating actions', () => {
    expect(pricing).toContain('data-testid="pricing-table-navigation"');
    expect(pricing).toContain('ref={tableScrollRef}');
    expect(pricing).toContain('tableScrollRef.current?.scrollTo');
    expect(utilities).toContain("location.pathname === '/pricing'");
    expect(utilities).toContain("window.scrollTo({ top: 0");
  });

  it('does not change canonical price writers or inventory valuation', () => {
    expect(pricing).toContain('costing.setRawMaterialPrice({');
    expect(pricing).toContain('updateManufacturedPricing({');
    expect(pricing).toContain('updateProductPricing({');
    expect(pricing).not.toContain(".from('raw_material_inventory').update");
  });
});
