import { describe, expect, it } from 'vitest';
import {
  buildSageCatalogIdentityExport,
  SAGE_CATALOG_IDENTITY_EXPORT_LIMIT,
  SAGE_CATALOG_IDENTITY_EXPORT_VERSION,
} from '@/features/catalog/lib/sageCatalogIdentityExport';

const BRANCH_A = '19c3fd23-d784-455b-8840-f4f2ac619651';
const BRANCH_B = '279e6662-e901-40b2-9170-7dda0b471ba7';
const makeRow = (n: number, patch: Record<string, unknown> = {}) => ({
  id: '33333333-3333-4333-8333-' + n.toString().padStart(12, '0'),
  name: 'Sage product ' + n,
  sku: null,
  branch_id: BRANCH_A,
  product_type: n === 1 ? 'ready' as const : 'manufactured' as const,
  is_active: n > 10,
  // Sensitive fields may exist in the DB response, but must never be exported.
  sale_price: 100, cost_price: 20, wholesale_price: 80,
  ...patch,
});

describe('Sage branch identity export contract', () => {
  it('preserves exact UUIDs and genuine null SKU for current Sage products', () => {
    const result = buildSageCatalogIdentityExport([makeRow(2), makeRow(1)], BRANCH_A);
    expect(result).toMatchObject({
      schemaVersion: SAGE_CATALOG_IDENTITY_EXPORT_VERSION,
      sourceSystem: 'premieros-sage', branchId: BRANCH_A,
      readOnly: true, canImport: false,
      products: [
        { id: makeRow(1).id, branch_id: BRANCH_A, sku: null, product_type: 'ready', is_active: false },
        { id: makeRow(2).id, branch_id: BRANCH_A, sku: null, product_type: 'manufactured', is_active: false },
      ],
    });
    expect(result.products[0]).not.toHaveProperty('cost_price');
    expect(result.products[0]).not.toHaveProperty('sale_price');
    expect(result.products[0]).not.toHaveProperty('wholesale_price');
    expect(Object.keys(result.products[0]).sort()).toEqual(
      ['id', 'name', 'sku', 'branch_id', 'product_type', 'is_active'].sort(),
    );
  });

  it('supports 259 real-shape branch products and never invents 259 SKUs', () => {
    const result = buildSageCatalogIdentityExport(
      Array.from({ length: 259 }, (_, i) => makeRow(i + 1)), BRANCH_A,
    );
    expect(result.products.length).toBe(259);
    expect(result.products.filter((p) => p.sku === null).length).toBe(259);
    expect(result.products.filter((p) => p.product_type === 'manufactured')).toHaveLength(258);
  });

  it('does not rewrite branch, product IDs, or original valid SKU values', () => {
    const result = buildSageCatalogIdentityExport([
      makeRow(2, { sku: '  001-AB  ', is_active: true }),
    ], BRANCH_A);
    expect(result.products[0].sku).toBe('001-AB');
    expect(result.products[0].id).toBe(makeRow(2).id);
    expect(result.products[0].branch_id).toBe(BRANCH_A);
  });

  it('blocks missing selected branch, cross-branch scope and malformed UUIDs', () => {
    expect(() => buildSageCatalogIdentityExport([makeRow(1)], '')).toThrow('Choose a valid');
    expect(() => buildSageCatalogIdentityExport([makeRow(1)], BRANCH_B)).toThrow('foreign-branch');
    expect(() => buildSageCatalogIdentityExport([makeRow(1, { id: 'not-an-id' })], BRANCH_A)).toThrow();
    expect(() => buildSageCatalogIdentityExport([makeRow(1, { branch_id: null })], BRANCH_A)).toThrow();
  });

  it('blocks duplicate IDs, invalid type or activity, and empty product name', () => {
    expect(() => buildSageCatalogIdentityExport([makeRow(1), makeRow(1)], BRANCH_A)).toThrow('Duplicate');
    expect(() => buildSageCatalogIdentityExport([
      makeRow(1, { product_type: 'other' }),
    ], BRANCH_A)).toThrow('Invalid');
    expect(() => buildSageCatalogIdentityExport([
      makeRow(1, { is_active: undefined }),
    ], BRANCH_A)).toThrow('Invalid');
    expect(() => buildSageCatalogIdentityExport([makeRow(1, { name: ' ' })], BRANCH_A)).toThrow('Invalid');
  });

  it('rejects oversized data without silently trimming, but allows empty branch exports', () => {
    expect(() => buildSageCatalogIdentityExport([], BRANCH_A).products).toEqual([]);
    expect(() => buildSageCatalogIdentityExport(
      Array.from({ length: SAGE_CATALOG_IDENTITY_EXPORT_LIMIT + 1 }, (_, i) => makeRow(i + 1)),
      BRANCH_A,
    )).toThrow('Too many');
  });
});
