import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, PackagePlus, Plus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { DesignSurface, DesignPageHeader, DesignPanel } from '@/components/design';
import { Button } from '@/components/Button';
import { Input, Select } from '@/components/Input';
import { useBranchFilter } from '@/lib/useBranchFilter';
import { useBranches } from '@/hooks/useBranches';
import { useCan } from '@/lib/permissions';
import { generateBarcode } from '@/lib/format';
import { logAudit } from '@/lib/audit';
import { useGuidedWorkflow } from '@/core/guard';
import { invalidatePosCatalogCache } from '@/core/offline/invalidatePosCatalogCache';
import type { Category, Product, InventoryUnit } from '@/lib/types';

type ManufacturedComponent = { unit_id: string; quantity: number };
type RawComponent = { raw_material_id: string; quantity: number; wastage_percent: number };
type MeasurementUnit = { id: string; name: string; symbol?: string | null; code?: string | null };
type RawMaterial = {
  id: string;
  name: string;
  branch_id: string | null;
  is_active: boolean;
  default_cost?: number;
  unit_id: string | null;
  measurement_unit?: MeasurementUnit | null;
};

export function ProductSetupWizardPage() {
  const navigate = useNavigate();
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const branchFilter = useBranchFilter();
  const { branches } = useBranches();
  const can = useCan();
  const { guidedContext, completePrerequisiteAndReturn } = useGuidedWorkflow();
  const isAr = lang === 'ar';

  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [loadingComponents, setLoadingComponents] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [manufacturedItems, setManufacturedItems] = useState<InventoryUnit[]>([]);
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [form, setForm] = useState({
    name: '',
    name_en: '',
    barcode: generateBarcode(),
    sku: '',
    category_id: '',
    branch_id: branchFilter || '',
    cost_price: 0,
    sale_price: 0,
    wholesale_price: 0,
    is_active: true,
  });
  const [manufacturedComponents, setManufacturedComponents] = useState<ManufacturedComponent[]>([]);
  const [rawComponents, setRawComponents] = useState<RawComponent[]>([]);

  const branchId = branchFilter || form.branch_id || '';
  const selectedManufacturedIds = useMemo(() => new Set(manufacturedComponents.map((row) => row.unit_id).filter(Boolean)), [manufacturedComponents]);
  const selectedRawIds = useMemo(() => new Set(rawComponents.map((row) => row.raw_material_id).filter(Boolean)), [rawComponents]);
  const totalComponentCount = manufacturedComponents.length + rawComponents.length;

  const rawUnitLabel = (material?: RawMaterial) => {
    const unit = material?.measurement_unit;
    if (!unit) return isAr ? 'وحدة غير محددة' : 'Unit not set';
    const short = unit.symbol || unit.code;
    return short && short !== unit.name ? `${unit.name} (${short})` : unit.name;
  };
  const rawMaterialLabel = (material: RawMaterial) => `${material.name} — ${rawUnitLabel(material)}`;

  useEffect(() => {
    if (branchFilter && form.branch_id !== branchFilter) {
      setForm((prev) => ({ ...prev, branch_id: branchFilter, category_id: '' }));
    }
  }, [branchFilter, form.branch_id]);

  useEffect(() => {
    let cancelled = false;
    setManufacturedComponents([]);
    setRawComponents([]);
    setCategories([]);
    setManufacturedItems([]);
    setRawMaterials([]);

    if (!branchId) return () => { cancelled = true; };

    void (async () => {
      setLoadingComponents(true);
      const [cats, manufactured, raws] = await Promise.all([
        supabase.from('categories').select('*').eq('branch_id', branchId).order('name'),
        supabase.from('inventory_units').select('*').eq('branch_id', branchId).eq('unit_type', 'manufactured').eq('is_active', true).order('name'),
        supabase.from('raw_materials')
          .select('id,name,branch_id,is_active,default_cost,unit_id,measurement_unit:measurement_units!raw_materials_unit_id_fkey(id,name,symbol,code)')
          .eq('branch_id', branchId)
          .eq('is_active', true)
          .order('name'),
      ]);
      if (cancelled) return;
      if (cats.error) show(cats.error.message, 'error');
      if (manufactured.error) show(manufactured.error.message, 'error');
      if (raws.error) show(raws.error.message, 'error');
      setCategories((cats.data as Category[]) || []);
      setManufacturedItems((manufactured.data as InventoryUnit[]) || []);
      setRawMaterials((raws.data as unknown as RawMaterial[]) || []);
      setLoadingComponents(false);
    })().catch((error) => {
      if (!cancelled) {
        show(error instanceof Error ? error.message : String(error), 'error');
        setLoadingComponents(false);
      }
    });

    return () => { cancelled = true; };
  }, [branchId, show]);

  const addManufacturedComponent = () => setManufacturedComponents((prev) => [...prev, { unit_id: '', quantity: 1 }]);
  const updateManufacturedComponent = (index: number, patch: Partial<ManufacturedComponent>) => {
    setManufacturedComponents((prev) => prev.map((row, i) => i === index ? { ...row, ...patch } : row));
  };
  const removeManufacturedComponent = (index: number) => setManufacturedComponents((prev) => prev.filter((_, i) => i !== index));

  const addRawComponent = () => setRawComponents((prev) => [...prev, { raw_material_id: '', quantity: 1, wastage_percent: 0 }]);
  const updateRawComponent = (index: number, patch: Partial<RawComponent>) => {
    setRawComponents((prev) => prev.map((row, i) => i === index ? { ...row, ...patch } : row));
  };
  const removeRawComponent = (index: number) => setRawComponents((prev) => prev.filter((_, i) => i !== index));

  const validateStep = () => {
    if (step === 1 && (!form.name.trim() || !branchId)) {
      show(isAr ? 'أكمل اسم المنتج والفرع' : 'Complete the product name and branch', 'error');
      return false;
    }
    if (step === 2) {
      if (manufacturedComponents.some((row) => !row.unit_id || row.quantity <= 0)) {
        show(isAr ? 'اختر المصنع وحدد كمية صحيحة' : 'Select each manufactured item and enter a valid quantity', 'error');
        return false;
      }
      if (selectedManufacturedIds.size !== manufacturedComponents.length) {
        show(isAr ? 'لا يمكن إضافة نفس المصنع أكثر من مرة' : 'The same manufactured item cannot be selected more than once', 'error');
        return false;
      }
      if (manufacturedComponents.some((row) => !manufacturedItems.some((item) => item.id === row.unit_id && item.branch_id === branchId && item.unit_type === 'manufactured'))) {
        show(isAr ? 'أحد المصنعات لا ينتمي للفرع الحالي' : 'A manufactured item does not belong to the current branch', 'error');
        return false;
      }
    }
    if (step === 3) {
      if (rawComponents.some((row) => !row.raw_material_id || row.quantity <= 0 || row.wastage_percent < 0)) {
        show(isAr ? 'اختر الخامة وحدد كمية صحيحة' : 'Select each raw material and enter a valid quantity', 'error');
        return false;
      }
      if (selectedRawIds.size !== rawComponents.length) {
        show(isAr ? 'لا يمكن إضافة نفس الخامة أكثر من مرة' : 'The same raw material cannot be selected more than once', 'error');
        return false;
      }
      if (rawComponents.some((row) => !rawMaterials.some((material) => material.id === row.raw_material_id && material.branch_id === branchId))) {
        show(isAr ? 'إحدى الخامات لا تنتمي للفرع الحالي' : 'A selected raw material does not belong to the current branch', 'error');
        return false;
      }
      if (rawComponents.some((row) => !rawMaterials.find((material) => material.id === row.raw_material_id)?.measurement_unit)) {
        show(isAr ? 'لا يمكن استخدام خامة بدون وحدة قياس. افتح الخامة وحدد وحدتها أولًا.' : 'A raw material without a measurement unit cannot be used. Set its unit first.', 'error');
        return false;
      }
    }
    return true;
  };

  const save = async () => {
    if (!can('products.create') || saving || !branchId) return;
    if (!validateStep()) return;

    setSaving(true);
    let createdProductId: string | null = null;
    try {
      const derivedProductType: 'ready' | 'manufactured' = rawComponents.length > 0 || manufacturedComponents.length > 0 ? 'manufactured' : 'ready';
      const { data: product, error: productError } = await supabase.from('products').insert({
        name: form.name.trim(),
        name_en: form.name_en.trim() || null,
        barcode: form.barcode || null,
        sku: form.sku.trim() || null,
        category_id: form.category_id || null,
        branch_id: branchId,
        cost_price: Number(form.cost_price) || 0,
        sale_price: Number(form.sale_price) || 0,
        wholesale_price: Number(form.wholesale_price) || 0,
        is_active: form.is_active,
        product_type: derivedProductType,
      }).select().single();
      if (productError) throw productError;

      createdProductId = (product as Product).id;

      if (manufacturedComponents.length > 0) {
        const { error: linkError } = await supabase.from('product_unit_links').insert(manufacturedComponents.map((row) => ({
          product_id: createdProductId,
          unit_id: row.unit_id,
          quantity: Number(row.quantity),
        })));
        if (linkError) throw linkError;
      }

      if (rawComponents.length > 0) {
        const { data: recipe, error: recipeError } = await supabase.from('recipes').insert({
          product_id: createdProductId,
          branch_id: branchId,
          name: `${form.name.trim()} Recipe`,
          yield_quantity: 1,
          is_active: true,
          version: 1,
        }).select('id').single();
        if (recipeError) throw recipeError;

        const { error: itemError } = await supabase.from('recipe_items').insert(rawComponents.map((row) => ({
          recipe_id: (recipe as { id: string }).id,
          raw_material_id: row.raw_material_id,
          quantity: Number(row.quantity),
          wastage_percent: Number(row.wastage_percent) || 0,
        })));
        if (itemError) throw itemError;
      }

      await logAudit('create', 'products', createdProductId, {
        name: form.name,
        branch_id: branchId,
        manufactured_components: manufacturedComponents.length,
        raw_components: rawComponents.length,
        product_type: derivedProductType,
      });
      await invalidatePosCatalogCache();
      show(t('saveSuccess'), 'success');
      if (guidedContext?.missingStep.key.includes('product')) {
        setTimeout(() => { completePrerequisiteAndReturn(); }, 500);
      } else {
        navigate('/products');
      }
    } catch (error) {
      if (createdProductId) {
        await supabase.from('products').delete().eq('id', createdProductId);
      }
      show(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setSaving(false);
    }
  };

  const branchName = branches.find((branch) => branch.id === branchId)?.name || '';

  return (
    <DesignSurface testId="product-setup-wizard-page">
      <DesignPageHeader
        title={isAr ? 'إضافة منتج' : 'Add Product'}
        subtitle={isAr ? 'أنشئ المنتج ثم اربطه بالمصنعات والخامات الموجودة مسبقًا. المنتج نفسه لا يملك وحدة قياس.' : 'Create the product, then link existing manufactured items and raw materials. Products do not have measurement units.'}
        actions={<Button variant="outline" size="sm" onClick={() => navigate('/products')}><ChevronLeft className="w-4 h-4" />{isAr ? 'العودة للمنتجات' : 'Back to products'}</Button>}
      />
      <DesignPanel>
        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1">
          {[
            ['1', isAr ? 'بيانات المنتج' : 'Product'],
            ['2', isAr ? 'المصنعات' : 'Manufactured items'],
            ['3', isAr ? 'الخامات' : 'Raw materials'],
            ['4', isAr ? 'مراجعة' : 'Review'],
          ].map(([number, label]) => {
            const active = Number(number) === step;
            const done = Number(number) < step;
            return (
              <div key={number} className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm whitespace-nowrap ${active ? 'bg-brand-600 text-white' : done ? 'bg-ui-success-soft text-ui-success' : 'bg-ui-page-alt text-ui-subtle'}`}>
                <span className="w-6 h-6 rounded-full flex items-center justify-center bg-white/20">{done ? <Check className="w-4 h-4" /> : number}</span>
                {label}
              </div>
            );
          })}
        </div>

        {step === 1 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input label={t('productName')} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
            <Input label={t('nameEn')} value={form.name_en} onChange={(event) => setForm({ ...form, name_en: event.target.value })} />
            <Input label={t('barcode')} value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} />
            <Input label={t('sku')} value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} />
            <Select label={t('category')} value={form.category_id} onChange={(event) => setForm({ ...form, category_id: event.target.value })}>
              <option value="">--</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </Select>
            {!branchFilter && (
              <Select label={t('branch')} value={form.branch_id} onChange={(event) => setForm((prev) => ({ ...prev, branch_id: event.target.value, category_id: '' }))}>
                <option value="">{isAr ? 'اختر الفرع' : 'Select branch'}</option>
                {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
              </Select>
            )}
            <Input label={t('costPrice')} type="number" step="0.01" value={form.cost_price || ''} onChange={(event) => setForm({ ...form, cost_price: Number(event.target.value) || 0 })} />
            <Input label={t('salePrice')} type="number" step="0.01" value={form.sale_price || ''} onChange={(event) => setForm({ ...form, sale_price: Number(event.target.value) || 0 })} />
            <Input label={t('wholesalePrice')} type="number" step="0.01" value={form.wholesale_price || ''} onChange={(event) => setForm({ ...form, wholesale_price: Number(event.target.value) || 0 })} />
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <h3 className="font-bold">{isAr ? 'المصنعات المستخدمة في المنتج' : 'Manufactured items used by the product'}</h3>
                <p className="text-sm text-ui-subtle">{isAr ? `اختيار فقط من مصنعات ${branchName || 'الفرع الحالي'}؛ لا يتم إنشاء مصنع من داخل المنتج.` : `Select only existing manufactured items in ${branchName || 'the current branch'}; no inline creation.`}</p>
              </div>
              <Button variant="outline" onClick={addManufacturedComponent} disabled={!branchId || loadingComponents || manufacturedItems.length === 0}>
                <Plus className="w-4 h-4" />{isAr ? 'إضافة مصنع' : 'Add manufactured item'}
              </Button>
            </div>
            {manufacturedItems.length === 0 && !loadingComponents && (
              <div className="rounded-xl border border-ui-border bg-ui-page-alt p-4 text-sm text-ui-subtle">
                {isAr ? 'لا توجد مصنعات في هذا الفرع. أنشئ المصنع أولًا من شاشة المصنعات ثم ارجع لاختياره هنا.' : 'No manufactured items exist in this branch. Create one first from Manufactured Items, then return here.'}
              </div>
            )}
            {manufacturedComponents.map((row, index) => (
              <div key={index} className="grid grid-cols-1 md:grid-cols-[1fr_160px_auto] gap-3 items-end rounded-xl border border-ui-border p-3">
                <Select label={isAr ? 'اختر المصنع' : 'Select manufactured item'} value={row.unit_id} onChange={(event) => updateManufacturedComponent(index, { unit_id: event.target.value })}>
                  <option value="">{isAr ? 'اختر من المصنعات الموجودة' : 'Choose an existing manufactured item'}</option>
                  {manufacturedItems.map((item) => <option key={item.id} value={item.id} disabled={selectedManufacturedIds.has(item.id) && row.unit_id !== item.id}>{item.name}</option>)}
                </Select>
                <Input label={isAr ? 'الكمية المستخدمة' : 'Quantity used'} type="number" min="0.0001" step="0.0001" value={row.quantity} onChange={(event) => updateManufacturedComponent(index, { quantity: Number(event.target.value) || 0 })} />
                <Button variant="outline" size="sm" onClick={() => removeManufacturedComponent(index)}><Trash2 className="w-4 h-4" />{isAr ? 'حذف' : 'Remove'}</Button>
              </div>
            ))}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <h3 className="font-bold">{isAr ? 'الخامات المكوّنة للمنتج' : 'Product raw materials'}</h3>
                <p className="text-sm text-ui-subtle">{isAr ? `اختيار فقط من خامات ${branchName || 'الفرع الحالي'} بدون كتابة أو إنشاء خامة هنا. وحدة القياس تأتي من الخامة نفسها وتبقى ثابتة.` : `Select only existing raw materials in ${branchName || 'the current branch'}. Measurement units come from the raw material and remain fixed.`}</p>
              </div>
              <Button variant="outline" onClick={addRawComponent} disabled={!branchId || loadingComponents || rawMaterials.length === 0}>
                <Plus className="w-4 h-4" />{isAr ? 'إضافة خامة' : 'Add raw material'}
              </Button>
            </div>
            {rawMaterials.length === 0 && !loadingComponents && (
              <div className="rounded-xl border border-ui-border bg-ui-page-alt p-4 text-sm text-ui-subtle">
                {isAr ? 'لا توجد خامات في هذا الفرع. أنشئ الخامة أولًا من شاشة الخامات ثم ارجع لاختيارها هنا.' : 'No raw materials exist in this branch. Create them first from the raw-material screen, then return here.'}
              </div>
            )}
            {rawComponents.map((row, index) => {
              const selectedMaterial = rawMaterials.find((material) => material.id === row.raw_material_id);
              const unitLabel = selectedMaterial ? rawUnitLabel(selectedMaterial) : '';
              return (
                <div key={index} className="grid grid-cols-1 md:grid-cols-[1fr_170px_130px_auto] gap-3 items-end rounded-xl border border-ui-border p-3">
                  <Select label={isAr ? 'اختر الخامة' : 'Select raw material'} value={row.raw_material_id} onChange={(event) => updateRawComponent(index, { raw_material_id: event.target.value })}>
                    <option value="">{isAr ? 'اختر من الخامات الموجودة' : 'Choose an existing raw material'}</option>
                    {rawMaterials.map((material) => <option key={material.id} value={material.id} disabled={!material.measurement_unit || (selectedRawIds.has(material.id) && row.raw_material_id !== material.id)}>{rawMaterialLabel(material)}</option>)}
                  </Select>
                  <Input label={unitLabel ? `${isAr ? 'الكمية' : 'Quantity'} (${unitLabel})` : (isAr ? 'الكمية' : 'Quantity')} type="number" min="0.0001" step="0.0001" value={row.quantity} onChange={(event) => updateRawComponent(index, { quantity: Number(event.target.value) || 0 })} />
                  <Input label={isAr ? 'هالك %' : 'Waste %'} type="number" min="0" step="0.01" value={row.wastage_percent} onChange={(event) => updateRawComponent(index, { wastage_percent: Number(event.target.value) || 0 })} />
                  <Button variant="outline" size="sm" onClick={() => removeRawComponent(index)}><Trash2 className="w-4 h-4" />{isAr ? 'حذف' : 'Remove'}</Button>
                </div>
              );
            })}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4">
            <div className="rounded-xl bg-brand-50 dark:bg-brand-900/10 border border-brand-200 dark:border-brand-800/40 p-5">
              <p className="text-lg font-bold">{form.name}</p>
              <p className="text-sm text-ui-subtle mt-1">{branchName}</p>
              <div className="grid md:grid-cols-2 gap-4 mt-4">
                <div>
                  <p className="font-semibold mb-2">{isAr ? 'المصنعات المختارة' : 'Selected manufactured items'}</p>
                  {manufacturedComponents.length === 0 ? <p className="text-sm text-ui-subtle">—</p> : manufacturedComponents.map((row, index) => <div key={index} className="text-sm flex justify-between gap-3 py-1"><span>{manufacturedItems.find((item) => item.id === row.unit_id)?.name || row.unit_id}</span><span>× {row.quantity}</span></div>)}
                </div>
                <div>
                  <p className="font-semibold mb-2">{isAr ? 'الخامات المختارة' : 'Selected raw materials'}</p>
                  {rawComponents.length === 0 ? <p className="text-sm text-ui-subtle">—</p> : rawComponents.map((row, index) => {
                    const material = rawMaterials.find((item) => item.id === row.raw_material_id);
                    return <div key={index} className="text-sm flex justify-between gap-3 py-1"><span>{material?.name || row.raw_material_id}</span><span>{row.quantity} {rawUnitLabel(material)} · {row.wastage_percent}%</span></div>;
                  })}
                </div>
              </div>
            </div>
            <p className="text-sm text-ui-subtle">{isAr ? `سيتم ربط ${totalComponentCount} مكوّن موجود بالمنتج. لن يتم إنشاء خامة أو مصنع من داخل شاشة المنتج.` : `${totalComponentCount} existing components will be linked. No raw material or manufactured item will be created from the product screen.`}</p>
          </div>
        )}

        <div className="flex justify-between gap-2 mt-6 pt-4 border-t border-ui-border">
          <Button variant="secondary" onClick={() => setStep((current) => Math.max(1, current - 1))} disabled={step === 1 || saving}>
            <ChevronLeft className="w-4 h-4" />{isAr ? 'السابق' : 'Back'}
          </Button>
          {step < 4 ? (
            <Button onClick={() => validateStep() && setStep((current) => current + 1)} disabled={loadingComponents}>
              <ChevronRight className="w-4 h-4" />{isAr ? 'التالي' : 'Next'}
            </Button>
          ) : (
            <Button onClick={save} disabled={saving || !branchId}>
              <PackagePlus className="w-4 h-4" />{saving ? (isAr ? 'جارٍ الحفظ...' : 'Saving...') : (isAr ? 'حفظ المنتج' : 'Save product')}
            </Button>
          )}
        </div>
      </DesignPanel>
    </DesignSurface>
  );
}