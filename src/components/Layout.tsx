import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity, AlertTriangle, ArrowLeft, ArrowLeftRight, ArrowRight, BarChart3, BadgeDollarSign, Boxes, BookOpenText, Building2, Calculator, ChefHat,
  ChevronDown, ClipboardCheck, FileSpreadsheet, FileText, FlaskConical,
  Globe, HandCoins, Landmark, Layers, LayoutDashboard, LogOut, Menu, Moon, NotebookPen,
  Package, Receipt, Scale, ScrollText, Settings, ShoppingCart, SlidersHorizontal, Store, Sun,
  Tags, Timer, Trash2, Truck, UserCog, Users, Wallet, Warehouse, X,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useCan, isAdminRole } from '../lib/permissions';
import { useBranchFilter } from '../lib/useBranchFilter';
import { useActiveBranchId } from '../lib/activeBranch';
import { useBranches } from '@/hooks/useBranches';
import { useActiveOrders } from '../features/pos/hooks/useActiveOrders';
import { Logo } from './Logo';
import { ApprovalInbox } from './ApprovalInbox';
import { APP_ROUTES } from '@/core/navigation/routes';
import { MENU_GROUPS, MENU_ITEMS, type MenuIcon, type MenuGroup } from '@/core/navigation/menu.config';
import { CommandPalette, CommandPaletteTrigger } from './CommandPalette';
import { OfflineStatusIndicator } from './OfflineStatusIndicator';
import { ReturnContextBanner } from '@/core/guard/ReturnContextBanner';

const ICONS: Record<MenuIcon, ReactNode> = {
  dashboard: <LayoutDashboard className="h-5 w-5" />,
  pos: <ShoppingCart className="h-5 w-5" />,
  products: <Package className="h-5 w-5" />,
  productModifiers: <SlidersHorizontal className="h-5 w-5" />,
  categories: <Tags className="h-5 w-5" />,
  components: <Layers className="h-5 w-5" />,
  rawMaterials: <FlaskConical className="h-5 w-5" />,
  recipes: <ChefHat className="h-5 w-5" />,
  inventory: <Boxes className="h-5 w-5" />,
  warehouses: <Warehouse className="h-5 w-5" />,
  transfers: <ArrowLeftRight className="h-5 w-5" />,
  inventoryLedger: <BookOpenText className="h-5 w-5" />,
  stockCounts: <ClipboardCheck className="h-5 w-5" />,
  inventoryBatches: <Layers className="h-5 w-5" />,
  stockValuation: <BadgeDollarSign className="h-5 w-5" />,
  lowStockAlerts: <AlertTriangle className="h-5 w-5" />,
  inventoryUnits: <Package className="h-5 w-5" />,
  wasteCenter: <Trash2 className="h-5 w-5" />,
  kitchenDisplay: <ChefHat className="h-5 w-5" />,
  kitchenStations: <SlidersHorizontal className="h-5 w-5" />,
  costingCenter: <Calculator className="h-5 w-5" />,
  branches: <Store className="h-5 w-5" />,
  purchases: <Truck className="h-5 w-5" />,
  customers: <Users className="h-5 w-5" />,
  suppliers: <Building2 className="h-5 w-5" />,
  expenses: <Receipt className="h-5 w-5" />,
  accounts: <Landmark className="h-5 w-5" />,
  payments: <HandCoins className="h-5 w-5" />,
  journal: <NotebookPen className="h-5 w-5" />,
  treasury: <Wallet className="h-5 w-5" />,
  reconciliation: <Scale className="h-5 w-5" />,
  financialReports: <FileSpreadsheet className="h-5 w-5" />,
  sales: <FileText className="h-5 w-5" />,
  shifts: <Timer className="h-5 w-5" />,
  reports: <BarChart3 className="h-5 w-5" />,
  users: <UserCog className="h-5 w-5" />,
  auditLog: <ScrollText className="h-5 w-5" />,
  settings: <Settings className="h-5 w-5" />,
  superAdmin: <SlidersHorizontal className="h-5 w-5 text-brand-500" />,
  importExport: <FileSpreadsheet className="h-5 w-5" />,
};

export function Layout({ children }: { children: ReactNode }) {
  const { t, lang, setLang } = useLanguage();
  const { theme, toggleTheme } = useTheme();
  const { user, signOut } = useAuth();
  const can = useCan();
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const ar = lang === 'ar';
  const branchFilter = useBranchFilter();
  const { counts } = useActiveOrders(branchFilter || user?.branch_id || '');

  const isAdmin = isAdminRole(user?.role);
  const canViewFloorPlan = can('floor_plan.view');
  const canOpenSettings = can('settings.manage');
  const { branches } = useBranches();
  const [, setActiveBranchId] = useActiveBranchId();
  const [branchMenuOpen, setBranchMenuOpen] = useState(false);
  const branchMenuRef = useRef<HTMLDivElement>(null);
  const canSelectBranch = branches.length > 1;
  const effectiveBranch = branchFilter ?? null;
  const activeBranch = branches.find((b) => b.id === effectiveBranch) ?? null;
  const branchLabel = activeBranch
    ? (lang === 'ar' ? activeBranch.name : activeBranch.name_en || activeBranch.name)
    : (ar ? 'اختر الفرع' : 'Select branch');
  const showBackButton = location.pathname !== APP_ROUTES.dashboard;

  useEffect(() => {
    if (!branchMenuOpen) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (branchMenuRef.current && !branchMenuRef.current.contains(e.target as Node)) {
        setBranchMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
    };
  }, [branchMenuOpen]);

  const visibleItems = useMemo(
    () => MENU_ITEMS.filter((item) =>
      (!item.permission || can(item.permission)) &&
      (!item.superAdminOnly || user?.role === 'super_admin') &&
      (!item.ownerOnly || isAdmin),
    ),
    [can, user?.role, isAdmin],
  );
  const grouped = useMemo(() => visibleItems.reduce<Record<MenuGroup, typeof visibleItems>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, {} as Record<MenuGroup, typeof visibleItems>), [visibleItems]);

  return (
    <div dir={ar ? 'rtl' : 'ltr'} className="min-h-screen bg-ui-page text-ui-text overflow-x-hidden" data-testid="app-shell">
      <header data-testid="app-header" className="fixed top-0 start-0 end-0 lg:start-[260px] z-[60] flex h-[64px] items-center justify-between gap-3 liquid-glass-header px-4 shadow-ui-sm sm:px-6">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <button data-testid="sidebar-open" type="button" onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-ui-muted hover:bg-ui-page-alt lg:hidden" aria-label={ar ? 'فتح القائمة' : 'Open sidebar'}>
            <Menu className="h-5 w-5" />
          </button>
          {showBackButton && (
            <button
              data-testid="header-back-button"
              type="button"
              onClick={() => {
                if (window.history.length > 1) navigate(-1);
                else navigate(APP_ROUTES.dashboard);
              }}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl border border-ui-border bg-ui-surface px-2.5 text-xs font-black text-ui-text shadow-ui-xs transition hover:bg-ui-page-alt active:scale-95 sm:px-3"
              aria-label={ar ? 'رجوع' : 'Back'}
              title={ar ? 'رجوع' : 'Back'}
            >
              {ar ? <ArrowRight className="h-4 w-4" /> : <ArrowLeft className="h-4 w-4" />}
              <span className="hidden sm:inline">{ar ? 'رجوع' : 'Back'}</span>
            </button>
          )}
          <CommandPaletteTrigger />
        </div>

        <div className="relative flex items-center gap-1.5 sm:gap-2" ref={branchMenuRef}>
          <div className="relative">
            <button
              data-testid="branch-indicator"
              type="button"
              onClick={canSelectBranch ? () => setBranchMenuOpen((v) => !v) : undefined}
              aria-expanded={canSelectBranch ? branchMenuOpen : undefined}
              aria-label={ar ? 'الفرع النشط' : 'Active branch'}
              className={`flex items-center gap-2 rounded-xl border border-ui-border px-3 py-1.5 text-xs font-semibold text-ui-text transition-colors ${canSelectBranch ? 'hover:bg-ui-page-alt' : 'cursor-default'}`}
            >
              <Building2 className="h-4 w-4 shrink-0 text-ui-primary" />
              <span className="max-w-[140px] truncate">{branchLabel}</span>
              {canSelectBranch && <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-ui-muted transition-transform duration-150 ${branchMenuOpen ? 'rotate-180' : ''}`} />}
            </button>
            {canSelectBranch && branchMenuOpen && (
              <div data-testid="branch-menu" className="absolute end-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-ui-border bg-ui-surface py-1 shadow-ui-lg animate-slide-down">
                {branches.map((b) => (
                  <button key={b.id} data-testid={`branch-option-${b.id}`} type="button" onClick={() => { setActiveBranchId(b.id); setBranchMenuOpen(false); }} className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors ${effectiveBranch === b.id ? 'bg-ui-primary-soft font-bold text-ui-primary' : 'text-ui-muted hover:bg-ui-page-alt'}`}>
                    <span className="truncate">{lang === 'ar' ? b.name : (b.name_en || b.name)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="hidden sm:flex"><OfflineStatusIndicator /></div>
          <ApprovalInbox ar={ar} />
          {canViewFloorPlan && (
            <button data-testid="active-orders-button" type="button" onClick={() => navigate(APP_ROUTES.floorPlan)} className="relative rounded-xl p-2 text-ui-muted transition-colors hover:bg-ui-page-alt hover:text-ui-text" aria-label={ar ? 'الطلبات النشطة' : 'Active orders'}>
              <Activity className="h-5 w-5" />
              {counts.active > 0 && <span data-testid="active-orders-count" className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-ui-danger px-1 text-[9px] font-bold text-ui-primary-fg">{counts.active}</span>}
            </button>
          )}
          <div className="hidden h-6 w-px bg-ui-border sm:block" />
          <button
            data-testid="user-menu-button"
            type="button"
            onClick={canOpenSettings ? () => navigate(APP_ROUTES.settings) : undefined}
            disabled={!canOpenSettings}
            aria-label={canOpenSettings ? (ar ? 'فتح الإعدادات' : 'Open settings') : (ar ? 'هوية المستخدم' : 'User identity')}
            title={canOpenSettings ? (ar ? 'الإعدادات' : 'Settings') : undefined}
            className={`flex items-center gap-2.5 rounded-xl p-1.5 pe-2 transition-colors ${canOpenSettings ? 'hover:bg-ui-page-alt' : 'cursor-default'}`}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-ui-primary-soft text-xs font-bold text-ui-primary">{(user?.full_name || user?.email || 'A').slice(0, 1).toUpperCase()}</div>
            <div className="hidden text-start sm:block">
              <p className="text-sm font-semibold leading-tight text-ui-text">{user?.full_name || user?.email || (ar ? 'مدير النظام' : 'System Admin')}</p>
              <p className="text-[10px] leading-tight text-ui-subtle">{user?.role || 'admin'}</p>
            </div>
          </button>
          <button data-testid="language-toggle" type="button" onClick={() => setLang(ar ? 'en' : 'ar')} className="hidden items-center gap-1.5 rounded-xl border border-ui-border px-2.5 py-1.5 text-xs font-semibold text-ui-muted transition-colors hover:bg-ui-page-alt sm:flex">
            <Globe className="h-3.5 w-3.5" /><span className="hidden md:inline">{ar ? 'العربية' : 'English'}</span>
          </button>
          <button data-testid="theme-toggle" type="button" onClick={toggleTheme} className="rounded-xl p-2 text-ui-muted transition-colors hover:bg-ui-page-alt hover:text-ui-text" aria-label={ar ? 'تغيير المظهر' : 'Toggle theme'}>
            {theme === 'light' ? <Moon className="h-4.5 w-4.5" /> : <Sun className="h-4.5 w-4.5" />}
          </button>
          <button data-testid="sign-out-button" type="button" onClick={signOut} className="rounded-xl p-2 text-ui-subtle transition-colors hover:bg-ui-danger-soft hover:text-ui-danger" aria-label={ar ? 'تسجيل الخروج' : 'Sign out'}>
            <LogOut className="h-4.5 w-4.5" />
          </button>
        </div>
      </header>

      <aside data-testid="app-sidebar" className={`fixed top-0 bottom-0 start-0 z-50 w-[260px] liquid-glass border-e border-ui-border shadow-ui-md transition-transform duration-200 ease-[var(--ui-ease)] ${mobileOpen ? 'translate-x-0' : ar ? 'translate-x-full' : '-translate-x-full'} lg:translate-x-0`}>
        <div className="flex h-14 items-center justify-between border-b border-ui-border px-5">
          <Logo variant="horizontal" size={28} tone="mono" showTagline={false} className="text-ui-primary" />
          <button data-testid="sidebar-close" type="button" onClick={() => setMobileOpen(false)} className="rounded-lg p-2 text-ui-muted hover:bg-ui-page-alt lg:hidden" aria-label={ar ? 'إغلاق القائمة' : 'Close sidebar'}><X className="h-5 w-5" /></button>
        </div>
        <nav data-testid="app-navigation" className="h-[calc(100%-56px)] overflow-y-auto px-3 py-4">
          {(Object.keys(MENU_GROUPS) as MenuGroup[]).map((group) => {
            const items = grouped[group] ?? [];
            if (!items.length) return null;
            return (
              <section key={group} data-testid={`nav-group-${group}`} className="mb-3">
                <button data-testid={`nav-group-toggle-${group}`} type="button" onClick={() => setCollapsed((v) => ({ ...v, [group]: !v[group] }))} className="flex w-full items-center justify-between px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-ui-subtle">
                  <span>{MENU_GROUPS[group][ar ? 'ar' : 'en']}</span>
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-150 ${collapsed[group] ? 'rotate-90' : ''}`} />
                </button>
                {!collapsed[group] && (
                  <div className="mt-1 space-y-0.5">
                    {items.map((item) => (
                      <NavLink
                        data-testid={`nav-item-${item.id}`}
                        key={item.id}
                        to={item.route}
                        onClick={() => setMobileOpen(false)}
                        className={({ isActive }) => `group flex min-h-[40px] items-center gap-3 rounded-xl px-3 text-sm font-medium transition-all duration-150 ${isActive ? 'bg-ui-primary text-ui-primary-fg shadow-[0_4px_12px_rgba(91,43,216,0.18)]' : 'text-ui-muted hover:bg-ui-primary-soft hover:text-ui-primary'}`}
                      >
                        {ICONS[item.icon]}
                        <span className="flex-1 truncate">{item.label ? item.label[ar ? 'ar' : 'en'] : item.labelKey ? t(item.labelKey) : item.id}</span>
                      </NavLink>
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </nav>
      </aside>

      {mobileOpen && <button data-testid="mobile-sidebar-backdrop" type="button" className="fixed inset-0 z-40 bg-ui-text/20 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} aria-label={ar ? 'إغلاق' : 'Close'} />}

      <div className="pt-[64px] lg:ms-[260px] min-h-screen">
        <ReturnContextBanner />
        <main data-testid="app-main" className="min-h-[calc(100vh-64px)] bg-ui-page p-4 sm:p-6 lg:p-7">
          <div data-testid="design-content-surface" className="mx-auto min-h-[calc(100vh-64px)] w-full max-w-[1600px] space-y-5">{children}</div>
        </main>
      </div>
      <CommandPalette />
    </div>
  );
}
