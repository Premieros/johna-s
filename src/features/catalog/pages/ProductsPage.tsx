import { useEffect, useState, useRef, useCallback } from 'react';
import { Plus, Edit2, Trash2, Download, Upload, Barcode as BarcodeIcon, QrCode } from 'lucide-react';
import { supabase } from '@/api';
import * as api from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { DesignSurface, DesignPageHeader } from '@/components/design/DesignSurface';
import { DesignSearch } from '@/components/design/DesignSearch';
import { DesignPanel } from '@/components/design/DesignPanel';
import { DesignPagination } from '@/components/design/DesignPagination';
import { DataTable, type Column } from '@/components/DataTable';
import { Button } from '@/components/Button';
import { Input, Select, Textarea } from '@/components/Input';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { BranchBadge } from '@/components/BranchBadge';
import { formatCurrency, formatNumber } from '@/lib/format';
import { exportToExcel, importFromExcel } from '@/lib/excel';
import { renderBarcode, generateQRCodeDataURL } from '@/lib/barcode';
import { logAudit } from '@/lib/audit';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useCan } from '@/lib/permissions';
import { useSettings } from '@/context/SettingsContext';
import { useBranches } from '@/hooks/useBranches';
import { usePaginatedRows } from '@/hooks/usePaginatedRows';
import { invalidatePosCatalogCache } from '@/core/offline/invalidatePosCatalogCache';
import type { Product, Category, ProductUnit, ProductComponentInput } from '@/lib/types';

const UNIT_NAMES = ['piece', 'carton', 'box', 'pack', 'kg', 'liter', 'meter', 'gram'];

type OperationalIngredient = { raw_material_id: string; quantity: number; raw_material?: { name: string } | null };
type LinkedInventoryUnit = { unit_id: string; quantity: number; unit?: { id: string; name: string; unit_type: 'ready' | 'manufactured'; cost_price: number } | null };
type ManufacturedInventoryUnit = { id: string; name: string; unit_type: 'manufactured'; cost_price: number; branch_id: string | null };

export function ProductsPage() {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const can = useCan();
  const branchFilter = useBranchFilter();
  const [search, setSearch] = useState('');
  const { rows: products, loading, total, hasMore, loadMore, loadingMore, refresh: reloadProducts } = usePaginatedRows<Product>({
    table: 'products',
    select: '*, category:categories(*)',
    order: { column: 'created_at', ascending: false },
    branch_id: branchFilter,
    search: { term: search, columns: ['name', 'name_en', 'barcode', 'sku'] },
    pageSize: 100,
  });
  const [categories, setCategories] = useState<Category[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [barcodeModal, setBarcodeModal] = useState<Product | null>(null);
  const [qrModal, setQrModal] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const barcodeCanvasRef = useRef<HTMLCanvasElement>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const { effectiveSettings } = useSettings();
  const { branches } = useBranches();
  const currency = effectiveSettings(branchFilter)?.currency || 'EGP';
  const branchLabel = (id: string | null | undefined) => branches.find((b) => b.id === id)?.name || '';

  const [form, setForm] = useState({
    name: '', name_en: '', barcode: '', sku: '', category_id: '', description: '',
    cost_price: 0, sale_price: 0, wholesale_price: 0, image_url: '', is_active: true, low_stock_threshold: 5, min_stock: 0, max_stock: 0, reorder_point: 0, product_type: 'ready' as 'ready' | 'manufactured',
    branch_id: '',
  });
  const [units, setUnits] = useState<ProductUnit[]>([]);
  const [productComponents, setProductComponents] = useState<ProductComponentInput[]>([]);
  const [stockComponents, setStockComponents] = useState<{ product_id: string; name: string; total: number; cost_price: number }[]>([]);
  const [componentSel, setComponentSel] = useState('');
  const [componentQty, setComponentQty] = useState(1);
  const [recipeIngredients, setRecipeIngredients] = useState<OperationalIngredient[]>([]);
  const [recipeYield, setRecipeYield] = useState(1);
  const [linkedInventoryUnits, setLinkedInventoryUnits] = useState<LinkedInventoryUnit[]>([]);
  const [manufacturedInventoryUnits, setManufacturedInventoryUnits] = useState<ManufacturedInventoryUnit[]>([]);
  const [linkedUnitSel, setLinkedUnitSel] = useState('');
  const [linkedUnitQty, setLinkedUnitQty] = useState(1);

  const loadStockComponents = useCallback(async () => {
    let invQuery = supabase.from('inventory').select('product_id, quantity, product:products(id, name, cost_price, is_active)');
    if (branchFilter) {
      const { data: whs } = await supabase.from('warehouses').select('id').eq('branch_id', branchFilter).eq('is_active', true);
      const ids = ((whs as { id: string }[] | null) || []).map((w) => w.id);
      if (ids.length === 0) { setStockComponents([]); return; }
      invQuery = invQuery.in('warehouse_id', ids);
    }
    const { data } = await invQuery;
    const totals: Record<string, { name: string; cost_price: number; total: number }> = {};
    for (const row of ((data || []) as unknown as { product_id: string; quantity: number; product: { id: string; name: string; cost_price: number; is_active: boolean } | null }[])) {
      if (!row.product || !row.product.is_active) continue;
      const t = totals[row.product_id] || { name: row.product.name, cost_price: row.product.cost_price, total: 0 };
      t.total += Number(row.quantity) || 0;
      totals[row.product_id] = t;
    }
    setStockComponents(Object.entries(totals).filter(([, v]) => v.total > 0).map(([product_id, v]) => ({ product_id, name: v.name, total: v.total, cost_price: v.cost_price })).sort((a, b) => a.name.localeCompare(b.name)));
  }, [branchFilter]);

  const loadMeta = useCallback(async () => {
    let cq = supabase.from('categories').select('*');
    if (branchFilter) cq = cq.eq('branch_id', branchFilter);
    const { data: c } = await cq.order('name');
    setCategories((c as Category[]) || []);
    await loadStockComponents();
  }, [branchFilter, loadStockComponents]);

  useEffect(() => { loadMeta(); }, [loadMeta]);

  const filtered = products;
  const availableToAdd = stockComponents.filter((s) => s.product_id !== editing?.id && !productComponents.some((c) => c.component_product_id === s.product_id));
  const availableManufacturedToAdd = manufacturedInventoryUnits.filter((unit) => !linkedInventoryUnits.some((row) => row.unit_id === unit.id));

  const openAdd = () => { window.location.hash = '/products/setup'; };

  const openEdit = async (p: Product) => {
    setEditing(p);
    setForm({ name: p.name, name_en: p.name_en || '', barcode: p.barcode || '', sku: p.sku || '', category_id: p.category_id || '', description: p.description || '', cost_price: p.cost_price, sale_price: p.sale_price, wholesale_price: p.wholesale_price, image_url: p.image_url || '', is_active: p.is_active, low_stock_threshold: p.low_stock_threshold, min_stock: p.min_stock ?? 0, max_stock: p.max_stock ?? 0, reorder_point: p.reorder_point ?? 0, product_type: p.product_type || 'ready', branch_id: p.branch_id || branchFilter || '' });
    const [u, comps] = await Promise.all([
      supabase.from('product_units').select('*').eq('product_id', p.id),
      supabase.from('product_components').select('component_product_id, quantity').eq('product_id', p.id),
    ]);
    setUnits((u.data as ProductUnit[]) || [{ id: '', product_id: p.id, unit_name: 'piece', unit_name_en: 'piece', conversion_factor: 1, sale_price: p.sale_price, cost_price: p.cost_price, barcode: p.barcode || '', is_base: true, created_at: '' }]);
    setProductComponents(((comps.data as { component_product_id: string; quantity: number }[] | null) || []).map((c) => ({ component_product_id: c.component_product_id, quantity: Number(c.quantity) || 1 })));
    const effectiveProductBranch = p.branch_id || branchFilter || '';
    let recipeRows: OperationalIngredient[] = [];
    let currentYield = 1;
    if (effectiveProductBranch) {
      const { data: recipe } = await supabase.from('recipes').select('id,yield_quantity').eq('product_id', p.id).eq('branch_id', effectiveProductBranch).eq('is_active', true).order('version', { ascending: false }).order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (recipe?.id) {
        currentYield = Number(recipe.yield_quantity) || 1;
        const { data: recipeItems } = await supabase.from('recipe_items').select('raw_material_id,quantity,raw_material:raw_materials(name)').eq('recipe_id', recipe.id);
        recipeRows = ((recipeItems || []) as unknown as OperationalIngredient[]).map((row) => ({ ...row, quantity: Number(row.quantity) || 0 }));
      }
    }
    const { data: inventoryLinks } = await supabase.from('product_unit_links').select('unit_id,quantity,unit:inventory_units(id,name,unit_type,cost_price)').eq('product_id', p.id);
    const displayInventoryLinks = ((inventoryLinks || []) as unknown as LinkedInventoryUnit[]).map((row) => ({ ...row, quantity: Number(row.quantity) || 0 }));
    if (effectiveProductBranch) {
      const { data: manufacturedUnits, error: manufacturedUnitsError } = await supabase.from('inventory_units').select('id,name,unit_type,cost_price,branch_id').eq('branch_id', effectiveProductBranch).eq('unit_type', 'manufactured').eq('is_active', true).order('name');
      if (manufacturedUnitsError) show(manufacturedUnitsError.message, 'error');
      setManufacturedInventoryUnits(((manufacturedUnits || []) as unknown as ManufacturedInventoryUnit[]));
    } else {
      setManufacturedInventoryUnits([]);
    }
    setRecipeYield(currentYield);
    setRecipeIngredients(recipeRows);
    setLinkedInventoryUnits(displayInventoryLinks);
    setLinkedUnitSel('');
    setLinkedUnitQty(1);
    setComponentSel('');
    setComponentQty(1);
    setModalOpen(true);
  };

  const save = async () => {
    if (editing ? !can('products.edit') : !can('products.create')) return;
    if (!form.name) { show(t('required') + ': ' + t('name'), 'error'); return; }
    const effectiveBranch = form.branch_id || branchFilter || '';
    if (!effectiveBranch) { show(lang === 'ar' ? 'اختر الفرع أولاً' : 'Select a branch first', 'error'); return; }
    if (form.product_type === 'manufactured' && productComponents.length === 0 && recipeIngredients.length === 0 && linkedInventoryUnits.length === 0) { show(t('manufacturedRequiresComponents'), 'error'); return; }
    if (linkedInventoryUnits.some((row) => row.quantity <= 0 || !manufacturedInventoryUnits.some((unit) => unit.id === row.unit_id && unit.branch_id === effectiveBranch))) { show(lang === 'ar' ? 'تحقق من المصنعات وكمياتها للفرع الحالي' : 'Check manufactured items and quantities for the current branch', 'error'); return; }
    const payload = { ...form, category_id: form.category_id || null, branch_id: effectiveBranch };
    const unitPayload = units.filter(u => u.unit_name).map((u) => ({ unit_name: u.unit_name, unit_name_en: u.unit_name_en || u.unit_name, conversion_factor: u.conversion_factor, sale_price: u.sale_price, cost_price: u.cost_price, barcode: u.barcode || null, is_base: u.is_base }));
    let pid: string;
    if (editing) {
      const { error } = await supabase.from('products').update(payload).eq('id', editing.id);
      if (error) { show(error.message, 'error'); return; }
      pid = editing.id;
      const { error: unitError } = await api.catalog.replaceProductUnits({ p_product_id: editing.id, p_units: unitPayload });
      if (unitError) { show(unitError.message, 'error'); return; }
      await logAudit('update', 'products', editing.id, { name: form.name });
    } else {
      const { data, error } = await api.catalog.createProduct({
        p_name: payload.name,
        p_name_en: payload.name_en || null,
        p_barcode: payload.barcode || null,
        p_sku: payload.sku || null,
        p_category_id: payload.category_id || null,
        p_branch_id: effectiveBranch,
        p_description: payload.description || null,
        p_image_url: payload.image_url || null,
        p_cost_price: payload.cost_price,
        p_sale_price: payload.sale_price,
        p_wholesale_price: payload.wholesale_price,
        p_low_stock_threshold: payload.low_stock_threshold,
        p_min_stock: payload.min_stock,
        p_max_stock: payload.max_stock,
        p_reorder_point: payload.reorder_point,
        p_product_type: payload.product_type,
        p_is_active: payload.is_active,
        p_units: unitPayload.length > 0 ? unitPayload : null,
      });
      if (error || !data || data.success === false) { show(error?.message || data?.error || 'error', 'error'); return; }
      pid = data.product_id!;
    }

    if (editing) {
      const { data: existingLinks, error: existingLinksError } = await supabase.from('product_unit_links').select('unit_id').eq('product_id', pid);
      if (existingLinksError) { show(existingLinksError.message, 'error'); return; }
      const existingIds = new Set(((existingLinks || []) as { unit_id: string }[]).map((row) => row.unit_id));
      const desiredLinks = form.product_type === 'manufactured' ? linkedInventoryUnits : [];
      const desiredIds = new Set(desiredLinks.map((row) => row.unit_id));
      const removedIds = [...existingIds].filter((unitId) => !desiredIds.has(unitId));
      if (removedIds.length > 0) {
        const { error: linkDeleteError } = await supabase.from('product_unit_links').delete().eq('product_id', pid).in('unit_id', removedIds);
        if (linkDeleteError) { show(linkDeleteError.message, 'error'); return; }
      }
      for (const row of desiredLinks) {
        if (existingIds.has(row.unit_id)) {
          const { error: linkUpdateError } = await supabase.from('product_unit_links').update({ quantity: row.quantity }).eq('product_id', pid).eq('unit_id', row.unit_id);
          if (linkUpdateError) { show(linkUpdateError.message, 'error'); return; }
        } else {
          const { error: linkInsertError } = await supabase.from('product_unit_links').insert({ product_id: pid, unit_id: row.unit_id, quantity: row.quantity });
          if (linkInsertError) { show(linkInsertError.message, 'error'); return; }
        }
      }
    }

    const usesOperationalComposition = recipeIngredients.length > 0 || linkedInventoryUnits.length > 0;
    if (!usesOperationalComposition) {
      const { error: compDelError } = await supabase.from('product_components').delete().eq('product_id', pid);
      if (compDelError) { show(compDelError.message, 'error'); return; }
      if (form.product_type === 'manufactured' && productComponents.length > 0) {
        const { error: compInsError } = await supabase.from('product_components').insert(productComponents.map((c) => ({ product_id: pid, component_product_id: c.component_product_id, quantity: c.quantity })));
        if (compInsError) { show(compInsError.message, 'error'); return; }
      }
    }
    show(t('saveSuccess'), 'success');
    setModalOpen(false);
    await invalidatePosCatalogCache();
    reloadProducts();
  };

  const addComponentRow = () => { if (!componentSel) { show(t('required'), 'error'); return; } setProductComponents([...productComponents, { component_product_id: componentSel, quantity: componentQty > 0 ? componentQty : 1 }]); setComponentSel(''); setComponentQty(1); };
  const updateComponentQty = (i: number, qty: number) => setProductComponents(productComponents.map((c, idx) => idx === i ? { ...c, quantity: qty > 0 ? qty : 1 } : c));
  const removeComponentRow = (i: number) => setProductComponents(productComponents.filter((_, idx) => idx !== i));
  const addLinkedInventoryUnit = () => {
    if (!linkedUnitSel) { show(t('required'), 'error'); return; }
    const unit = manufacturedInventoryUnits.find((item) => item.id === linkedUnitSel);
    if (!unit || linkedInventoryUnits.some((row) => row.unit_id === linkedUnitSel)) return;
    setLinkedInventoryUnits([...linkedInventoryUnits, { unit_id: unit.id, quantity: linkedUnitQty > 0 ? linkedUnitQty : 1, unit }]);
    setLinkedUnitSel('');
    setLinkedUnitQty(1);
  };
  const updateLinkedInventoryUnitQty = (i: number, qty: number) => setLinkedInventoryUnits(linkedInventoryUnits.map((row, idx) => idx === i ? { ...row, quantity: qty > 0 ? qty : 1 } : row));
  const removeLinkedInventoryUnit = (i: number) => setLinkedInventoryUnits(linkedInventoryUnits.filter((_, idx) => idx !== i));

  const remove = async () => {
    if (!deleteId || !can('products.delete')) return;
    const { error } = await supabase.from('products').delete().eq('id', deleteId);
    if (error) show(error.message, 'error'); else { show(t('deleteSuccess'), 'success'); await logAudit('delete', 'products', deleteId); }
    setDeleteId(null);
    await invalidatePosCatalogCache();
    reloadProducts();
  };

  const handleExport = () => { exportToExcel(products.map(p => ({ Name: p.name, NameEn: p.name_en || '', Barcode: p.barcode || '', SKU: p.sku || '', ProductType: p.product_type || 'ready', CostPrice: p.cost_price, SalePrice: p.sale_price, WholesalePrice: p.wholesale_price, Category: p.category?.name || '', Active: p.is_active, LowStockThreshold: p.low_stock_threshold, MinStock: p.min_stock ?? 0, MaxStock: p.max_stock ?? 0, ReorderPoint: p.reorder_point ?? 0 })), 'products'); };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (!branchFilter) { show(lang === 'ar' ? 'اختر الفرع قبل استيراد المنتجات' : 'Select a branch before importing products', 'error'); e.target.value = ''; return; }
    try {
      const rows = await importFromExcel(file);
      const payload = rows.map((r) => ({ name: String(r.Name || r.name || ''), name_en: String(r.NameEn || r.name_en || ''), barcode: String(r.Barcode || r.barcode || ''), sku: String(r.SKU || r.sku || ''), product_type: String(r.ProductType || r.product_type || 'ready') === 'manufactured' ? 'manufactured' as const : 'ready' as const, cost_price: Number(r.CostPrice || r.cost_price || 0), sale_price: Number(r.SalePrice || r.sale_price || 0), wholesale_price: Number(r.WholesalePrice || r.wholesale_price || 0), is_active: true, low_stock_threshold: Number(r.LowStockThreshold || 5), min_stock: Number(r.MinStock || r.min_stock || 0), max_stock: Number(r.MaxStock || r.max_stock || 0), reorder_point: Number(r.ReorderPoint || r.reorder_point || 0), branch_id: branchFilter })).filter(r => r.name);
      if (payload.length === 0) { show('No valid rows', 'error'); return; }
      const { error } = await supabase.from('products').insert(payload);
      if (error) show(error.message, 'error'); else { show(`${payload.length} ${t('import')} OK`, 'success'); await invalidatePosCatalogCache(); reloadProducts(); }
    } catch (err) { show(String(err), 'error'); }
  };

  const showBarcode = (p: Product) => { setBarcodeModal(p); setTimeout(() => { if (barcodeCanvasRef.current) renderBarcode(barcodeCanvasRef.current, p.barcode || p.id); }, 100); };
  const showQR = async (p: Product) => { const url = await generateQRCodeDataURL(JSON.stringify({ id: p.id, name: p.name, barcode: p.barcode, price: p.sale_price })); setQrDataUrl(url); setQrModal(p.id); };
  const addUnit = () => setUnits([...units, { id: '', product_id: '', unit_name: 'box', unit_name_en: 'box', conversion_factor: 10, sale_price: 0, cost_price: 0, barcode: '', is_base: false, created_at: '' }]);
  const updateUnit = (i: number, field: keyof ProductUnit, value: string | number | boolean) => setUnits(units.map((u, idx) => idx === i ? { ...u, [field]: value } : u));
  const removeUnit = (i: number) => setUnits(units.filter((_, idx) => idx !== i));

  const columns: Column<Product>[] = [
    { key: 'name', header: t('productName'), render: (p) => <div className="flex items-center gap-2"><div className="w-9 h-9 rounded-lg bg-ui-page-alt flex items-center justify-center flex-shrink-0">{p.image_url ? <img src={p.image_url} alt="" className="w-full h-full rounded-lg object-cover" /> : <BarcodeIcon className="w-4 h-4 text-ui-subtle" />}</div><div><p className="font-medium text-ui-text">{p.name}</p><p className="text-xs text-ui-subtle">{p.barcode || '-'}</p></div>{p.product_type === 'manufactured' && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">{t('manufactured')}</span>}</div> },
    { key: 'category', header: t('category'), render: (p) => p.category?.name || '-' },
    { key: 'branch', header: t('branch'), render: (p) => <BranchBadge name={branchLabel(p.branch_id)} /> },
    { key: 'cost_price', header: t('costPrice'), render: (p) => formatCurrency(p.cost_price, currency, lang) },
    { key: 'sale_price', header: t('salePrice'), render: (p) => <span className="font-semibold text-brand-600 dark:text-brand-400">{formatCurrency(p.sale_price, currency, lang)}</span> },
    { key: 'wholesale_price', header: t('wholesalePrice'), render: (p) => formatCurrency(p.wholesale_price, currency, lang) },
    { key: 'is_active', header: t('status'), render: (p) => <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${p.is_active ? 'bg-ui-success-soft text-ui-success' : 'bg-ui-page-alt text-ui-subtle dark:text-ui-subtle'}`}>{p.is_active ? t('active') : t('inactive')}</span> },
    { key: 'actions', header: t('actions'), render: (p) => <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}><button onClick={() => showBarcode(p)} className="p-1.5 rounded-md hover:bg-ui-page-alt text-ui-subtle" title={t('barcode')}><BarcodeIcon className="w-4 h-4" /></button><button onClick={() => showQR(p)} className="p-1.5 rounded-md hover:bg-ui-page-alt text-ui-subtle" title={t('generateQR')}><QrCode className="w-4 h-4" /></button>{can('products.edit') && <button onClick={() => openEdit(p)} className="p-1.5 rounded-md hover:bg-ui-info-soft text-ui-info" title={t('edit')}><Edit2 className="w-4 h-4" /></button>}{can('products.delete') && <button onClick={() => setDeleteId(p.id)} className="p-1.5 rounded-md hover:bg-ui-danger-soft text-ui-danger" title={t('delete')}><Trash2 className="w-4 h-4" /></button>}</div> },
  ];

  return (
    <DesignSurface testId="products-page">
      <DesignPageHeader title={t('products')} actions={<>{can('products.import') && <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleImport} data-testid="products-import" />}{can('products.import') && <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} data-testid="products-import-button"><Upload className="w-4 h-4" /> {t('importExcel')}</Button>}{can('products.export') && <Button variant="outline" size="sm" onClick={handleExport} data-testid="products-export"><Download className="w-4 h-4" /> {t('exportExcel')}</Button>}{can('products.create') && <Button size="sm" onClick={openAdd} data-testid="products-add"><Plus className="w-4 h-4" /> {t('add')}</Button>}</>} />
      <DesignPanel testId="products-search-panel"><DesignSearch value={search} onChange={setSearch} placeholder={t('search')} label={t('search')} testId="products-search" /></DesignPanel>
      <DesignPanel testId="products-table-panel"><DataTable columns={columns} data={filtered} loading={loading} emptyMessage={t('noData')} onRowClick={can('products.edit') ? openEdit : undefined} /><DesignPagination loaded={products.length} total={total} hasMore={hasMore} loadingMore={loadingMore} onLoadMore={loadMore} /></DesignPanel>
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? t('edit') : t('add')} size="xl">
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label={t('productName')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
            <Input label={t('nameEn')} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
            <Input label={t('barcode')} value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
            <Input label={t('sku')} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            <Select label={t('category')} value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}><option value="">--</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
            <div><label className="block text-sm font-medium text-ui-muted mb-1">{t('productType')}</label><div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setForm({ ...form, product_type: 'ready' })} className={`px-3 py-2.5 rounded-xl text-sm font-medium border transition-colors ${form.product_type === 'ready' ? 'bg-brand-600 text-white border-brand-600' : 'bg-ui-surface border-ui-border text-ui-text hover:border-brand-400'}`}>{t('withoutIngredients')}</button><button type="button" onClick={() => setForm({ ...form, product_type: 'manufactured' })} className={`px-3 py-2.5 rounded-xl text-sm font-medium border transition-colors ${form.product_type === 'manufactured' ? 'bg-purple-600 text-white border-purple-600' : 'bg-ui-surface border-ui-border text-ui-text hover:border-purple-400'}`}>{t('withIngredients')}</button></div></div>
            {branchFilter ? <div><label className="block text-sm font-medium text-ui-muted mb-1">{t('branch')}</label><div className="min-h-11 flex items-center"><BranchBadge name={branchLabel(form.branch_id || branchFilter)} /></div></div> : <Select label={t('branch')} value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })}><option value="">--</option>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}
            <Input label={t('image') + ' URL'} value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} />
            <Input label={t('costPrice')} type="number" step="0.01" value={form.cost_price || ''} onChange={(e) => setForm({ ...form, cost_price: parseFloat(e.target.value) || 0 })} />
            <Input label={t('salePrice')} type="number" step="0.01" value={form.sale_price || ''} onChange={(e) => setForm({ ...form, sale_price: parseFloat(e.target.value) || 0 })} />
            <Input label={t('wholesalePrice')} type="number" step="0.01" value={form.wholesale_price || ''} onChange={(e) => setForm({ ...form, wholesale_price: parseFloat(e.target.value) || 0 })} />
            <Input label={t('lowStockThreshold')} type="number" value={form.low_stock_threshold || ''} onChange={(e) => setForm({ ...form, low_stock_threshold: parseInt(e.target.value) || 0 })} />
            <Input label={t('minStock')} type="number" step="0.0001" value={form.min_stock || ''} onChange={(e) => setForm({ ...form, min_stock: parseFloat(e.target.value) || 0 })} />
            <Input label={t('maxStock')} type="number" step="0.0001" value={form.max_stock || ''} onChange={(e) => setForm({ ...form, max_stock: parseFloat(e.target.value) || 0 })} />
            <Input label={t('reorderPoint')} type="number" step="0.0001" value={form.reorder_point || ''} onChange={(e) => setForm({ ...form, reorder_point: parseFloat(e.target.value) || 0 })} />
          </div>
          <Textarea label={t('description')} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
          {editing && <div data-testid="product-operational-composition" className="rounded-xl border border-brand-200 dark:border-brand-800/50 bg-brand-50/40 dark:bg-brand-900/10 p-4 space-y-4"><div><h3 className="font-semibold text-ui-text">{lang === 'ar' ? 'مكونات التشغيل الفعلية' : 'Operational composition'}</h3><p className="mt-1 text-xs text-ui-subtle">{lang === 'ar' ? 'هذه البيانات هي التي يعتمد عليها التصنيع وخصم المخزون فعلياً.' : 'These are the components actually used by manufacturing and inventory deduction.'}</p></div><div className="grid grid-cols-1 lg:grid-cols-2 gap-4"><div className="rounded-lg border border-ui-border bg-ui-surface p-3"><div className="flex items-center justify-between mb-2"><h4 className="text-sm font-semibold text-ui-text">{lang === 'ar' ? 'الخامات المباشرة' : 'Direct raw materials'}</h4><span className="text-xs text-ui-subtle">{recipeIngredients.length}</span></div>{recipeIngredients.length === 0 ? <p className="text-sm text-ui-subtle">{lang === 'ar' ? 'لا توجد خامات مباشرة في الوصفة.' : 'No direct raw materials in the recipe.'}</p> : <div className="space-y-2">{recipeIngredients.map((row) => <div key={row.raw_material_id} className="flex items-center justify-between gap-3 rounded-md bg-ui-page-alt px-3 py-2"><span className="text-sm font-medium text-ui-text">{row.raw_material?.name || row.raw_material_id}</span><span className="text-xs font-semibold text-ui-muted">{formatNumber(row.quantity / (recipeYield || 1))} / {lang === 'ar' ? 'وحدة بيع' : 'sale unit'}</span></div>)}</div>}</div><div className="rounded-lg border border-ui-border bg-ui-surface p-3"><div className="flex items-center justify-between mb-2"><h4 className="text-sm font-semibold text-ui-text">{lang === 'ar' ? 'المصنعات المرتبطة' : 'Linked manufactured items'}</h4><span className="text-xs text-ui-subtle">{linkedInventoryUnits.length}</span></div>{linkedInventoryUnits.length === 0 ? <p className="text-sm text-ui-subtle">{lang === 'ar' ? 'لا توجد مصنعات مرتبطة بالمنتج.' : 'No manufactured items are linked to this product.'}</p> : <div className="space-y-2">{linkedInventoryUnits.map((row, index) => <div key={row.unit_id} className="flex items-end gap-2 rounded-md bg-ui-page-alt px-3 py-2"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ui-text">{row.unit?.name || manufacturedInventoryUnits.find((unit) => unit.id === row.unit_id)?.name || row.unit_id}</p><p className="text-xs text-ui-subtle">{lang === 'ar' ? 'مصنع مرتبط بالمخزون' : 'Linked manufactured inventory item'}</p></div><Input label={lang === 'ar' ? 'الكمية' : 'Quantity'} type="number" min={0.0001} step="0.0001" value={row.quantity || ''} onChange={(e) => updateLinkedInventoryUnitQty(index, parseFloat(e.target.value) || 1)} className="w-28" /><button type="button" onClick={() => removeLinkedInventoryUnit(index)} className="mb-0.5 p-2 rounded-md text-ui-danger hover:bg-ui-danger-soft" title={t('delete')}><Trash2 className="w-4 h-4" /></button></div>)}</div>}<div className="mt-3 flex flex-wrap items-end gap-2"><div className="flex-1 min-w-[180px]"><Select label={lang === 'ar' ? 'إضافة مصنع' : 'Add manufactured item'} value={linkedUnitSel} onChange={(e) => setLinkedUnitSel(e.target.value)}><option value="">--</option>{availableManufacturedToAdd.map((unit) => <option key={unit.id} value={unit.id}>{unit.name}</option>)}</Select></div><Input label={lang === 'ar' ? 'الكمية' : 'Quantity'} type="number" min={0.0001} step="0.0001" value={linkedUnitQty || ''} onChange={(e) => setLinkedUnitQty(parseFloat(e.target.value) || 1)} className="w-28" /><Button type="button" size="sm" onClick={addLinkedInventoryUnit} disabled={!linkedUnitSel}><Plus className="w-4 h-4" />{t('add')}</Button></div></div></div></div>}
          {form.product_type === 'manufactured' && recipeIngredients.length === 0 && linkedInventoryUnits.length === 0 && <div className="rounded-xl border border-purple-200 dark:border-purple-800/50 bg-purple-50/40 dark:bg-purple-900/10 p-4 space-y-3"><div className="flex items-center justify-between"><h3 className="font-semibold text-ui-muted">{t('components')}</h3></div>{productComponents.length === 0 && <p className="text-sm text-ui-subtle dark:text-ui-subtle">{t('selectComponent')}</p>}<div className="space-y-2">{productComponents.map((c, i) => { const info = stockComponents.find((s) => s.product_id === c.component_product_id); return <div key={i} className="flex items-center gap-2 p-2 rounded-lg bg-ui-surface border border-ui-border"><div className="flex-1 min-w-0"><p className="text-sm font-medium text-ui-text truncate">{info?.name || c.component_product_id}</p><p className="text-xs text-ui-subtle">{t('availableStock')}: {formatNumber(info?.total || 0)}</p></div><Input label={t('usageQuantityPerUnit')} type="number" min={1} step="0.01" value={c.quantity || ''} onChange={(e) => updateComponentQty(i, parseFloat(e.target.value) || 1)} className="w-32" /><button onClick={() => removeComponentRow(i)} className="p-2 rounded-md text-ui-danger hover:bg-ui-danger-soft"><Trash2 className="w-4 h-4" /></button></div>; })}</div>{stockComponents.length > 0 ? <div className="flex flex-wrap items-end gap-2"><div className="flex-1 min-w-[200px]"><Select label={t('addComponent')} value={componentSel} onChange={(e) => setComponentSel(e.target.value)}><option value="">--</option>{availableToAdd.map((s) => <option key={s.product_id} value={s.product_id}>{s.name} ({formatNumber(s.total)})</option>)}</Select></div><Input label={t('usageQuantityPerUnit')} type="number" min={1} step="0.01" value={componentQty || ''} onChange={(e) => setComponentQty(parseFloat(e.target.value) || 1)} className="w-32" /><Button size="sm" onClick={addComponentRow}><Plus className="w-4 h-4" /> {t('addComponent')}</Button></div> : <p className="text-sm text-ui-warning">{t('noAvailableComponents')}</p>}</div>}
          <div><div className="flex items-center justify-between mb-2"><div><h3 className="font-semibold text-ui-muted">{lang === 'ar' ? 'وحدات البيع' : 'Sales units'}</h3><p className="text-xs text-ui-subtle mt-0.5">{lang === 'ar' ? 'قطعة / كرتونة / عبوة — منفصلة عن وحدات المخزون المصنّعة أعلاه.' : 'Piece / carton / pack — separate from manufactured inventory units above.'}</p></div><Button size="sm" variant="outline" onClick={addUnit}><Plus className="w-4 h-4" /> {t('add')}</Button></div><div className="space-y-2">{units.map((u, i) => <div key={i} className="grid grid-cols-2 sm:grid-cols-6 gap-2 items-end p-2 rounded-lg bg-ui-page-alt"><div><label className="text-xs text-ui-subtle">{t('unitName')}</label><select value={u.unit_name} onChange={(e) => updateUnit(i, 'unit_name', e.target.value)} className="w-full rounded-md border border-ui-border bg-ui-surface px-2 py-1.5 text-sm">{UNIT_NAMES.map(n => <option key={n} value={n}>{n}</option>)}</select></div><Input label={t('conversionFactor')} type="number" step="0.0001" value={u.conversion_factor || ''} onChange={(e) => updateUnit(i, 'conversion_factor', parseFloat(e.target.value) || 1)} /><Input label={t('salePrice')} type="number" step="0.01" value={u.sale_price || ''} onChange={(e) => updateUnit(i, 'sale_price', parseFloat(e.target.value) || 0)} /><Input label={t('costPrice')} type="number" step="0.01" value={u.cost_price || ''} onChange={(e) => updateUnit(i, 'cost_price', parseFloat(e.target.value) || 0)} /><Input label={t('barcode')} value={u.barcode || ''} onChange={(e) => updateUnit(i, 'barcode', e.target.value)} /><button onClick={() => removeUnit(i)} className="p-2 rounded-md text-ui-danger hover:bg-ui-danger-soft"><Trash2 className="w-4 h-4" /></button></div>)}</div></div>
          <div className="flex justify-end gap-2 pt-2"><Button variant="secondary" onClick={() => setModalOpen(false)}>{t('cancel')}</Button><Button onClick={save}>{t('save')}</Button></div>
        </div>
      </Modal>
      <Modal open={!!barcodeModal} onClose={() => setBarcodeModal(null)} title={t('barcode')} size="sm">{barcodeModal && <div className="flex flex-col items-center gap-4"><p className="font-medium text-ui-text">{barcodeModal.name}</p><canvas ref={barcodeCanvasRef} className="rounded-lg bg-ui-surface p-2" /><Button variant="outline" onClick={() => window.print()}><BarcodeIcon className="w-4 h-4" /> {t('print')}</Button></div>}</Modal>
      <Modal open={!!qrModal} onClose={() => setQrModal(null)} title={t('generateQR')} size="sm">{qrDataUrl && <div className="flex flex-col items-center gap-4"><img src={qrDataUrl} alt="QR Code" className="w-48 h-48 rounded-lg" /><Button variant="outline" onClick={() => window.print()}><QrCode className="w-4 h-4" /> {t('print')}</Button></div>}</Modal>
      <ConfirmDialog open={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={remove} title={t('delete')} message={t('confirmDelete')} confirmLabel={t('delete')} cancelLabel={t('cancel')} />
    </DesignSurface>
  );
}
