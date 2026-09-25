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
  const detectedColumns = data.length > 0 ? Object.keys(data[0]) : [];
  const columns = requestedColumns?.length
    ? requestedColumns.filter((column) => detectedColumns.includes(column) || !!totalRow && Object.prototype.hasOwnProperty.call(totalRow, column))
    : detectedColumns;
  const safeColumns = columns.length > 0 ? columns : [lang === 'ar' ? 'البيان' : 'Item'];

  const normalizedData = data.map((row) =>
    Object.fromEntries(safeColumns.map((column) => [column, row[column] ?? ''])),
  );
  const hasTableTotal = !!totalRow && safeColumns.some((column) => Object.prototype.hasOwnProperty.call(totalRow, column));
  const normalizedTotal = hasTableTotal && totalRow
    ? Object.fromEntries(safeColumns.map((column) => [column, totalRow[column] ?? '']))
    : null;

  const preludeRows: (string | number)[][] = [];
  if (title) preludeRows.push([title, ...Array(Math.max(safeColumns.length - 1, 0)).fill('')]);
  if (subtitle) preludeRows.push([subtitle, ...Array(Math.max(safeColumns.length - 1, 0)).fill('')]);
  if (preludeRows.length > 0) preludeRows.push(Array(safeColumns.length).fill(''));

  const headerRowIndex = preludeRows.length;
  const dataRows = normalizedData.map((row) => safeColumns.map((column) => row[column] as string | number));
  const tableRows: (string | number)[][] = [
    safeColumns,
    ...dataRows,
    ...(normalizedTotal ? [safeColumns.map((column) => normalizedTotal[column] as string | number)] : []),
  ];

  const summaryLine = totalRow && !normalizedTotal
    ? Object.entries(totalRow)
      .filter(([, value]) => value !== '' && value != null)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join('   |   ')
    : '';

  const footerRows: (string | number)[][] = [];
  if (summaryLine) {
    footerRows.push(Array(safeColumns.length).fill(''));
    footerRows.push([summaryLine, ...Array(Math.max(safeColumns.length - 1, 0)).fill('')]);
  }
  if (sourceNote) {
    footerRows.push(Array(safeColumns.length).fill(''));
    footerRows.push([
      `${lang === 'ar' ? 'مصدر الأرقام' : 'Number source'}: ${sourceNote}`,
      ...Array(Math.max(safeColumns.length - 1, 0)).fill(''),
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet([...preludeRows, ...tableRows, ...footerRows]);
  const widths = autoWidth(safeColumns, [...normalizedData, ...(normalizedTotal ? [normalizedTotal] : [])]);
  ws['!cols'] = widths.map((width, index) => ({ wch: columnWidths[safeColumns[index]] ?? width }));

  const merges: { s: { r: number; c: number }; e: { r: number; c: number } }[] = [];
  const lastColumn = Math.max(safeColumns.length - 1, 0);
  if (title) merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: lastColumn } });
  if (subtitle) {
    const subtitleRow = title ? 1 : 0;
    merges.push({ s: { r: subtitleRow, c: 0 }, e: { r: subtitleRow, c: lastColumn } });
  }

  const totalTableRowIndex = normalizedTotal
    ? headerRowIndex + 1 + normalizedData.length
    : null;
  const summaryFooterRowIndex = summaryLine
    ? headerRowIndex + tableRows.length + 1
    : null;
  const sourceFooterRowIndex = sourceNote
    ? headerRowIndex + tableRows.length + (summaryLine ? 3 : 1)
    : null;

  if (summaryFooterRowIndex != null) {
    merges.push({ s: { r: summaryFooterRowIndex, c: 0 }, e: { r: summaryFooterRowIndex, c: lastColumn } });
  }
  if (sourceFooterRowIndex != null) {
    merges.push({ s: { r: sourceFooterRowIndex, c: 0 }, e: { r: sourceFooterRowIndex, c: lastColumn } });
  }
  if (merges.length > 0) ws['!merges'] = merges;

  const dataEndRow = headerRowIndex + Math.max(normalizedData.length, 0);
  ws['!autofilter'] = {
    ref: XLSX.utils.encode_range({
      s: { r: headerRowIndex, c: 0 },
      e: { r: dataEndRow, c: lastColumn },
    }),
  };
  ws['!freeze'] = { xSplit: 0, ySplit: headerRowIndex + 1 };
  ws['!margins'] = { left: 0.25, right: 0.25, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 };
  (ws as unknown as Record<string, unknown>)['!pageSetup'] = {
    orientation: safeColumns.length > 8 ? 'landscape' : 'portrait',
    fitToWidth: 1,
    fitToHeight: 0,
    paperSize: 9,
  };
  (wb as unknown as Record<string, unknown>)['Workbook'] = {
    Views: [{ state: 'frozen', ysplit: headerRowIndex + 1, xsplit: 0 }],
  };

  const rowsMeta: Array<{ hpt?: number }> = [];
  if (title) rowsMeta[0] = { hpt: 26 };
  if (subtitle) rowsMeta[title ? 1 : 0] = { hpt: 20 };
  rowsMeta[headerRowIndex] = { hpt: 24 };
  ws['!rows'] = rowsMeta;

  if (title) {
    const cell = ws[XLSX.utils.encode_cell({ r: 0, c: 0 })];
    if (cell) cell.s = {
      font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 16 },
      fill: { fgColor: { rgb: '1F4E78' } },
      alignment: { horizontal: 'center', vertical: 'center' },
    };
  }

  if (subtitle) {
    const row = title ? 1 : 0;
    const cell = ws[XLSX.utils.encode_cell({ r: row, c: 0 })];
    if (cell) cell.s = {
      font: { bold: true, color: { rgb: '1F1F1F' }, sz: 11 },
      fill: { fgColor: { rgb: 'D9EAF7' } },
      alignment: { horizontal: 'center', vertical: 'center' },
    };
  }

  for (let col = 0; col <= lastColumn; col++) {
    const address = XLSX.utils.encode_cell({ r: headerRowIndex, c: col });
    const cell = ws[address];
    if (!cell) continue;
    cell.s = {
      font: { bold: true, color: { rgb: 'FFFFFF' }, sz: 12 },
      fill: { fgColor: { rgb: '4472C4' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: {
        top: { style: 'thin', color: { rgb: 'B4C7E7' } },
        bottom: { style: 'thin', color: { rgb: 'B4C7E7' } },
        left: { style: 'thin', color: { rgb: 'B4C7E7' } },
        right: { style: 'thin', color: { rgb: 'B4C7E7' } },
      },
    };
  }

  const colIdxMap = new Map(safeColumns.map((column, index) => [column, index]));
  const lastFormattedRow = normalizedTotal && totalTableRowIndex != null
    ? totalTableRowIndex
    : headerRowIndex + normalizedData.length;
  const applyNumberFormat = (names: string[], format: string) => {
    for (const name of names) {
      const columnIndex = colIdxMap.get(name);
      if (columnIndex == null) continue;
      for (let row = headerRowIndex + 1; row <= lastFormattedRow; row++) {
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
    for (let row = headerRowIndex + 1; row <= lastFormattedRow; row++) {
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

  if (totalTableRowIndex != null) {
    for (let col = 0; col <= lastColumn; col++) {
      const address = XLSX.utils.encode_cell({ r: totalTableRowIndex, c: col });
      const cell = ws[address];
      if (cell) {
        cell.s = {
          ...(cell.s || {}),
          font: { bold: true, sz: 11 },
          fill: { fgColor: { rgb: 'D9EAF7' } },
          border: {
            top: { style: 'medium', color: { rgb: '4472C4' } },
          },
        };
      }
    }
  }

  if (summaryFooterRowIndex != null) {
    const cell = ws[XLSX.utils.encode_cell({ r: summaryFooterRowIndex, c: 0 })];
    if (cell) cell.s = {
      font: { bold: true, sz: 11, color: { rgb: '1F1F1F' } },
      fill: { fgColor: { rgb: 'D9EAF7' } },
      alignment: { horizontal: 'center', vertical: 'center' },
    };
  }

  if (sourceFooterRowIndex != null) {
    const cell = ws[XLSX.utils.encode_cell({ r: sourceFooterRowIndex, c: 0 })];
    if (cell) cell.s = {
      font: { italic: true, sz: 9, color: { rgb: '666666' } },
      alignment: { horizontal: lang === 'ar' ? 'right' : 'left', wrapText: true },
    };
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
