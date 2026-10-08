import { useState, useRef, useEffect } from 'react';
import { ArrowUp, ArrowDown, Columns } from 'lucide-react';
import { Button } from '@/components/Button';

interface ColumnPickerProps {
  columns: string[];
  visibleColumns: string[] | null;
  onToggle: (key: string) => void;
  onShowAll: () => void;
  onMove?: (key: string, direction: -1 | 1) => void;
  onResetOrder?: () => void;
  lang: string;
  hiddenCount: number;
}

export function ColumnPicker({ columns, visibleColumns, onToggle, onShowAll, onMove, onResetOrder, lang, hiddenCount }: ColumnPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const isVisible = (col: string) => visibleColumns === null || visibleColumns.includes(col);

  return (
    <div ref={ref} className="relative inline-flex">
      <Button variant="outline" size="sm" aria-expanded={open} onClick={() => { setOpen((o) => !o); setSearch(''); }}>
        <Columns className="w-4 h-4" />
        {lang === 'ar' ? 'الأعمدة' : 'Columns'}
        {hiddenCount > 0 && (
          <span className="ml-1 inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold rounded-full bg-ui-primary text-ui-primary-fg">
            {hiddenCount}
          </span>
        )}
      </Button>
      {open && (
        <div className="absolute end-0 top-full mt-1 z-50 w-72 max-w-[calc(100vw-2rem)] bg-ui-surface border border-ui-border rounded-ui shadow-lg p-2" onKeyDown={event => { if (event.key === 'Escape') setOpen(false); }}>
          <input type="search" value={search} onChange={event => setSearch(event.target.value)}
            aria-label={lang === 'ar' ? 'بحث في الأعمدة' : 'Search columns'}
            placeholder={lang === 'ar' ? 'بحث في الأعمدة' : 'Search columns'}
            className="mb-1 w-full rounded-ui border border-ui-border bg-ui-page-alt p-2 text-sm text-ui-text" />
          <button
            onClick={() => { onShowAll(); setOpen(false); }}
            className="w-full text-start px-2 py-1.5 text-sm rounded-ui hover:bg-ui-page-alt text-ui-primary font-medium"
          >
            {lang === 'ar' ? 'إظهار الكل' : 'Show All'}
          </button>
          {onResetOrder && <button type="button" onClick={onResetOrder} className="w-full text-start px-2 py-1.5 text-sm rounded-ui hover:bg-ui-page-alt text-ui-text">
            {lang === 'ar' ? 'الترتيب الافتراضي' : 'Default order'}
          </button>}
          <div className="border-t border-ui-border my-1" />
          <div className="max-h-72 overflow-y-auto">
          {columns.filter(col => col.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).map((col) => (
            <div key={col} className="flex items-center gap-1 rounded-ui hover:bg-ui-page-alt">
            <label className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-sm text-ui-text cursor-pointer">
              <input
                type="checkbox"
                checked={isVisible(col)}
                onChange={() => onToggle(col)}
                className="rounded"
              />
              <span className="break-words">{col}</span>
            </label>
            {onMove && <>
              <button type="button" disabled={columns.indexOf(col) === 0} onClick={() => onMove(col, -1)}
                aria-label={lang === 'ar' ? `تقديم ${col}` : `Move ${col} earlier`} className="p-1.5 text-ui-muted disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
              <button type="button" disabled={columns.indexOf(col) === columns.length - 1} onClick={() => onMove(col, 1)}
                aria-label={lang === 'ar' ? `تأخير ${col}` : `Move ${col} later`} className="p-1.5 text-ui-muted disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
            </>}
            </div>
          ))}
          {!columns.some(col => col.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) && <p className="p-2 text-sm text-ui-muted">{lang === 'ar' ? 'لا توجد أعمدة مطابقة' : 'No matching columns'}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
