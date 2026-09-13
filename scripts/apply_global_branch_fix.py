from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(rel: str) -> str:
    return (ROOT / rel).read_text(encoding='utf-8')


def write(rel: str, text: str) -> None:
    (ROOT / rel).write_text(text, encoding='utf-8')


def replace_once(rel: str, old: str, new: str, label: str) -> None:
    text = read(rel)
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{rel}: expected exactly one match for {label}, found {count}')
    write(rel, text.replace(old, new, 1))


def remove_lines(rel: str, start_marker: str, end_marker: str, extra_after: int = 0, label: str = '') -> None:
    text = read(rel)
    lines = text.splitlines(keepends=True)
    starts = [i for i, line in enumerate(lines) if start_marker in line]
    if len(starts) != 1:
        raise RuntimeError(f'{rel}: expected one start for {label or start_marker}, found {len(starts)}')
    start = starts[0]
    ends = [i for i in range(start, len(lines)) if end_marker in lines[i]]
    if not ends:
        raise RuntimeError(f'{rel}: end marker missing for {label or start_marker}')
    end = ends[0] + extra_after
    if end >= len(lines):
        raise RuntimeError(f'{rel}: invalid end for {label or start_marker}')
    del lines[start:end + 1]
    write(rel, ''.join(lines))


# 1) Header is the only operational branch selector in the standard app shell.
rel = 'src/components/Layout.tsx'
replace_once(rel, '  const canSelectBranch = isAdmin || branches.length > 1;', '  const canSelectBranch = branches.length > 1;', 'header selector visibility')
replace_once(rel, "    : (ar ? 'كل الفروع' : 'All branches');", "    : (ar ? 'اختر الفرع' : 'Select branch');", 'header fallback label')
remove_lines(rel, 'data-testid="branch-option-all"', '</button>}', 0, 'all branches header option')

# 2) Dashboard follows the shared branch and reloads quick stats when it changes.
rel = 'src/features/dashboard/pages/VisualDashboardPage.tsx'
for old in [
    "import { useActiveBranchId } from '@/lib/activeBranch';\n",
    "import { isAdminRole } from '@/lib/permissions';\n",
    "import { useBranches } from '@/hooks/useBranches';\n",
    '  const { branches } = useBranches();\n',
    '  const isAdmin = isAdminRole(user?.role);\n',
    '  const [activeBranchId, setActiveBranchId] = useActiveBranchId();\n',
]:
    replace_once(rel, old, '', f'remove dashboard local branch state: {old.strip()}')
replace_once(rel, '  const effectiveBranch = isAdmin ? activeBranchId : branchFilter;', '  const effectiveBranch = branchFilter;', 'dashboard effective branch')
old = """  useEffect(() => {
    (async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
      const monthDateStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const monthDateEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;
      const [salesRes, expensesRes, inventoryRes] = await Promise.all([
        supabase.from('sales').select('total').gte('created_at', monthStart).lte('created_at', monthEnd),
        supabase.from('expenses').select('amount').gte('expense_date', monthDateStart).lte('expense_date', monthDateEnd),
        supabase.from('inventory').select('quantity, product:products(low_stock_threshold)'),
      ]);
      const totalSales = (salesRes.data || []).reduce((s: number, r: Record<string, unknown>) => s + Number(r.total || 0), 0);
      const totalExpenses = (expensesRes.data || []).reduce((s: number, r: Record<string, unknown>) => s + Number(r.amount || 0), 0);
      const lowStockCount = (inventoryRes.data || []).filter((r: Record<string, unknown>) => {
        const qty = Number(r.quantity || 0);
        const product = r.product as { low_stock_threshold?: number }[] | null;
        const threshold = Number(product?.[0]?.low_stock_threshold ?? 5);
        return qty <= threshold;
      }).length;
      setQuickStats({ sales: totalSales, expenses: totalExpenses, profit: totalSales - totalExpenses, lowStockCount });
    })();
  }, []);
"""
new = """  useEffect(() => {
    (async () => {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
      const monthDateStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
      const monthDateEnd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;
      let salesQuery = supabase.from('sales').select('total').gte('created_at', monthStart).lte('created_at', monthEnd);
      let expensesQuery = supabase.from('expenses').select('amount').gte('expense_date', monthDateStart).lte('expense_date', monthDateEnd);
      let inventoryQuery = supabase.from('inventory').select('quantity, product:products(low_stock_threshold)');
      if (effectiveBranch) {
        salesQuery = salesQuery.eq('branch_id', effectiveBranch);
        expensesQuery = expensesQuery.eq('branch_id', effectiveBranch);
        inventoryQuery = inventoryQuery.eq('branch_id', effectiveBranch);
      }
      const [salesRes, expensesRes, inventoryRes] = await Promise.all([salesQuery, expensesQuery, inventoryQuery]);
      const totalSales = (salesRes.data || []).reduce((s: number, r: Record<string, unknown>) => s + Number(r.total || 0), 0);
      const totalExpenses = (expensesRes.data || []).reduce((s: number, r: Record<string, unknown>) => s + Number(r.amount || 0), 0);
      const lowStockCount = (inventoryRes.data || []).filter((r: Record<string, unknown>) => {
        const qty = Number(r.quantity || 0);
        const product = r.product as { low_stock_threshold?: number }[] | null;
        const threshold = Number(product?.[0]?.low_stock_threshold ?? 5);
        return qty <= threshold;
      }).length;
      setQuickStats({ sales: totalSales, expenses: totalExpenses, profit: totalSales - totalExpenses, lowStockCount });
    })();
  }, [effectiveBranch]);
"""
replace_once(rel, old, new, 'branch-scoped dashboard quick stats')
remove_lines(rel, '{isAdmin && branches.length > 0 && (', '</select>', 1, 'dashboard branch selector')

# 3) Inventory server query and warehouse filter follow the active branch.
rel = 'src/features/inventory/pages/InventoryPage.tsx'
replace_once(rel, "import { useCan } from '@/lib/permissions';\n", "import { useCan } from '@/lib/permissions';\nimport { useBranchFilter } from '@/lib/useBranchFilter';\n", 'inventory branch hook import')
replace_once(rel, '  const can = useCan();\n  const { branches } = useBranches();', '  const can = useCan();\n  const branchFilter = useBranchFilter();\n  const { branches } = useBranches();', 'inventory active branch')
replace_once(rel, "    order: { column: 'updated_at', ascending: false },\n    pageSize: 100,", "    order: { column: 'updated_at', ascending: false },\n    branch_id: branchFilter,\n    pageSize: 100,", 'inventory paginated branch filter')
old = """  useEffect(() => {
    async function loadMeta() {
      const [wh, pc] = await Promise.all([
        supabase.from('warehouses').select('*').order('name'),
        supabase.from('product_components').select('component_product_id'),
      ]);
      setWarehouses((wh.data as Warehouse[]) || []);
      setComponentIds(new Set((pc.data || []).map((row: { component_product_id: string }) => row.component_product_id)));
    }
    void loadMeta();
  }, []);
"""
new = """  useEffect(() => {
    async function loadMeta() {
      let warehouseQuery = supabase.from('warehouses').select('*').order('name');
      if (branchFilter) warehouseQuery = warehouseQuery.eq('branch_id', branchFilter);
      const [wh, pc] = await Promise.all([
        warehouseQuery,
        supabase.from('product_components').select('component_product_id'),
      ]);
      setWarehouses((wh.data as Warehouse[]) || []);
      setComponentIds(new Set((pc.data || []).map((row: { component_product_id: string }) => row.component_product_id)));
    }
    setFilterWarehouse('');
    void loadMeta();
  }, [branchFilter]);
"""
replace_once(rel, old, new, 'inventory branch metadata reload')

# 4) Purchases load choices from the active branch and create there by default.
rel = 'src/features/trade/pages/PurchasesPage.tsx'
old = """  async function loadMeta() {
    const [s, pr, rm, w, u] = await Promise.all([
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('products').select('*').eq('is_active', true).order('name'),
      supabase.from('raw_materials').select('*, unit:units(*)').eq('is_active', true).order('name'),
      supabase.from('warehouses').select('*').order('name'),
      supabase.from('measurement_units').select('id,name,symbol').eq('is_active', true).order('name'),
    ]);
    setSuppliers((s.data as Supplier[]) || []);
    setProducts((pr.data as Product[]) || []);
    setRawMaterials((rm.data as RawMaterial[]) || []);
    setWarehouses((w.data as Warehouse[]) || []);
    setRawUnits((u.data as InlineRawUnit[]) || []);
  }
  useEffect(() => { void loadMeta(); }, []);
"""
new = """  async function loadMeta() {
    let supplierQuery = supabase.from('suppliers').select('*').order('name');
    let productQuery = supabase.from('products').select('*').eq('is_active', true).order('name');
    let rawMaterialQuery = supabase.from('raw_materials').select('*, unit:units(*)').eq('is_active', true).order('name');
    let warehouseQuery = supabase.from('warehouses').select('*').order('name');
    if (branchFilter) {
      supplierQuery = supplierQuery.eq('branch_id', branchFilter);
      productQuery = productQuery.eq('branch_id', branchFilter);
      rawMaterialQuery = rawMaterialQuery.eq('branch_id', branchFilter);
      warehouseQuery = warehouseQuery.eq('branch_id', branchFilter);
    }
    const [s, pr, rm, w, u] = await Promise.all([
      supplierQuery,
      productQuery,
      rawMaterialQuery,
      warehouseQuery,
      supabase.from('measurement_units').select('id,name,symbol').eq('is_active', true).order('name'),
    ]);
    setSuppliers((s.data as Supplier[]) || []);
    setProducts((pr.data as Product[]) || []);
    setRawMaterials((rm.data as RawMaterial[]) || []);
    setWarehouses((w.data as Warehouse[]) || []);
    setRawUnits((u.data as InlineRawUnit[]) || []);
  }
  useEffect(() => { void loadMeta(); }, [branchFilter]); // eslint-disable-line react-hooks/exhaustive-deps
"""
replace_once(rel, old, new, 'purchase metadata branch scope')
replace_once(rel, "      branch_id: user?.branch_id || branches[0]?.id || '',", "      branch_id: branchFilter || user?.branch_id || branches[0]?.id || '',", 'purchase create active branch')

# 5) Active Orders / floor plan follows global branch only.
rel = 'src/features/pos/pages/ActiveOrdersPage.tsx'
replace_once(rel, '  XCircle, Tag, RefreshCw, Banknote, Activity, Pause,', '  XCircle, RefreshCw, Banknote, Activity, Pause,', 'remove active orders tag icon')
replace_once(rel, "import { useCan, isAdminRole } from '@/lib/permissions';", "import { useCan } from '@/lib/permissions';", 'active orders permission import')
for old in [
    "  const [branches, setBranches] = useState<{ id: string; name: string; name_en: string | null }[]>([]);\n",
    "  const [selectedBranch, setSelectedBranch] = useState(branchFilter || '');\n",
    "  const isAdmin = isAdminRole(user?.role);\n",
]:
    replace_once(rel, old, '', f'active orders local branch cleanup: {old.strip()}')
replace_once(rel, "  const effectiveBranch = selectedBranch || branchFilter || user?.branch_id || '';", "  const effectiveBranch = branchFilter || user?.branch_id || '';", 'active orders effective branch')
old = """  useEffect(() => {
    let cancelled = false;
    Promise.all([
      supabase.from('branches').select('id, name, name_en').eq('is_active', true).order('name'),
      supabase.from('products').select('id, name, name_en').eq('is_active', true),
    ]).then(([bRes, pRes]) => {
      if (cancelled) return;
      setBranches((bRes.data as { id: string; name: string; name_en: string | null }[]) || []);
      setProducts((pRes.data as { id: string; name: string; name_en: string | null }[]) || []);
    });
    return () => { cancelled = true; };
  }, []);
"""
new = """  useEffect(() => {
    let cancelled = false;
    if (!effectiveBranch) {
      setProducts([]);
      return () => { cancelled = true; };
    }
    supabase.from('products')
      .select('id, name, name_en')
      .eq('is_active', true)
      .eq('branch_id', effectiveBranch)
      .then(({ data }) => {
        if (!cancelled) setProducts((data as { id: string; name: string; name_en: string | null }[]) || []);
      });
    return () => { cancelled = true; };
  }, [effectiveBranch]);
"""
replace_once(rel, old, new, 'active orders product branch scope')
remove_lines(rel, '{isAdmin && (', '</DesignPanel>', 1, 'active orders branch panel')

# 6) Shifts follows global branch; page-local selector removed.
rel = 'src/features/trade/pages/ShiftsPage.tsx'
replace_once(rel, "import { Input, Textarea, Select } from '@/components/Input';", "import { Input, Textarea } from '@/components/Input';", 'shifts select import')
replace_once(rel, "  const [branchSel, setBranchSel] = useState<string>(branchFilter || '');\n", '', 'shifts local branch state')
replace_once(rel, '    branch_id: branchSel || branchFilter,', '    branch_id: branchFilter,', 'shifts query branch')
replace_once(rel, "  const currency = effectiveSettings(branchSel || branchFilter)?.currency || 'EGP';", "  const currency = effectiveSettings(branchFilter)?.currency || 'EGP';", 'shifts currency branch')
replace_once(rel, "    const targetBranchId = branchSel || branchFilter || user?.branch_id || '';", "    const targetBranchId = branchFilter || user?.branch_id || '';", 'shift open branch')
remove_lines(rel, '{!branchFilter && (', '</Select>', 1, 'shifts branch selector')
replace_once(rel, "branches.find((b) => b.id === user?.branch_id)?.name", "branches.find((b) => b.id === (branchFilter || user?.branch_id))?.name", 'shift modal active branch label')

# 7) General reports follow the shared branch and do not expose a second branch selector.
rel = 'src/features/reporting/pages/ReportsPage.tsx'
replace_once(rel, "import { useAuth } from '@/context/AuthContext';\n", '', 'reports auth import')
replace_once(rel, "import { isAdminRole, useCan } from '@/lib/permissions';", "import { useCan } from '@/lib/permissions';", 'reports permission import')
replace_once(rel, '  const { user } = useAuth();\n', '', 'reports user')
replace_once(rel, "  const [adminBranchFilter, setAdminBranchFilter] = useState<string>('');\n", '', 'reports local branch state')
replace_once(rel, '  const effectiveBranchFilter = isAdminRole(user?.role) ? (adminBranchFilter || null) : branchFilter;', '  const effectiveBranchFilter = branchFilter;', 'reports effective branch')
replace_once(rel, "    : (lang === 'ar' ? 'كل الفروع' : 'All branches');", "    : (lang === 'ar' ? 'لم يتم تحديد فرع' : 'No branch selected');", 'reports branch label fallback')
old = """  useEffect(() => {
    (async () => {
      const [warehouses, cashiers, customers, suppliers, products, categories, tables] = await Promise.all([
        supabase.from('warehouses').select('id, name'),
        supabase.from('users').select('id, full_name, email'),
        supabase.from('customers').select('id, name, name_en'),
        supabase.from('suppliers').select('id, name, name_en'),
        supabase.from('products').select('id, name, name_en'),
        supabase.from('categories').select('id, name, name_en'),
        supabase.from('dining_tables').select('id, name'),
      ]);
      setOptions({
        warehouses: warehouses.data || [],
        cashiers: cashiers.data || [],
        customers: customers.data || [],
        suppliers: suppliers.data || [],
        products: products.data || [],
        categories: categories.data || [],
        tables: tables.data || [],
        expenseCategories: [],
      });
    })();
  }, []);

  useEffect(() => {
    if (reportType !== 'expenses') return;
    (async () => {
      const { data } = await supabase.from('expenses').select('category');
      const unique = Array.from(new Set((data || []).map((r) => String((r as Record<string, unknown>).category || '')).filter(Boolean)));
      setOptions((prev) => ({ ...prev, expenseCategories: unique }));
    })();
  }, [reportType]);
"""
new = """  useEffect(() => {
    if (!effectiveBranchFilter) {
      setOptions({ warehouses: [], cashiers: [], customers: [], suppliers: [], products: [], categories: [], tables: [], expenseCategories: [] });
      return;
    }
    (async () => {
      const [warehouses, cashiers, customers, suppliers, products, categories, tables] = await Promise.all([
        supabase.from('warehouses').select('id, name').eq('branch_id', effectiveBranchFilter),
        supabase.from('users').select('id, full_name, email').eq('branch_id', effectiveBranchFilter),
        supabase.from('customers').select('id, name, name_en').eq('branch_id', effectiveBranchFilter),
        supabase.from('suppliers').select('id, name, name_en').eq('branch_id', effectiveBranchFilter),
        supabase.from('products').select('id, name, name_en').eq('branch_id', effectiveBranchFilter),
        supabase.from('categories').select('id, name, name_en').eq('branch_id', effectiveBranchFilter),
        supabase.from('dining_tables').select('id, name').eq('branch_id', effectiveBranchFilter),
      ]);
      setOptions({
        warehouses: warehouses.data || [],
        cashiers: cashiers.data || [],
        customers: customers.data || [],
        suppliers: suppliers.data || [],
        products: products.data || [],
        categories: categories.data || [],
        tables: tables.data || [],
        expenseCategories: [],
      });
    })();
  }, [effectiveBranchFilter]);

  useEffect(() => {
    if (reportType !== 'expenses' || !effectiveBranchFilter) return;
    (async () => {
      const { data } = await supabase.from('expenses').select('category').eq('branch_id', effectiveBranchFilter);
      const unique = Array.from(new Set((data || []).map((r) => String((r as Record<string, unknown>).category || '')).filter(Boolean)));
      setOptions((prev) => ({ ...prev, expenseCategories: unique }));
    })();
  }, [reportType, effectiveBranchFilter]);
"""
replace_once(rel, old, new, 'reports option metadata branch scope')
replace_once(rel, '        showBranchFilter={isAdminRole(user?.role) && branches.length > 0}', '        showBranchFilter={false}', 'hide report branch selector')
replace_once(rel, '        branchFilterValue={adminBranchFilter}', "        branchFilterValue={branchFilter || ''}", 'report filter branch value')
replace_once(rel, '        onBranchFilterChange={setAdminBranchFilter}', '        onBranchFilterChange={() => undefined}', 'report filter branch handler')

# 8) Financial reports use the header branch only.
rel = 'src/features/accounting/pages/FinancialReportsPage.tsx'
replace_once(rel, "import { useBranches } from '@/hooks/useBranches';\n", '', 'financial reports branches import')
replace_once(rel, '  const { branches } = useBranches();\n', '', 'financial reports branches')
replace_once(rel, "  const [reportBranchFilter, setReportBranchFilter] = useState('');\n", '', 'financial reports local branch state')
old = """  const selectedReportBranch = reportBranchFilter && branches.some((branch) => branch.id === reportBranchFilter)
    ? reportBranchFilter
    : '';
  const effectiveBranchFilter = selectedReportBranch || branchFilter || (branches.length === 1 ? branches[0].id : null);
"""
replace_once(rel, old, '  const effectiveBranchFilter = branchFilter;\n', 'financial reports effective branch')
remove_lines(rel, '{branches.length > 1 && (', '</Select>', 1, 'financial reports branch selector')

# 9) Accounts use the header branch only.
rel = 'src/features/accounting/pages/AccountsPage.tsx'
replace_once(rel, "import { useAuth } from '@/context/AuthContext';\n", '', 'accounts auth import')
replace_once(rel, "import { useBranches } from '@/hooks/useBranches';\n", '', 'accounts branches import')
replace_once(rel, '  const { user } = useAuth();\n', '', 'accounts user')
replace_once(rel, '  const { branches } = useBranches();\n', '', 'accounts branches')
replace_once(rel, "  const [selectedBranchFilter, setSelectedBranchFilter] = useState('');\n", '', 'accounts local branch state')
old = """  const primaryBranchId = user?.branch_id && branches.some((branch) => branch.id === user.branch_id)
    ? user.branch_id
    : null;
  const effectiveBranchFilter = selectedBranchFilter
    || branchFilter
    || primaryBranchId
    || (branches.length === 1 ? branches[0].id : null);
"""
replace_once(rel, old, '  const effectiveBranchFilter = branchFilter;\n', 'accounts effective branch')
remove_lines(rel, '{branches.length > 1 && (', '</div>', 1, 'accounts branch selector')

# 10) Customer/supplier payments use the header branch only.
rel = 'src/features/accounting/pages/PaymentsPage.tsx'
replace_once(rel, "import { useAuth } from '@/context/AuthContext';\n", '', 'payments auth import')
replace_once(rel, "import { isAdminRole } from '@/lib/permissions';\n", '', 'payments admin role import')
replace_once(rel, "import { useBranches } from '@/hooks/useBranches';\n", '', 'payments branches import')
replace_once(rel, '  const { user } = useAuth();\n', '', 'payments user')
replace_once(rel, '  const { branches } = useBranches();\n', '', 'payments branches')
replace_once(rel, "  const [adminBranchFilter, setAdminBranchFilter] = useState('');\n", '', 'payments local branch state')
replace_once(rel, '  const effectiveBranchFilter = isAdminRole(user?.role) ? (adminBranchFilter || null) : branchFilter;', '  const effectiveBranchFilter = branchFilter;', 'payments effective branch')
remove_lines(rel, '{isAdminRole(user?.role) && branches.length > 0 && (', '</div>', 1, 'payments branch selector')

# 11) POS fullscreen selector writes the same shared branch used by every page.
rel = 'src/features/pos/pages/PosWorkspacePage.tsx'
replace_once(rel, "import { useBranchFilter } from '@/lib/useBranchFilter';\n", "import { useBranchFilter } from '@/lib/useBranchFilter';\nimport { useActiveBranchId } from '@/lib/activeBranch';\n", 'POS active branch import')
replace_once(rel, '  const branchFilter = useBranchFilter();\n', '  const branchFilter = useBranchFilter();\n  const [, setActiveBranchId] = useActiveBranchId();\n', 'POS active branch setter')
replace_once(rel, "  const [selectedBranch, setSelectedBranch] = useState(initState.branchId || branchFilter || '');\n", '', 'POS local branch state')
replace_once(rel, "  const effectiveBranch = selectedBranch || branchFilter || user?.branch_id || '';", "  const effectiveBranch = branchFilter || user?.branch_id || '';", 'POS effective branch')
replace_once(rel, '    setSelectedBranch(v);', '    setActiveBranchId(v);', 'POS branch change writes global store')

# 12) Server-side compound scope for incoming/outgoing cross-branch transfers.
rel = 'src/hooks/usePaginatedRows.ts'
replace_once(rel, "  /** Additional equality filters: [{ column: 'status', value: 'open' }]. */\n  filters?: { column: string; value: unknown }[];", "  /** Optional PostgREST OR expression for trusted page-defined compound scopes. */\n  or?: string;\n  /** Additional equality filters: [{ column: 'status', value: 'open' }]. */\n  filters?: { column: string; value: unknown }[];", 'paginated OR option')
replace_once(rel, "  const { table, select = '*', order, branch_id, filters, search, pageSize = 200, enabled = true } = opts;", "  const { table, select = '*', order, branch_id, or, filters, search, pageSize = 200, enabled = true } = opts;", 'paginated OR destructure')
replace_once(rel, "      if (branch_id) bq = bq.eq('branch_id', branch_id);\n      for (const f of filters ?? [])", "      if (branch_id) bq = bq.eq('branch_id', branch_id);\n      if (or) bq = bq.or(or);\n      for (const f of filters ?? [])", 'apply paginated OR filter')
replace_once(rel, '    [branch_id, filterKey, searchKey]', '    [branch_id, or, filterKey, searchKey]', 'paginated OR dependency')

rel = 'src/features/inventory/pages/TransfersPage.tsx'
replace_once(rel, "    order: { column: 'created_at', ascending: false },\n    pageSize: 100,", "    order: { column: 'created_at', ascending: false },\n    or: branchFilter ? `branch_id.eq.${branchFilter},to_branch_id.eq.${branchFilter}` : undefined,\n    pageSize: 100,", 'transfer incoming/outgoing server scope')

# Regression source contract: duplicate selectors must not return, while transfer endpoints stay explicit.
test_path = ROOT / 'tests/unit/global_branch_context.test.ts'
test_path.write_text("""import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

describe('global operational branch contract', () => {
  it('uses one required accessible branch instead of widening to all branches', () => {
    const hook = source('src/lib/useBranchFilter.ts');
    expect(hook).toContain('fallbackBranchId');
    expect(hook).not.toContain('all accessible branches');
  });

  it('removes page-local branch selectors from operational pages', () => {
    const checks: Array<[string, string[]]> = [
      ['src/components/Layout.tsx', ['branch-option-all']],
      ['src/features/dashboard/pages/VisualDashboardPage.tsx', ['dashboard-branch-filter', 'setActiveBranchId']],
      ['src/features/pos/pages/ActiveOrdersPage.tsx', ['active-orders-branch-panel', 'setSelectedBranch']],
      ['src/features/trade/pages/ShiftsPage.tsx', ['branchSel', 'setBranchSel']],
      ['src/features/reporting/pages/ReportsPage.tsx', ['adminBranchFilter', 'setAdminBranchFilter']],
      ['src/features/accounting/pages/FinancialReportsPage.tsx', ['reportBranchFilter', 'setReportBranchFilter']],
      ['src/features/accounting/pages/AccountsPage.tsx', ['selectedBranchFilter', 'setSelectedBranchFilter']],
      ['src/features/accounting/pages/PaymentsPage.tsx', ['adminBranchFilter', 'setAdminBranchFilter']],
    ];
    for (const [path, forbidden] of checks) {
      const text = source(path);
      for (const token of forbidden) expect(text, `${path} should not contain ${token}`).not.toContain(token);
    }
  });

  it('keeps cross-branch transfer source and destination explicit and paginated correctly', () => {
    const transfers = source('src/features/inventory/pages/TransfersPage.tsx');
    expect(transfers).toContain('source_branch_id');
    expect(transfers).toContain('destination_branch_id');
    expect(transfers).toContain('from_warehouse_id');
    expect(transfers).toContain('to_warehouse_id');
    expect(transfers).toContain('to_branch_id.eq.${branchFilter}');
  });

  it('POS fullscreen branch switch updates the shared active branch', () => {
    const pos = source('src/features/pos/pages/PosWorkspacePage.tsx');
    expect(pos).toContain('setActiveBranchId(v)');
    expect(pos).not.toContain('setSelectedBranch(v)');
  });
});
""", encoding='utf-8')

# Guard against known duplicate branch controls accidentally surviving this codemod.
forbidden = {
    'src/components/Layout.tsx': ['branch-option-all'],
    'src/features/dashboard/pages/VisualDashboardPage.tsx': ['dashboard-branch-filter', 'setActiveBranchId'],
    'src/features/pos/pages/ActiveOrdersPage.tsx': ['active-orders-branch-panel', 'setSelectedBranch'],
    'src/features/trade/pages/ShiftsPage.tsx': ['branchSel', 'setBranchSel'],
    'src/features/reporting/pages/ReportsPage.tsx': ['adminBranchFilter', 'setAdminBranchFilter'],
    'src/features/accounting/pages/FinancialReportsPage.tsx': ['reportBranchFilter', 'setReportBranchFilter'],
    'src/features/accounting/pages/AccountsPage.tsx': ['selectedBranchFilter', 'setSelectedBranchFilter'],
    'src/features/accounting/pages/PaymentsPage.tsx': ['adminBranchFilter', 'setAdminBranchFilter'],
}
for rel, tokens in forbidden.items():
    text = read(rel)
    for token in tokens:
        if token in text:
            raise RuntimeError(f'{rel}: forbidden duplicate branch token remains: {token}')

print('Global branch context codemod applied successfully.')
