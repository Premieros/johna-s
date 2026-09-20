import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getApproximateProductVisual } from '../../src/features/catalog/components/ProductImage';

const root = resolve(process.cwd());
const source = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('POS product image and simplified workspace contracts', () => {
  it('uses deterministic approximate visuals when no real product photo exists', () => {
    expect(getApproximateProductVisual('Cappuccino')).toMatchObject({ emoji: '☕' });
    expect(getApproximateProductVisual('برجر كلاسيك')).toMatchObject({ emoji: '🍔' });
    expect(getApproximateProductVisual('Water')).toMatchObject({ emoji: '💧' });
    expect(getApproximateProductVisual('Unknown item')).toMatchObject({ emoji: '🍽️' });
  });

  it('keeps real product photo upload permission-aware and cache-safe', () => {
    const browser = source('src/features/pos/components/catalog/ProductBrowser.tsx');
    const upload = source('src/features/catalog/services/productImages.ts');
    expect(browser).toContain("can('products.edit')");
    expect(browser).not.toContain("can('products.manage')");
    expect(browser).toContain('uploadProductImage(file, product.branch_id, product.id)');
    expect(browser).toContain("update({ image_url: publicUrl })");
    expect(browser).toContain('invalidatePosCatalogCache()');
    expect(upload).toContain("PRODUCT_IMAGES_BUCKET = 'product-images'");
    expect(upload).toContain('5 * 1024 * 1024');
  });

  it('shows product images fully without cropping on white backgrounds', () => {
    const browser = source('src/features/pos/components/catalog/ProductBrowser.tsx');
    const modal = source('src/features/pos/components/catalog/ProductConfigModal.tsx');
    const products = source('src/features/catalog/pages/ProductsPage.tsx');

    expect(browser).toContain('bg-white object-contain');
    expect(browser).not.toContain('object-cover transition duration-200 group-hover:scale-105');
    expect(modal).toContain('bg-white object-contain');
    expect(products).toContain('bg-white object-contain');
  });

  it('keeps the simplified product and tables workspaces wired', () => {
    const browser = source('src/features/pos/components/catalog/ProductBrowser.tsx');
    const tables = source('src/features/pos/components/tables/PosTablesSidebar.tsx');
    expect(browser).toContain('data-testid="pos-product-grid"');
    expect(browser).toContain('data-testid="pos-category-strip"');
    expect(tables).toContain('data-testid="pos-tables-workspace"');
    expect(tables).toContain('data-testid="pos-table-filters"');
    expect(tables).toContain("filter === 'available'");
    expect(tables).toContain("filter === 'occupied'");
  });

  it('keeps storage mutation restricted to product editors with branch access', () => {
    const migration = source('supabase/migrations/20260905001000_canonical_product_image_permission.sql');
    expect(migration).toContain("public.can_permission('products.edit')");
    expect(migration).not.toContain("public.can_permission('products.manage')");
    expect(migration).toContain('public.user_may_access_branch');
    expect(migration).toContain("'product-images'");
  });
});
