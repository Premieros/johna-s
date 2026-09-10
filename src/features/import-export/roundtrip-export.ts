import { ExcelService } from './excel-service';
import { ENTITY_CONFIGS } from './entity-configs';
import { ExportFormat, ImportExportEntity } from './types';

export interface RoundTripExportData {
  headers: string[];
  rows: Record<string, unknown>[];
}

function localizeBoolean(value: unknown, lang: 'ar' | 'en'): unknown {
  if (typeof value !== 'boolean') return value;
  if (lang === 'ar') return value ? 'نعم' : 'لا';
  return value ? 'Yes' : 'No';
}

/**
 * CSV files may be opened by spreadsheet applications that interpret values
 * beginning with formula markers. Prefixing a tab keeps the cell textual;
 * our importer trims strings, so an exported CSV can still be re-imported
 * without changing the business value.
 */
export function sanitizeCsvCell(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  return /^[=+\-@]/.test(value) ? `\t${value}` : value;
}

/**
 * Build exported rows from the same EntityConfig used by the import template.
 * This is deliberately pure: it does not fetch data or bypass permissions/RLS.
 */
export function buildRoundTripExportData(
  entity: ImportExportEntity,
  records: Record<string, unknown>[],
  lang: 'ar' | 'en' = 'ar',
  format: ExportFormat = 'xlsx'
): RoundTripExportData {
  const config = ENTITY_CONFIGS[entity];
  if (!config) throw new Error(`Unsupported import/export entity: ${entity}`);

  const headers = config.columns.map((column) => (lang === 'ar' ? column.labelAr : column.labelEn));

  const rows = records.map((record) => {
    const recordHeaders = Object.keys(record);
    const mapping = ExcelService.detectAndMapColumns(recordHeaders, entity);
    const output: Record<string, unknown> = {};

    config.columns.forEach((column) => {
      const header = lang === 'ar' ? column.labelAr : column.labelEn;
      const sourceHeader = mapping[column.key];
      const hasCanonicalValue = Object.prototype.hasOwnProperty.call(record, column.key);
      const value = hasCanonicalValue
        ? record[column.key]
        : sourceHeader
          ? record[sourceHeader]
          : '';

      const localized = localizeBoolean(value ?? '', lang);
      output[header] = format === 'csv' ? sanitizeCsvCell(localized) : localized;
    });

    return output;
  });

  return { headers, rows };
}

function buildInstructionsSheetData(entity: ImportExportEntity, lang: 'ar' | 'en'): unknown[][] {
  const config = ENTITY_CONFIGS[entity];
  const instructions = lang === 'ar' ? config.instructionsAr : config.instructionsEn;

  return [
    [lang === 'ar' ? `إرشادات وقواعد استيراد: ${config.titleAr}` : `Import Guidelines: ${config.titleEn}`],
    [''],
    ...instructions.map((instruction, index) => [`${index + 1}. ${instruction}`]),
    [''],
    [lang === 'ar' ? 'توضيح الأعمدة:' : 'Columns Guide:'],
    [
      lang === 'ar' ? 'العمود' : 'Column',
      lang === 'ar' ? 'إلزامي؟' : 'Required?',
      lang === 'ar' ? 'النوع' : 'Type',
      lang === 'ar' ? 'مثال' : 'Example',
      lang === 'ar' ? 'الشرح' : 'Description',
    ],
    ...config.columns.map((column) => [
      lang === 'ar' ? column.labelAr : column.labelEn,
      column.required ? (lang === 'ar' ? 'نعم' : 'Yes') : (lang === 'ar' ? 'اختياري' : 'Optional'),
      column.type,
      String(column.example),
      lang === 'ar' ? column.descriptionAr : column.descriptionEn,
    ]),
  ];
}

/**
 * Export a workbook that has exactly the same data-column contract as the
 * official import template. The records supplied here must already be scoped
 * by the caller's normal Supabase/RLS query.
 */
export async function exportRoundTripWorkbook(
  entity: ImportExportEntity,
  records: Record<string, unknown>[],
  filename: string,
  format: ExportFormat = 'xlsx',
  lang: 'ar' | 'en' = 'ar'
): Promise<void> {
  const XLSX = await import('xlsx');
  const config = ENTITY_CONFIGS[entity];
  if (!config) throw new Error(`Unsupported import/export entity: ${entity}`);

  const prepared = buildRoundTripExportData(entity, records, lang, format);
  const worksheet = XLSX.utils.json_to_sheet(prepared.rows, { header: prepared.headers });
  worksheet['!cols'] = config.columns.map((column) => ({
    wch: Math.max(lang === 'ar' ? column.labelAr.length * 2 : column.labelEn.length + 5, 18),
  }));

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, lang === 'ar' ? 'البيانات' : 'Data');

  if (format === 'xlsx') {
    const instructions = XLSX.utils.aoa_to_sheet(buildInstructionsSheetData(entity, lang));
    instructions['!cols'] = [{ wch: 30 }, { wch: 15 }, { wch: 15 }, { wch: 25 }, { wch: 50 }];
    XLSX.utils.book_append_sheet(workbook, instructions, lang === 'ar' ? 'الإرشادات' : 'Instructions');
    XLSX.writeFile(workbook, `${filename}.xlsx`, { bookType: 'xlsx' });
    return;
  }

  XLSX.writeFile(workbook, `${filename}.csv`, { bookType: 'csv' });
}
