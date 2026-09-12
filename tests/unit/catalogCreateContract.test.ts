import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const migration = read('supabase/migrations/20260912140000_catalog_create_contract.sql');
const rawMaterialsPage = read('src/features/manufacturing/pages/RawMaterialsPage.tsx');
const wizard = read('src/features/catalog/pages/ProductSetupWizardPage.tsx');
const productsPage = read('src/features/catalog/pages/ProductsPage.tsx');
const importExecutor = read('src/features/import-export/import-executor.ts');
const catalogApi = read('src/api/domains/catalog.ts');
const permissionDefs = read('src/lib/permissionDefs.ts');

describe('catalog create contract (PR3 6A)', () => {
  it('defines create_raw_material with the guarded SECURITY DEFINER profile', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.create_raw_material(');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain('SET search_path = public, pg_temp');
    expect(migration).toContain("public.can_permission('raw_materials.manage')");
    expect(migration).toContain('UNIT_REQUIRED');
    expect(migration).toContain('user_may_access_branch(p_branch_id)');
    expect(migration).toContain('RAW_MATERIAL_CREATED');
  });

  it('requires a real measurement unit for every new raw material', () => {
    expect(migration).toContain("FROM public.measurement_units u WHERE u.id = p_unit_id");
    expect(migration).toContain("'UNIT_NOT_FOUND'");
    expect(rawMaterialsPage).toContain('api.catalog.createRawMaterial');
  });

  it('defines create_product with permission-first guards and unit-link handling', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.create_product(');
    expect(migration).toContain('SECURITY DEFINER');
    expect(migration).toContain("public.can_permission('products.create')");
    expect(migration).toContain('INVALID_PRODUCT_TYPE');
    expect(migration).toContain("INSERT INTO public.product_units (");
    expect(migration).toContain("INSERT INTO public.product_unit_links (product_id, unit_id, quantity)");
    expect(migration).toContain('PRODUCT_CREATED');
  });

  it('keeps the legacy product_units base-unit contract on create', () => {
    expect(migration).toContain("'NO_BASE_UNIT'");
  });

  it('grants both RPCs to authenticated and service_role only', () => {
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.create_raw_material(text, text, uuid, uuid, text, numeric, numeric, text, boolean) TO authenticated, service_role;');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.create_product(text, uuid, text, text, text, uuid, text, text, numeric, numeric, numeric, integer, numeric, numeric, numeric, text, boolean, jsonb, jsonb) TO authenticated, service_role;');
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.create_raw_material(text, text, uuid, uuid, text, numeric, numeric, text, boolean) FROM anon;');
    expect(migration).toContain('REVOKE EXECUTE ON FUNCTION public.create_product(text, uuid, text, text, text, uuid, text, text, numeric, numeric, numeric, integer, numeric, numeric, numeric, text, boolean, jsonb, jsonb) FROM anon;');
  });

  it('routes the wizard create path through create_product (no direct products insert)', () => {
    expect(wizard).toContain('api.catalog.createProduct');
    expect(wizard).not.toContain("from('products').insert");
    expect(wizard).not.toContain("logAudit('create', 'products'");
  });

  it('routes ProductsPage single-create through create_product and leaves the edit path on replaceProductUnits', () => {
    expect(productsPage).toContain('api.catalog.createProduct');
    expect(productsPage).toContain("api.catalog.replaceProductUnits");
  });

  it('routes import-executor creates through the guarded RPCs with unit resolution', () => {
    expect(importExecutor).toContain("rpc('create_product'");
    expect(importExecutor).toContain("rpc('create_raw_material'");
    expect(importExecutor).toContain("from('measurement_units')");
    expect(importExecutor).toContain('p_unit_id');
  });

  it('exposes the two wrappers from the catalog domain with the exact RPC names', () => {
    expect(catalogApi).toContain("rpc('create_raw_material', p)");
    expect(catalogApi).toContain("rpc('create_product', p)");
  });

  it('keeps the permission names authoritative in permissionDefs', () => {
    expect(permissionDefs).toContain("'products.create'");
    expect(permissionDefs).toContain("'raw_materials.manage'");
  });
});