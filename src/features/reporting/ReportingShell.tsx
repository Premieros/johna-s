import { useState, useMemo, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Search,
  LayoutDashboard,
  TrendingUp,
  ShoppingCart,
  Package,
  Factory,
  Users,
  Clock,
  Wallet,
  Landmark,
  BarChart3,
  FileText,
  Star,
  Clock3,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
} from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { ReportCard } from './ReportCard';
import {
  REPORT_REGISTRY,
  REPORT_CATEGORIES,
  type ReportCategory,
  type ReportDefinition,
} from './reportRegistry';
import type { ReportType } from './reportFilters';

const CATEGORY_ICONS: Record<ReportCategory, React.ComponentType<{ className?: string }>> = {
  overview: LayoutDashboard,
  sales: TrendingUp,
  purchases_expenses: ShoppingCart,
  inventory: Package,
  manufacturing_costing: Factory,
  customers_suppliers: Users,
  employees_shifts: Clock,
  treasury_payments: Wallet,
  financial: Landmark,
  analytics: BarChart3,
  audit: FileText,
};

const FAVORITES_KEY = 'premire_report_favorites';
const RECENT_KEY = 'premire_report_recent';

function loadFavorites(): string[] {
  try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'); } catch { return []; }
}
function saveFavorites(favs: string[]) { localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs)); }
function loadRecent(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; }
}
function saveRecent(recent: string[]) { localStorage.setItem(RECENT_KEY, JSON.stringify(recent)); }

interface ReportingShellProps {
  activeReport: ReportType;
  onSelectReport: (type: ReportType) => void;
  children: React.ReactNode;
}

export function ReportingShell({ activeReport, onSelectReport, children }: ReportingShellProps) {
  const { lang } = useLanguage();
  const [searchParams] = useSearchParams();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<ReportCategory | null>(null);
  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites());
  const [recent, setRecent] = useState<string[]>(() => loadRecent());
  const [showReportBrowser, setShowReportBrowser] = useState(false);

  useEffect(() => {
    setRecent((prev) => {
      const next = [activeReport, ...prev.filter((r) => r !== activeReport)].slice(0, 6);
      saveRecent(next);
      return next;
    });
  }, [activeReport]);

  useEffect(() => {
    const deepType = searchParams.get('type') || searchParams.get('reportType');
    if (deepType && REPORT_REGISTRY.some((r) => r.key === deepType)) {
      onSelectReport(deepType as ReportType);
    }
  }, [searchParams, onSelectReport]);

  const toggleFavorite = useCallback((key: string) => {
    setFavorites((prev) => {
      const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
      saveFavorites(next);
      return next;
    });
  }, []);

  const activeDefinition = useMemo(
    () => REPORT_REGISTRY.find((r) => r.key === activeReport),
    [activeReport]
  );

  const visibleReports = useMemo(() => {
    let reports = REPORT_REGISTRY;
    if (activeCategory) reports = reports.filter((r) => r.category === activeCategory);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      reports = reports.filter((r) =>
        r.title.toLowerCase().includes(q) ||
        r.titleEn.toLowerCase().includes(q) ||
        r.description.toLowerCase().includes(q) ||
        r.descriptionEn.toLowerCase().includes(q) ||
        r.key.toLowerCase().includes(q)
      );
    }
    return reports;
  }, [activeCategory, searchQuery]);

  const favoriteReports = useMemo(
    () => REPORT_REGISTRY.filter((r) => favorites.includes(r.key)),
    [favorites]
  );

  const recentReports = useMemo(
    () => recent.map((k) => REPORT_REGISTRY.find((r) => r.key === k)).filter(Boolean) as ReportDefinition[],
    [recent]
  );

  const sortedCategories = useMemo(
    () => Object.entries(REPORT_CATEGORIES).sort(([, a], [, b]) => a.order - b.order),
    []
  );

  const selectReport = useCallback((type: ReportType) => {
    onSelectReport(type);
    setShowReportBrowser(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [onSelectReport]);

  return (
    <div className="space-y-2">
      <div className="ui-accent-top ui-accent-system sticky top-0 z-20 rounded-xl border border-ui-border bg-ui-surface/95 p-2 shadow-ui-sm backdrop-blur">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowReportBrowser((open) => !open)}
            className="flex h-9 shrink-0 items-center gap-2 rounded-lg bg-ui-primary px-3 text-xs font-black text-ui-primary-fg transition hover:bg-ui-primary-hover"
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span>{lang === 'ar' ? 'اختيار تقرير' : 'Choose report'}</span>
            {showReportBrowser ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {activeDefinition && (
            <div className="min-w-0 flex-1 rounded-lg border border-ui-border bg-ui-page-alt px-3 py-2">
              <p className="break-words text-xs font-extrabold leading-5 text-ui-text">
                {lang === 'ar' ? activeDefinition.title : activeDefinition.titleEn}
              </p>
            </div>
          )}
        </div>
      </div>

      {showReportBrowser && (
        <section className="ui-accent-card ui-accent-system rounded-xl border border-ui-border bg-ui-surface p-3 shadow-ui-sm">
          <div className="relative mb-3">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ui-subtle" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={lang === 'ar' ? 'ابحث عن تقرير...' : 'Search reports...'}
              className="h-9 w-full rounded-lg border border-ui-border bg-ui-page-alt ps-9 pe-3 text-sm text-ui-text placeholder:text-ui-subtle focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-ring"
            />
          </div>

          <div className="mb-3 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
            <button
              type="button"
              onClick={() => setActiveCategory(null)}
              className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[11px] font-black transition ${activeCategory === null ? 'bg-ui-primary text-ui-primary-fg' : 'border border-ui-border bg-ui-page-alt text-ui-muted'}`}
            >
              <LayoutDashboard className="h-3.5 w-3.5" />
              {lang === 'ar' ? 'الكل' : 'All'}
            </button>
            {sortedCategories.map(([key, cat]) => {
              const Icon = CATEGORY_ICONS[key as ReportCategory] || BarChart3;
              const active = activeCategory === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveCategory(active ? null : key as ReportCategory)}
                  className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[11px] font-black transition ${active ? 'bg-ui-primary text-ui-primary-fg' : 'border border-ui-border bg-ui-page-alt text-ui-muted'}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {lang === 'ar' ? cat.title : cat.titleEn}
                </button>
              );
            })}
          </div>

          {!searchQuery && !activeCategory && recentReports.length > 0 && (
            <div className="mb-3">
              <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-black text-ui-muted">
                <Clock3 className="h-3.5 w-3.5" />
                {lang === 'ar' ? 'الأخيرة' : 'Recent'}
              </h2>
              <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
                {recentReports.slice(0, 4).map((r) => (
                  <button
                    key={r.key}
                    type="button"
                    onClick={() => selectReport(r.key)}
                    className={`min-w-40 shrink-0 rounded-lg border px-3 py-2 text-start text-xs font-bold transition ${activeReport === r.key ? 'border-ui-primary bg-ui-primary/10 text-ui-primary' : 'border-ui-border bg-ui-page-alt text-ui-text hover:border-ui-primary'}`}
                  >
                    <span className="block truncate">{lang === 'ar' ? r.title : r.titleEn}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {!searchQuery && !activeCategory && favoriteReports.length > 0 && (
            <div className="mb-3">
              <h2 className="mb-2 flex items-center gap-1.5 text-[11px] font-black text-ui-muted">
                <Star className="h-3.5 w-3.5" />
                {lang === 'ar' ? 'المفضلة' : 'Favorites'}
              </h2>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {favoriteReports.map((r) => (
                  <ReportCard
                    key={r.key}
                    report={r}
                    isActive={activeReport === r.key}
                    isFavorite={true}
                    lang={lang}
                    onSelect={() => selectReport(r.key)}
                    onToggleFavorite={(e) => { e.stopPropagation(); toggleFavorite(r.key); }}
                  />
                ))}
              </div>
            </div>
          )}

          {visibleReports.length === 0 ? (
            <div className="py-8 text-center text-sm text-ui-subtle">
              {lang === 'ar' ? 'لا توجد تقارير مطابقة' : 'No matching reports'}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {visibleReports.map((r) => (
                <ReportCard
                  key={r.key}
                  report={r}
                  isActive={activeReport === r.key}
                  isFavorite={favorites.includes(r.key)}
                  lang={lang}
                  onSelect={() => selectReport(r.key)}
                  onToggleFavorite={(e) => { e.stopPropagation(); toggleFavorite(r.key); }}
                />
              ))}
            </div>
          )}
        </section>
      )}

      <section className="min-w-0">
        {children}
      </section>
    </div>
  );
}
