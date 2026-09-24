export interface ExcelExportOptions {
  data: Record<string, unknown>[];
  filename: string;
  sheetName?: string;
  title?: string;
  subtitle?: string;
  currencyColumns?: string[];
  integerColumns?: string[];
  dateColumns?: string[];
  percentageColumns?: string[];
  columns?: string[];
  columnWidths?: Record<string, number>;
  totalRow?: Record<string, unknown>;
  sourceNote?: string;
  lang?: 'ar' | 'en';
}

function autoWidth(columns: string[], rows: Record<string, unknown>[]): number[] {
  return columns.map((col) => {
    let max = col.length;
    for (const row of rows) {
      const v = row[col];
      const len = v == null ? 0 : String(v).length;
      if (len > max) max = len;
    }
    return Math.min(Math.max(max + 2, 10), 40);
  });
}

export async function exportToExcelAdvanced(options: ExcelExportOptions): Promise<void> {
  const XLSX = await import('xlsx');
  const {
    data,
    filename,
    sheetName = 'Sheet1',
    title,
    subtitle,
    currencyColumns = [],
    integerColumns = [],
    dateColumns = [],
    percentageColumns = [],
    columns: requestedColumns,
    columnWidths = {},
    totalRow,
    sourceNote,
    lang,
  } = options;

  const wb = XLSX.utils.book_new();

  if (title) {
    const summaryRows: [string, string][] = [[title, '']];
    if (subtitle) summaryRows.push([subtitle, '']);
    if (totalRow) {
      for (const [key, value] of Object.entries(totalRow)) {
        summaryRows.push([key, value == null ? '' : String(value)]);
      }
    }
    if (sourceNote) {
      summaryRows.push([lang === 'ar' ? 'مصدر الأرقام' : 'Number source', sourceNote]);
    }
    summaryRows.push([
      `${lang === 'ar' ? 'تاريخ الإنشاء' : 'Generated at'}: ${new Date().toLocaleString()}`,
      '',
    ]);

    const summaryData: (string | number)[][] = [
      [lang === 'ar' ? 'البيان' : 'Item', lang === 'ar' ? 'القيمة' : 'Value'],
      ...summaryRows,
    ];
    const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
    summaryWs['!cols'] = [{ wch: 32 }, { wch: 44 }];
    summaryWs['!freeze'] = { xSplit: 0, ySplit: 1 };
    summaryWs['!margins'] = { left: 0.35, right: 0.35, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 };
    XLSX.utils.book_append_sheet(wb, summaryWs, lang === 'ar' ? 'ملخص' : 'Summary');
  }

  const detectedColumns = data.length > 0 ? Object.keys(data[0]) : [];
  const columns = requestedColumns?.length
    ? requestedColumns.filter((column) => detectedColumns.includes(column))
    : detectedColumns;

  const normalizedData = data.map((row) =>
    Object.fromEntries(columns.map((column) => [column, row[column] ?? ''])),
  );
  const normalizedTotal = totalRow
    ? Object.fromEntries(columns.map((column) => [column, totalRow[column] ?? '']))
    : null;
  const allRows = normalizedTotal ? [...normalizedData, normalizedTotal] : normalizedData;

  const ws = XLSX.utils.json_to_sheet(allRows, { header: columns });
  const widths = autoWidth(columns, allRows);
  ws['!cols'] = widths.map((width, index) => ({ wch: columnWidths[columns[index]] ?? width }));

  (wb as unknown as Record<string, unknown>)['Workbook'] = {
    Views: [{ state: 'frozen', ysplit: 1, xsplit: 0 }],
  };

  const ref = ws['!ref'] || (columns.length > 0 ? XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: columns.length - 1 } }) : 'A1:A1');
  const range = XLSX.utils.decode_range(ref);
  ws['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  ws['!margins'] = { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 };
  (ws as unknown as Record<string, unknown>)['!pageSetup'] = {
    orientation: columns.length > 8 ? 'landscape' : 'portrait',
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
  };

  for (let col = range.s.c; col <= range.e.c; col++) {
    const address = XLSX.utils.encode_cell({ r: 0, c: col });
    const cell = ws[address];
    if (!cell) continue;
    cell.s = {
      font: { bold: true, color: { rgb: 'FFFFFF' } },
      fill: { fgColor: { rgb: '1F4E78' } },
      alignment: { horizontal: 'center', vertical: 'center' },
      border: {
        top: { style: 'thin', color: { rgb: 'B4C7E7' } },
        bottom: { style: 'thin', color: { rgb: 'B4C7E7' } },
        left: { style: 'thin', color: { rgb: 'B4C7E7' } },
        right: { style: 'thin', color: { rgb: 'B4C7E7' } },
      },
    };
  }

  const colIdxMap = new Map(columns.map((column, index) => [column, index]));
  const applyNumberFormat = (names: string[], format: string) => {
    for (const name of names) {
      const columnIndex = colIdxMap.get(name);
      if (columnIndex == null) continue;
      for (let row = range.s.r + 1; row <= range.e.r; row++) {
        const address = XLSX.utils.encode_cell({ r: row, c: columnIndex });
        const cell = ws[address];
        if (cell && typeof cell.v === 'number') {
          cell.t = 'n';
          cell.z = format;
        }
      }
    }
  };

  applyNumberFormat(currencyColumns, '#,##0.00');
  applyNumberFormat(integerColumns, '#,##0');
  applyNumberFormat(percentageColumns, '0.00%');

  for (const name of dateColumns) {
    const columnIndex = colIdxMap.get(name);
    if (columnIndex == null) continue;
    for (let row = range.s.r + 1; row <= range.e.r; row++) {
      const address = XLSX.utils.encode_cell({ r: row, c: columnIndex });
      const cell = ws[address];
      if (!cell || !cell.v) continue;
      const parsed = new Date(String(cell.v));
      if (!Number.isNaN(parsed.getTime())) {
        cell.v = parsed;
        cell.t = 'd';
        cell.z = 'yyyy-mm-dd hh:mm';
      }
    }
  }

  if (normalizedTotal && allRows.length > 0) {
    const lastRow = range.e.r;
    for (let col = range.s.c; col <= range.e.c; col++) {
      const address = XLSX.utils.encode_cell({ r: lastRow, c: col });
      const cell = ws[address];
      if (cell) {
        cell.s = {
          ...(cell.s || {}),
          font: { bold: true },
          fill: { fgColor: { rgb: 'D9EAF7' } },
        };
      }
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${filename}.xlsx`, { cellStyles: true, compression: true });
}

export async function exportToExcel(
  data: Record<string, unknown>[],
  filename: string,
  sheetName = 'Sheet1',
): Promise<void> {
  return exportToExcelAdvanced({ data, filename, sheetName });
}

export async function importFromExcel(file: File): Promise<Record<string, unknown>[]> {
  const XLSX = await import('xlsx');
  const data = await file.arrayBuffer();
  const wb = XLSX.read(new Uint8Array(data), { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws) as Record<string, unknown>[];
}

export async function downloadTemplate(columns: string[], filename: string): Promise<void> {
  const data = [columns.reduce((acc, col) => ({ ...acc, [col]: '' }), {})];
  await exportToExcel(data, filename, 'Template');
}
