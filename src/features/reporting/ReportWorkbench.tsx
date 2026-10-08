import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/Button';
import { formatFinancialCurrency, formatNumber } from '@/lib/format';
import { userFacingErrorMessage } from '@/lib/userFacingError';
import { downloadCSV, openPrintWindow } from '@/lib/reportExport';
import { exportToExcelAdvanced } from '@/lib/excel';
import { analysisColumns, REPORT_DATA_CONTRACTS } from './reportDataContracts';
import { analyseReportRows, emptyAnalysisLayout, normalizeAnalysisLayout, type AnalysisLayout, type ReportRow } from './reportAnalysis';
import { orderReportColumns } from './reportColumnLayout';
import type { ReportType } from './reportFilters';
import { comparisonPeriod, type ComparisonPeriod } from './reportComparison';

interface Props {
  type: ReportType; lang: 'ar' | 'en'; scope: unknown; userId: string; rows: ReportRow[];
  complete: boolean; unavailable: boolean; currency: string; moneyKeys: string[];
  loadRows: (signal: AbortSignal) => Promise<ReportRow[]>;
  canExport: boolean; canPrint: boolean; onOpen: (open: boolean) => void;
  period?: ComparisonPeriod;
  loadComparison?: (period: ComparisonPeriod, signal: AbortSignal) => Promise<ReportRow[]>;
}
interface SavedLayout { name: string; layout: AnalysisLayout; }
const EMPTY: ReportRow[] = [];

export function ReportWorkbench(props: Props) {
  const { type, lang, scope, rows, complete, currency, moneyKeys } = props;
  const ar = lang === 'ar'; const text = (a: string, e: string) => ar ? a : e;
  const [openedScope, setOpenedScope] = useState<unknown>(null);
  const [dataset, setDataset] = useState<{ scope: unknown; rows: ReportRow[] } | null>(null);
  const [layout, setLayout] = useState<AnalysisLayout>(emptyAnalysisLayout);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const [page, setPage] = useState(0); const [name, setName] = useState('');
  const [saved, setSaved] = useState<SavedLayout[]>([]);
  const [comparison, setComparison] = useState<{ scope: unknown; rows: ReportRow[]; period: ComparisonPeriod } | null>(null);
  const [comparing, setComparing] = useState(false);
  const [detail, setDetail] = useState<ReportRow | null>(null);
  const comparisonController = useRef<AbortController | null>(null);
  const controller = useRef<AbortController | null>(null);
  const currentScope = useRef(scope); currentScope.current = scope;
  const storageKey = `premier.report.layouts.v2:${props.userId}:${type}`;
  useEffect(() => {
    try {
      const value: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]');
      setSaved(Array.isArray(value) ? value.filter(item => typeof item?.name === 'string').map(item => ({ name: item.name, layout: normalizeAnalysisLayout(item.layout) })) : []);
    } catch { setSaved([]); }
  }, [storageKey]);
  useEffect(() => { setBusy(false); setError(null); setLayout(emptyAnalysisLayout()); setComparing(false); setDetail(null); return () => { controller.current?.abort(); comparisonController.current?.abort(); }; }, [scope]);
  const open = openedScope === scope;
  const fullRows = open ? (complete ? rows : dataset && dataset.scope === scope ? dataset.rows : EMPTY) : EMPTY;
  const columns = useMemo(() => analysisColumns(type, fullRows), [type, fullRows]);
  const analysed = useMemo(() => analyseReportRows(fullRows, columns, layout), [fullRows, columns, layout]);
  const comparedRows = useMemo(() => comparison && comparison.scope === scope ? analyseReportRows(comparison.rows, columns, { ...layout, groups: [] }) : null, [comparison, scope, columns, layout]);
  const byId = new Map(columns.map(column => [column.id, column]));
  const ordered = orderReportColumns(columns.map(column => column.id), layout.order);
  const visibleIds = ordered.filter(id => layout.visible === null || layout.visible.includes(id));
  const displayIds = [...visibleIds.filter(id => layout.pinned.includes(id)), ...visibleIds.filter(id => !layout.pinned.includes(id))];
  const displayColumns = displayIds.map(id => byId.get(id)!);
  const maxPage = Math.max(0, Math.ceil(analysed.length / 100) - 1);
  const displayed = analysed.slice(Math.min(page, maxPage) * 100, (Math.min(page, maxPage) + 1) * 100);
  const contract = REPORT_DATA_CONTRACTS[type];
  const format = (value: unknown, key: string) => value == null ? '—' : typeof value === 'number' && moneyKeys.includes(key) ? formatFinancialCurrency(value, currency, lang) : String(value);
  const update = (change: Partial<AnalysisLayout>) => { setLayout(previous => ({ ...previous, ...change })); setPage(0); };
  const width = (id: string) => Math.max(80, Math.min(600, Number(layout.widths[id]) || 160));
  const cellStyle = (id: string) => ({ minWidth: width(id), width: width(id), ...(layout.pinned.includes(id) ? { position: 'sticky' as const, insetInlineStart: displayIds.slice(0, displayIds.indexOf(id)).filter(other => layout.pinned.includes(other)).reduce((sum, other) => sum + width(other), 0), zIndex: 1 } : {}) });

  async function begin() {
    if (busy || props.unavailable) return;
    const requestScope = scope; controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setOpenedScope(scope); props.onOpen(true); setBusy(true); setError(null);
    try {
      if (!complete && dataset?.scope !== scope) {
        const result = await props.loadRows(abort.signal);
        if (!abort.signal.aborted && currentScope.current === requestScope) setDataset({ scope: requestScope, rows: result });
      }
    } catch (failure) { if (!abort.signal.aborted && currentScope.current === requestScope) setError(failure); }
    finally { if (currentScope.current === requestScope) setBusy(false); }
  }
  const persist = (next: SavedLayout[]) => { setSaved(next); try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Session state remains usable. */ } };
  const exportRows = () => analysed.map(row => Object.fromEntries(displayColumns.map(column => [column.key, row[column.key]])));
  async function excel() {
    try { await exportToExcelAdvanced({ data: exportRows(), columns: displayColumns.map(column => column.key), filename: `report_${type}_analysis`, sheetName: 'Report', currencyColumns: moneyKeys, columnWidths: Object.fromEntries(displayColumns.map(column => [column.key, Math.round(width(column.id) / 7)])), sourceNote: `${contract.source} · ${ar ? contract.grainAr : contract.grainEn}`, lang }); }
    catch (failure) { setError(failure); }
  }
  async function compare(mode: 'previous' | 'year') {
    if (!props.period || !props.loadComparison || comparing) return;
    const requestScope = scope; const period = comparisonPeriod(props.period, mode);
    comparisonController.current?.abort(); const abort = new AbortController(); comparisonController.current = abort;
    setComparing(true); setComparison(null); setError(null);
    try {
      const result = await props.loadComparison(period, abort.signal);
      if (!abort.signal.aborted && currentScope.current === requestScope) setComparison({ scope: requestScope, rows: result, period });
    } catch (failure) { if (!abort.signal.aborted && currentScope.current === requestScope) setError(failure); }
    finally { if (currentScope.current === requestScope) setComparing(false); }
  }

  return <section className="my-3 space-y-3" data-testid="report-workbench">
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={busy || props.unavailable} onClick={() => { if (open) { setOpenedScope(null); props.onOpen(false); } else void begin(); }}>
        {open ? text('إغلاق أدوات الجدول', 'Close table tools') : text('أدوات الجدول والتحليل الكامل', 'Table tools & full analysis')}
      </Button>
      <span className="text-xs text-ui-muted">{text('مصدر التقرير', 'Report source')}: {contract.source} · {ar ? contract.grainAr : contract.grainEn}</span>
    </div>
    {open && <div className="rounded-lg border border-ui-border bg-ui-surface p-3 space-y-3">
      {busy && <p role="status">{text('جاري تحميل كامل البيانات المسموحة…', 'Loading the full permitted dataset…')}</p>}
      {!!error && <div role="alert">{error instanceof Error && error.message === 'REPORT_SOURCE_LIMIT' ? text('حجم التقرير يتجاوز حد القراءة الآمنة. قلّل الفترة أو حدّد الفرع والفلاتر؛ لم تُعرض نتائج جزئية.', 'The report exceeds the safe read limit. Narrow the period, branch or filters; partial results are not displayed.') : error instanceof Error && error.message === 'COMPARISON_HISTORY_UNAVAILABLE' ? text('الفترة المقارنة غير متاحة بالكامل ضمن صلاحيات العرض التاريخي.', 'The full comparison period is outside your permitted history.') : userFacingErrorMessage(error, lang)} <Button size="sm" onClick={() => void begin()}>{text('إعادة المحاولة', 'Retry')}</Button></div>}
      {!busy && (!error || fullRows.length > 0) && <>
        <p className="text-xs text-ui-muted">{text('الفلاتر والفرز والتجميع تشمل التقرير الكامل. الأسعار والأرصدة والكميات غير المتجانسة لا تُجمع؛ القيمة غير المتاحة تظهر —.', 'Filters, sort and grouping use the full report. Prices, balances and quantities across units are not summed; unavailable values show —.')}</p>
        <div className="flex flex-wrap gap-2 items-center">
          {[0, 1, 2].map(level => <label key={level} className="text-xs">{text('تجميع', 'Group')} {level + 1}
            <select aria-label={`${text('تجميع', 'Group')} ${level + 1}`} value={layout.groups[level] || ''} onChange={event => { const next = [...layout.groups]; next[level] = event.target.value; update({ groups: next.filter(Boolean).filter((id, i, all) => all.indexOf(id) === i) }); }} className="m-1 rounded border border-ui-border bg-ui-surface p-2">
              <option value="">{text('بدون', 'None')}</option>{columns.filter(column => !column.numeric).map(column => <option key={column.id} value={column.id}>{column.key}</option>)}
            </select>
          </label>)}
          <Button size="sm" variant="outline" onClick={() => update(emptyAnalysisLayout())}>{text('إعادة الضبط', 'Reset')}</Button>
          <span>{analysed.length} {text('صف', 'rows')} / {fullRows.length} {text('صف مصدر', 'source rows')}</span>
          {props.period && props.loadComparison && <><Button size="sm" variant="outline" disabled={comparing} onClick={() => void compare('previous')}>{text('مقارنة بالفترة السابقة', 'Compare previous period')}</Button><Button size="sm" variant="outline" disabled={comparing} onClick={() => void compare('year')}>{text('مقارنة بالسنة السابقة', 'Compare prior year')}</Button></>}
        </div>
        {comparing && <p role="status">{text('جاري تحميل الفترة المقارنة المسموحة…', 'Loading the permitted comparison period…')}</p>}
        {comparedRows && comparison && <div className="overflow-auto border rounded p-2"><p>{text('الفترة المقارنة', 'Comparison period')}: {comparison.period.from} — {comparison.period.to}</p><table className="w-full text-sm"><thead><tr>{[text('المقياس', 'Measure'), text('الحالي', 'Current'), text('السابق', 'Previous'), text('الفرق', 'Change'), '%'].map(label => <th key={label} className="text-start p-2">{label}</th>)}</tr></thead><tbody>{columns.filter(column => column.aggregation === 'sum').map(column => {
          const sum = (values: ReportRow[]) => values.every(row => typeof row[column.key] === 'number' && Number.isFinite(row[column.key])) ? values.reduce((total, row) => total + Number(row[column.key]), 0) : null;
          const current = sum(analyseReportRows(fullRows, columns, { ...layout, groups: [] })); const previous = sum(comparedRows);
          const change = current !== null && previous !== null ? current - previous : null;
          return <tr key={column.id}><td className="p-2">{column.key}</td><td>{format(current, column.key)}</td><td>{format(previous, column.key)}</td><td>{format(change, column.key)}</td><td>{change !== null && previous !== null && previous !== 0 ? `${formatNumber(change / Math.abs(previous) * 100, 2)}%` : '—'}</td></tr>;
        })}</tbody></table></div>}
        <details><summary className="cursor-pointer font-semibold">{text('الأعمدة والفلاتر والعرض والتثبيت', 'Columns, filters, widths & pinning')}</summary>
          <div className="max-h-80 overflow-auto mt-2 space-y-2">{ordered.map((id, index) => {
            const column = byId.get(id)!; const filter = layout.filters[id] || { operator: 'contains' as const, value: '' };
            return <div key={id} className="flex flex-wrap items-center gap-2 border-b border-ui-border p-2 text-xs">
              <label><input type="checkbox" checked={visibleIds.includes(id)} onChange={() => update({ visible: visibleIds.includes(id) ? visibleIds.filter(value => value !== id) : [...visibleIds, id] })} /> {column.key}</label>
              <select aria-label={`${column.key} ${text('نوع الفلتر', 'filter operator')}`} value={filter.operator} onChange={event => update({ filters: { ...layout.filters, [id]: { ...filter, operator: event.target.value as 'contains' | 'equals' | 'min' | 'max' } } })} className="bg-ui-surface border rounded p-1">
                <option value="contains">{text('يحتوي', 'Contains')}</option><option value="equals">{text('يساوي', 'Equals')}</option>{column.numeric && <><option value="min">≥</option><option value="max">≤</option></>}
              </select>
              <input aria-label={`${column.key} ${text('فلتر', 'filter')}`} value={filter.value} onChange={event => update({ filters: { ...layout.filters, [id]: { ...filter, value: event.target.value } } })} className="w-28 bg-ui-surface border rounded p-1" />
              <input type="number" min={80} max={600} aria-label={`${column.key} ${text('عرض', 'width')}`} value={width(id)} onChange={event => update({ widths: { ...layout.widths, [id]: Number(event.target.value) } })} className="w-20 bg-ui-surface border rounded p-1" />
              <label><input type="checkbox" checked={layout.pinned.includes(id)} onChange={() => update({ pinned: layout.pinned.includes(id) ? layout.pinned.filter(value => value !== id) : [...layout.pinned, id] })} /> {text('تثبيت', 'Pin')}</label>
              {[-1, 1].map(direction => <button key={direction} type="button" disabled={index + direction < 0 || index + direction >= ordered.length} aria-label={`${column.key} ${direction < 0 ? text('تقديم', 'earlier') : text('تأخير', 'later')}`} onClick={() => { const next = [...ordered]; [next[index], next[index + direction]] = [next[index + direction], next[index]]; update({ order: next }); }} className="p-1 disabled:opacity-30">{direction < 0 ? '↑' : '↓'}</button>)}
              <span className="text-ui-muted">{column.aggregation === 'sum' ? text('جمع', 'Sum') : text('لا يُجمع', 'Not additive')}</span>
            </div>;
          })}</div>
        </details>
        <div className="flex flex-wrap gap-2 items-center">
          <input aria-label={text('اسم العرض', 'View name')} value={name} onChange={event => setName(event.target.value)} placeholder={text('اسم العرض', 'View name')} className="border rounded p-2 bg-ui-surface" />
          <Button size="sm" disabled={!name.trim()} onClick={() => { persist([...saved.filter(view => view.name !== name.trim()), { name: name.trim(), layout }]); setName(''); }}>{text('حفظ الإعدادات', 'Save layout')}</Button>
          {saved.map(view => <span key={view.name} className="flex gap-1"><Button size="sm" variant="outline" onClick={() => { setLayout(view.layout); setPage(0); }}>{view.name}</Button><button type="button" aria-label={`${text('حذف', 'Delete')} ${view.name}`} onClick={() => persist(saved.filter(value => value.name !== view.name))}>×</button></span>)}
          {props.canExport && <><Button size="sm" disabled={!displayColumns.length} onClick={() => downloadCSV(exportRows(), `report_${type}_analysis`)}>CSV</Button><Button size="sm" disabled={!displayColumns.length} onClick={() => void excel()}>Excel</Button></>}
          {props.canPrint && <Button size="sm" disabled={!displayColumns.length} onClick={() => openPrintWindow({ title: text('تحليل التقرير', 'Report analysis'), headers: displayColumns.map(column => column.key), rows: analysed.map(row => displayColumns.map(column => format(row[column.key], column.key))), lang })}>{text('طباعة / PDF', 'Print / PDF')}</Button>}
        </div>
        <div className="overflow-auto max-h-[65vh]"><table className="text-sm w-full"><thead className="sticky top-0 z-20 bg-ui-surface"><tr>{displayColumns.map(column => <th key={column.id} style={cellStyle(column.id)} className="p-2 text-start border-b bg-ui-surface"><button type="button" onClick={() => update({ sort: { column: column.id, descending: layout.sort?.column === column.id ? !layout.sort.descending : false } })}>{column.key} {layout.sort?.column === column.id ? layout.sort.descending ? '↓' : '↑' : ''}</button></th>)}</tr></thead>
          <tbody>{displayed.map((row, index) => <tr key={index}>{displayColumns.map(column => <td key={column.id} style={cellStyle(column.id)} className="p-2 border-b bg-ui-surface">{layout.groups.includes(column.id) ? <button type="button" className="underline text-ui-primary" onClick={() => update({ groups: [], filters: { ...layout.filters, ...Object.fromEntries(layout.groups.map(id => [id, { operator: 'equals', value: String(row[byId.get(id)?.key || ''] ?? '') }])) } })}>{format(row[column.key], column.key)}</button> : column.id === 'Invoice' && layout.groups.length === 0 ? <button type="button" className="underline text-ui-primary" onClick={() => setDetail(row)}>{format(row[column.key], column.key)}</button> : format(row[column.key], column.key)}</td>)}</tr>)}</tbody>
        </table></div>
        {detail && <div className="border rounded p-3" role="region" aria-label={text('تفاصيل صف المصدر', 'Source row details')}><Button size="sm" onClick={() => setDetail(null)}>{text('إغلاق التفاصيل', 'Close details')}</Button><dl>{columns.map(column => <div key={column.id} className="flex gap-3 p-1"><dt>{column.key}</dt><dd>{format(detail[column.key], column.key)}</dd></div>)}</dl></div>}
        {analysed.length > 100 && <div className="flex justify-center items-center gap-2"><Button size="sm" disabled={page <= 0} onClick={() => setPage(previous => previous - 1)}>{text('السابق', 'Previous')}</Button><span>{Math.min(page, maxPage) + 1} / {maxPage + 1}</span><Button size="sm" disabled={page >= maxPage} onClick={() => setPage(previous => previous + 1)}>{text('التالي', 'Next')}</Button></div>}
      </>}
    </div>}
  </section>;
}
