import { ArrowDown, ArrowUp, MoreHorizontal, Search } from 'lucide-react';
import { useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';

function isVisible(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
}

export function PageUtilityControls() {
  const { lang } = useLanguage();
  const [open, setOpen] = useState(false);
  const ar = lang === 'ar';

  const focusSearch = () => {
    const candidates = Array.from(document.querySelectorAll<HTMLInputElement>(
      'main input[type="search"]:not([disabled]), main input[data-testid*="search"]:not([disabled])',
    ));
    const target = candidates.find(isVisible);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      window.setTimeout(() => {
        target.focus();
        target.select();
      }, 220);
      setOpen(false);
      return;
    }
    setOpen(false);
    window.dispatchEvent(new Event('premier:open-command-palette'));
  };

  return (
    <div
      data-testid="page-utility-controls"
      className="fixed bottom-4 end-4 z-40 flex items-end gap-2 print:hidden sm:flex-col"
      aria-label={ar ? 'أدوات الصفحة' : 'Page utilities'}
    >
      <button
        data-testid="page-utility-toggle"
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex h-11 w-11 items-center justify-center rounded-full border border-ui-border bg-ui-surface text-ui-primary shadow-ui-md transition hover:bg-ui-primary-soft active:scale-95 sm:hidden"
        aria-expanded={open}
        aria-label={ar ? 'إظهار أدوات الصفحة' : 'Show page utilities'}
        title={ar ? 'أدوات الصفحة' : 'Page utilities'}
      >
        <MoreHorizontal className="h-5 w-5" />
      </button>

      <div
        data-testid="page-utility-menu"
        className={`${open ? 'flex' : 'hidden'} items-center gap-2 sm:flex sm:flex-col`}
      >
        <button
          type="button"
          onClick={focusSearch}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-ui-border bg-ui-surface text-ui-primary shadow-ui-md transition hover:bg-ui-primary-soft active:scale-95"
          aria-label={ar ? 'بحث في الصفحة' : 'Search this page'}
          title={ar ? 'بحث في الصفحة' : 'Search this page'}
        >
          <Search className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-ui-border bg-ui-surface text-ui-muted shadow-ui-md transition hover:bg-ui-page-alt hover:text-ui-text active:scale-95"
          aria-label={ar ? 'أعلى الصفحة' : 'Scroll to top'}
          title={ar ? 'أعلى الصفحة' : 'Scroll to top'}
        >
          <ArrowUp className="h-5 w-5" />
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
          }}
          className="flex h-11 w-11 items-center justify-center rounded-full border border-ui-border bg-ui-surface text-ui-muted shadow-ui-md transition hover:bg-ui-page-alt hover:text-ui-text active:scale-95"
          aria-label={ar ? 'أسفل الصفحة' : 'Scroll to bottom'}
          title={ar ? 'أسفل الصفحة' : 'Scroll to bottom'}
        >
          <ArrowDown className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
