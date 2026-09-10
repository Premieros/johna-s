import { describe, expect, it } from 'vitest';
import { ENTITY_CONFIGS } from '../../src/features/import-export/entity-configs';
import { ExcelService } from '../../src/features/import-export/excel-service';
import {
  buildRoundTripExportData,
  sanitizeCsvCell,
} from '../../src/features/import-export/roundtrip-export';
import type { ImportExportEntity } from '../../src/features/import-export/types';

const entityIds = Object.keys(ENTITY_CONFIGS) as ImportExportEntity[];

describe('import/export round-trip contract', () => {
  it('exports every supported entity with exactly the import-template headers and order', () => {
    for (const entity of entityIds) {
      const config = ENTITY_CONFIGS[entity];
      const expectedAr = config.columns.map((column) => column.labelAr);
      const expectedEn = config.columns.map((column) => column.labelEn);

      const ar = buildRoundTripExportData(entity, [], 'ar', 'xlsx');
      const en = buildRoundTripExportData(entity, [], 'en', 'xlsx');

      expect(ar.headers, `${entity} Arabic headers`).toEqual(expectedAr);
      expect(en.headers, `${entity} English headers`).toEqual(expectedEn);
    }
  });

  it('fills missing export fields instead of silently changing the template shape', () => {
    const prepared = buildRoundTripExportData(
      'categories',
      [{ 'كود الفئة': 'CAT-1', 'اسم الفئة': 'مشروبات' }],
      'ar',
      'xlsx'
    );

    const config = ENTITY_CONFIGS.categories;
    expect(Object.keys(prepared.rows[0])).toEqual(config.columns.map((column) => column.labelAr));
    expect(prepared.rows[0][config.columns.find((column) => column.key === 'parent_code')!.labelAr]).toBe('');
  });

  it('maps existing localized export labels back to canonical import columns', () => {
    const prepared = buildRoundTripExportData(
      'products',
      [
        {
          'رمز المنتج (SKU)': 'P-100',
          'اسم المنتج': 'منتج تجريبي',
          'الفئة': 'وجبات',
          'التكلفة': 10,
          'سعر البيع': 20,
          'نشط': 'نعم',
        },
      ],
      'ar',
      'xlsx'
    );

    const row = prepared.rows[0];
    expect(row['رمز المنتج (SKU)']).toBe('P-100');
    expect(row['الفئة / التصنيف']).toBe('وجبات');
    expect(row['التكلفة التقديرية']).toBe(10);
    expect(row['سعر البيع']).toBe(20);
    expect(row['نشط (نعم/لا)']).toBe('نعم');
  });

  it('preserves canonical business values through export and import mapping', () => {
    const prepared = buildRoundTripExportData(
      'products',
      [{ sku: 'P-200', name: 'برجر', price: 45, is_active: true }],
      'ar',
      'xlsx'
    );
    const headers = prepared.headers;
    const mapping = ExcelService.detectAndMapColumns(headers, 'products');
    const canonical = ExcelService.transformMappedRows(prepared.rows, mapping)[0];

    expect(canonical.sku).toBe('P-200');
    expect(canonical.name).toBe('برجر');
    expect(canonical.price).toBe(45);
    expect(canonical.is_active).toBe(true);
  });

  it('neutralizes CSV formula markers while remaining re-importable', () => {
    expect(sanitizeCsvCell('=1+1')).toBe('\t=1+1');
    expect(sanitizeCsvCell('+SUM(A1:A2)')).toBe('\t+SUM(A1:A2)');
    expect(sanitizeCsvCell('@cmd')).toBe('\t@cmd');
    expect(sanitizeCsvCell('-danger')).toBe('\t-danger');
    expect(sanitizeCsvCell('normal')).toBe('normal');
    expect(sanitizeCsvCell(-10)).toBe(-10);

    const prepared = buildRoundTripExportData(
      'products',
      [{ sku: '=FORMULA', name: 'آمن', price: 10 }],
      'ar',
      'csv'
    );
    const mapping = ExcelService.detectAndMapColumns(prepared.headers, 'products');
    const canonical = ExcelService.transformMappedRows(prepared.rows, mapping)[0];

    expect(canonical.sku).toBe('=FORMULA');
  });
});
