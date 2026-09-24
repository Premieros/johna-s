import React from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { Card } from '@/components/PageHeader';
import { Input } from '@/components/Input';
import { formatCurrency } from '@/lib/format';
import type { Language } from '@/lib/types';
import type { ReportFilterKey, ReportFilters } from './reportFilters';
import { useHistoryAccess } from '@/lib/useHistoryAccess';

interface FilterOption {
  value: string;
  label: string;
}

export interface ReportFilterBarProps {
  reportType: string;
  filters: ReportFilters;
  onFilterChange: (dim: ReportFilterKey, value: string) => void;
  showDate: boolean;
  period: string;
  onPeriodChange: (key: string) => void;
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  showBranchFilter: boolean;
  branches: Array<{ id: string; name: string; name_en: string | null }>;
  branchFilterValue: string;
  onBranchFilterChange: (value: string) => void;
  filterOptions: (dim: ReportFilterKey) => FilterOption[];
  filterLabel: (dim: ReportFilterKey) => string;
  allLabel: (dim: ReportFilterKey) => string;
  filterDimensions: ReportFilterKey[];
  total: number;
  count: number;
  currency: string;
  lang: Language;
  financialTypes?: Array<{ key: string; label: string }>;
  canFinancial?: boolean;
  onFinancialSelect?: (key: string) => void;
  reportTypes?: Array<{ key: string; label: string; icon: React.ReactNode }>;
  onReportTypeChange?: (key: string) => void;
  onRunReport?: () => void;
  loading?: boolean;
  pendingChanges?: boolean;
}

export function ReportFilterBar({
  reportType,
  filters,
  onFilterChange,
  showDate,
  period,
  onPeriodChange,
  from,
  to,
  onFromChange,
  onToChange,
  showBranchFilter,
  branches,
  branchFilterValue,
  onBranchFilterChange,
  filterOptions,
  filterLabel,
  allLabel,
  filterDimensions,
  total,
  count,
  currency,
  lang,
  financialTypes = [],
  canFinancial = false,
  onFinancialSelect,
  reportTypes = [],
  onReportTypeChange,
  onRunReport,
  loading = false,
  pendingChanges = false,
}: ReportFilterBarProps) {
  const { t } = useLanguage();
  const history = useHistoryAccess();

  return (
    <Card className="ui-accent-system mb-3 border-ui-border bg-ui-surface p-3 shadow-ui-sm">
      <div className="hidden" aria-hidden="true">
        <select
          data-testid="report-type-select"
          value={reportType}
          onChange={(e) => onReportTypeChange?.(e.target.value)}
          tabIndex={-1}
        >
          <optgroup label={lang === 'ar' ? 'التقارير التشغيلية' : 'Operational reports'}>
            {reportTypes.map((rt) => <option key={rt.key} value={rt.key}>{rt.label}</option>)}
          </optgroup>
          {canFinancial && financialTypes.length > 0 && (
            <optgroup label={lang === 'ar' ? 'التقارير المالية' : 'Financial reports'}>
              {financialTypes.map((ft) => <option key={ft.key} value={ft.key}>{ft.label}</option>)}
            </optgroup>
          )}
        </select>
        {reportTypes.map((rt) => (
          <button key={rt.key} type="button" data-report-type={rt.key} tabIndex={-1} onClick={() => onReportTypeChange?.(rt.key)}>
            {rt.label}
          </button>
        ))}
        {canFinancial && financialTypes.map((ft) => (
          <button key={ft.key} type="button" data-report-type={ft.key} tabIndex={-1} onClick={() => onFinancialSelect?.(ft.key)}>
            {ft.label}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          {showDate && (
            <div>
              <label className="mb-1 block text-xs font-medium text-ui-muted">{t('filterByPeriod')}</label>
              <select
                data-testid="report-context-filter"
                value={period}
                onChange={(e) => onPeriodChange(e.target.value)}
                className="h-9 w-full rounded-ui border border-ui-border bg-ui-surface-raised px-2.5 text-xs font-semibold text-ui-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-ring"
              >
                <option value="custom">{lang === 'ar' ? 'مخصص' : 'Custom'}</option>
                <option value="today">{lang === 'ar' ? 'اليوم' : 'Today'}</option>
                <option value="yesterday">{lang === 'ar' ? 'أمس' : 'Yesterday'}</option>
                <option value="last7">{lang === 'ar' ? 'آخر 7 أيام' : 'Last 7 days'}</option>
                <option value="last30">{lang === 'ar' ? 'آخر 30 يومًا' : 'Last 30 days'}</option>
                <option value="this_month">{lang === 'ar' ? 'هذا الشهر' : 'This month'}</option>
                <option value="last_month">{lang === 'ar' ? 'الشهر الماضي' : 'Last month'}</option>
                <option value="this_year">{lang === 'ar' ? 'هذه السنة' : 'This year'}</option>
              </select>
            </div>
          )}

          {showDate && (
            <Input
              label={t('from')}
              type="date"
              value={from}
              min={history.minDate}
              onChange={(e) => onFromChange(history.clampRange(e.target.value, to).from)}
            />
          )}

          {showDate && (
            <Input
              label={t('to')}
              type="date"
              value={to}
              onChange={(e) => {
                const allowed = history.clampRange(from, e.target.value);
                onFromChange(allowed.from);
                onToChange(allowed.to);
              }}
            />
          )}

          {showBranchFilter && (
            <div>
              <label className="mb-1 block text-xs font-medium text-ui-muted">{t('filterByBranch')}</label>
              <select
                value={branchFilterValue}
                onChange={(e) => onBranchFilterChange(e.target.value)}
                className="h-9 w-full rounded-ui border border-ui-border bg-ui-surface-raised px-2.5 text-xs font-semibold text-ui-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-ring"
              >
                <option value="">{t('allBranches')}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {lang === 'ar' ? b.name : (b.name_en || b.name)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {filterDimensions.map((dim) => (
            <div key={dim} data-testid="report-contextual-filters">
              <label className="mb-1 block text-xs font-medium text-ui-muted">{filterLabel(dim)}</label>
              <select
                data-filter-dim={dim}
                value={filters[dim] || ''}
                onChange={(e) => onFilterChange(dim, e.target.value)}
                className="h-9 w-full rounded-ui border border-ui-border bg-ui-surface-raised px-2.5 text-xs font-semibold text-ui-text focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-ring"
              >
                <option value="">{allLabel(dim)}</option>
                {filterOptions(dim).map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2 border-t border-ui-border pt-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <div className="rounded-lg border border-ui-border bg-ui-page-alt px-3 py-1.5">
              <span className="text-ui-muted">{t('total')}: </span>
              <span className="font-extrabold tabular-nums text-ui-accent">{formatCurrency(total, currency, lang)}</span>
            </div>
            <div className="rounded-lg border border-ui-border bg-ui-page-alt px-3 py-1.5">
              <span className="text-ui-muted">{t('count')}: </span>
              <span className="font-extrabold tabular-nums text-ui-text">{count}</span>
            </div>
            {pendingChanges && (
              <span className="rounded-lg border border-ui-warning/30 bg-ui-warning-soft px-3 py-1.5 font-semibold text-ui-warning">
                {lang === 'ar' ? 'تم تعديل الفلاتر — اضغط عرض التقرير' : 'Filters changed — run the report'}
              </span>
            )}
          </div>

          {onRunReport && (
            <button
              type="button"
              onClick={onRunReport}
              disabled={loading}
              data-testid="run-report-button"
              className="h-10 min-w-32 rounded-lg bg-ui-primary px-4 text-sm font-black text-ui-primary-fg transition hover:bg-ui-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading
                ? (lang === 'ar' ? 'جاري الجلب...' : 'Loading...')
                : (lang === 'ar' ? 'عرض التقرير' : 'Run report')}
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}
