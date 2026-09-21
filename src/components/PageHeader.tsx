import { type HTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import clsx from 'clsx';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
}

export function PageHeader({ title, subtitle, actions, breadcrumbs }: PageHeaderProps) {
  return (
    <div data-testid="page-header" className="mb-4 flex min-w-0 flex-col gap-3 sm:mb-6 sm:flex-row sm:items-center sm:justify-between sm:gap-4 lg:mb-8">
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav data-testid="page-breadcrumbs" aria-label="Breadcrumbs" className="mb-1.5 flex flex-wrap items-center gap-1 text-xs">
            {breadcrumbs.map((crumb, i) => {
              const last = i === breadcrumbs.length - 1;
              return (
                <span key={crumb.label + i} className="flex items-center gap-1">
                  {crumb.href && !last ? (
                    <Link to={crumb.href} className="font-medium text-ui-subtle hover:text-ui-primary">{crumb.label}</Link>
                  ) : (
                    <span className={clsx(last ? 'font-semibold text-ui-muted' : 'text-ui-subtle')}>{crumb.label}</span>
                  )}
                  {!last && <ChevronRight className="h-3 w-3 text-ui-subtle [dir='rtl']:rotate-180" />}
                </span>
              );
            })}
          </nav>
        )}
        <h1 data-testid="page-title" className="text-xl font-extrabold tracking-tight text-ui-text sm:text-2xl">{title}</h1>
        {subtitle && <p data-testid="page-description" className="mt-1 text-sm font-medium leading-6 text-ui-muted sm:mt-1.5">{subtitle}</p>}
      </div>
      {actions && (
        <div
          data-testid="page-actions"
          className="flex w-full min-w-0 items-center gap-2 overflow-x-auto overscroll-x-contain pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:w-auto sm:flex-wrap sm:overflow-visible sm:pb-0"
        >
          {actions}
        </div>
      )}
    </div>
  );
}

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function Card({ children, className = '', ...rest }: CardProps) {
  return (
    <div
      className={clsx(
        'ui-accent-card ui-accent-neutral rounded-xl border border-ui-border bg-ui-surface shadow-ui-sm transition-all duration-150',
        className
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

interface StatCardProps {
  title: string;
  value: string;
  icon: ReactNode;
  color?: string;
  trend?: string;
}

export function StatCard({ title, value, icon, color = 'navy', trend }: StatCardProps) {
  const colorMap: Record<string, { bg: string; icon: string; border: string; accent: string }> = {
    navy: { bg: 'bg-ui-page-alt', icon: 'text-ui-muted', border: 'border-ui-border', accent: 'ui-accent-neutral' },
    gold: { bg: 'bg-ui-accent/10', icon: 'text-ui-accent', border: 'border-ui-accent/25', accent: 'ui-accent-purchase' },
    brand: { bg: 'bg-ui-primary-soft', icon: 'text-ui-accent', border: 'border-ui-primary/25', accent: 'ui-accent-primary' },
    blue: { bg: 'bg-ui-info/10', icon: 'text-ui-info', border: 'border-ui-info/25', accent: 'ui-accent-primary' },
    amber: { bg: 'bg-ui-warning/10', icon: 'text-ui-warning', border: 'border-ui-warning/25', accent: 'ui-accent-purchase' },
    red: { bg: 'bg-ui-danger/10', icon: 'text-ui-danger', border: 'border-ui-danger/25', accent: 'ui-accent-alert' },
    purple: { bg: 'bg-ui-primary-soft', icon: 'text-ui-accent', border: 'border-ui-primary/25', accent: 'ui-accent-finance' },
    green: { bg: 'bg-ui-success/10', icon: 'text-ui-success', border: 'border-ui-success/25', accent: 'ui-accent-inventory' },
  };

  const c = colorMap[color] || colorMap.navy;

  return (
    <Card className={clsx('p-5 hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200', c.accent)}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-ui-muted">{title}</p>
          <p className="mt-2 text-2xl font-extrabold tracking-tight text-ui-text tabular-nums">{value}</p>
          {trend && <p className="mt-2 text-xs font-medium leading-5 text-ui-subtle">{trend}</p>}
        </div>
        <div className={clsx('w-12 h-12 rounded-2xl flex items-center justify-center border', c.bg, c.icon, c.border)}>
          {icon}
        </div>
      </div>
    </Card>
  );
}
