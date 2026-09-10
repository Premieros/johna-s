import { useEffect, useMemo, useState } from 'react';
import { ImagePlus, Loader2, LockKeyhole, Package, Plus, ScanBarcode, Search, ShoppingCart, SlidersHorizontal, Timer, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import * as api from '@/api';
import { supabase } from '@/api';
import { useLanguage } from '@/context/LanguageContext';
import { useToast } from '@/components/Toast';
import { formatCurrency } from '@/lib/format';
import { useCan } from '@/lib/permissions';
import { APP_ROUTES } from '@/core/navigation/routes';
import { ProductImage } from '@/features/catalog/components/ProductImage';
import { uploadProductImage } from '@/features/catalog/services/productImages';
import { invalidatePosCatalogCache } from '@/core/offline/invalidatePosCatalogCache';
import type { Category, Product, ProductComponent } from '@/lib/types';

interface ProductBrowserProps {
  products: Product[];
  categories: Category[];
  stockMap: Record<string, number>;
  sellableStock: Record<string, number>;
  recipeMap: Record<string, ProductComponent[]>;
  search: string;
  selectedCategory: string;
  currency: string;
  hasBranch: boolean;
  canModifyOrder: boolean;
  onSearch: (value: string) => void;
  onSelectCategory: (id: string) => void;
  onAddToCart: (product: Product) => void;
  onConfigureProduct?: (product: Product) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}

const hasStockValue = (map: Record<string, number>, productId: string) => Object.prototype.hasOwnProperty.call(map, productId);

export function ProductBrowser({ products, categories, stockMap, sellableStock, search, selectedCategory, currency, hasBranch, canModifyOrder, onSearch, onSelectCategory, onAddToCart, onConfigureProduct, inputRef }: ProductBrowserProps) {
  const { t, lang } = useLanguage();
  const { show } = useToast();
  const isAr = lang === 'ar';
  const navigate = useNavigate();
  const can = useCan();
  const [shiftChecked, setShiftChecked] = useState(false);
  const [shiftOpen, setShiftOpen] = useState(false);
  const [uploadingProductId, setUploadingProductId] = useState<string | null>(null);
  const [imageOverrides, setImageOverrides] = useState<Record<string, string>>({});

  const branchId = useMemo(() => products.find((product) => product.branch_id)?.branch_id || '', [products]);
  const filteredProducts = useMemo(() => products
    .filter((product) => (!selectedCategory || product.category_id === selectedCategory) && (!search || [product.name, product.name_en, product.barcode, product.sku].some((value) => value?.toLocaleLowerCase().includes(search.toLocaleLowerCase()))))
    .sort((a, b) => {
      const aManufactured = a.product_type === 'manufactured';
      const bManufactured = b.product_type === 'manufactured';
      const aSource = aManufactured ? sellableStock : stockMap;
      const bSource = bManufactured ? sellableStock : stockMap;
      const aKnown = hasStockValue(aSource, a.id);
      const bKnown = hasStockValue(bSource, b.id);
      const aStock = aKnown ? aSource[a.id] : 0;
      const bStock = bKnown ? bSource[b.id] : 0;
      const aAvailable = aKnown && aStock > 0;
      const bAvailable = bKnown && bStock > 0;
      if (aAvailable !== bAvailable) return Number(bAvailable) - Number(aAvailable);
      if (aKnown !== bKnown) return Number(bKnown) - Number(aKnown);
      return 0;
    }), [products, search, selectedCategory, sellableStock, stockMap]);
  const counts = useMemo(() => products.reduce<Record<string, number>>((accumulator, product) => {
    const key = product.category_id || '_none';
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {}), [products]);
  const categoryById = useMemo(() => Object.fromEntries(categories.map((category) => [category.id, isAr ? category.name : category.name_en || category.name])), [categories, isAr]);

  useEffect(() => {
    let cancelled = false;
    if (!hasBranch || !branchId) {
      setShiftOpen(false);
      setShiftChecked(true);
      return;
    }
    setShiftChecked(false);
    api.pos.getActiveShift({ p_branch_id: branchId }).then(({ data }) => {
      if (cancelled) return;
      const result = data as unknown as { open?: boolean } | null;
      setShiftOpen(result?.open === true);
      setShiftChecked(true);
    }).catch(() => {
      if (!cancelled) {
        setShiftOpen(false);
        setShiftChecked(true);
      }
    });
    return () => { cancelled = true; };
  }, [branchId, hasBranch]);

  const canAddToCart = canModifyOrder && hasBranch && shiftChecked && shiftOpen;
  const ensureSellable = (product: Product) => {
    const source = product.product_type === 'manufactured' ? sellableStock : stockMap;
    if (!hasStockValue(source, product.id)) {
      show(isAr ? 'تعذر التحقق من المخزون. أعد المحاولة.' : 'Could not verify inventory. Please retry.', 'error');
      return false;
    }
    if ((source[product.id] || 0) <= 0) {
      show(isAr ? 'المنتج غير متوفر بالمخزون.' : 'Product is out of stock.', 'error');
      return false;
    }
    return true;
  };
  const selectProduct = (product: Product) => {
    if (!canAddToCart || !ensureSellable(product)) return;
    if (onConfigureProduct) onConfigureProduct(product);
    else onAddToCart(product);
  };
  const addProductDirectly = (product: Product) => {
    if (!canAddToCart || !ensureSellable(product)) return;
    onAddToCart(product);
  };

  const handleImageUpload = async (product: Product, file?: File) => {
    if (!file || !product.branch_id || !can('products.edit') || uploadingProductId) return;
    setUploadingProductId(product.id);
    try {
      const { publicUrl } = await uploadProductImage(file, product.branch_id, product.id);
      const { error } = await supabase.from('products').update({ image_url: publicUrl }).eq('id', product.id).eq('branch_id', product.branch_id);
      if (error) throw error;
      setImageOverrides((current) => ({ ...current, [product.id]: publicUrl }));
      await invalidatePosCatalogCache();
      show(isAr ? 'تم رفع صورة المنتج' : 'Product photo uploaded', 'success');
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : String(uploadError);
      show(message === 'IMAGE_TOO_LARGE' ? (isAr ? 'حجم الصورة يجب ألا يتجاوز 5MB' : 'Image must be 5MB or smaller') : message === 'INVALID_IMAGE_TYPE' ? (isAr ? 'اختر ملف صورة صالح' : 'Choose a valid image file') : message, 'error');
    } finally {
      setUploadingProductId(null);
    }
  };

  return (
    <section data-testid="pos-product-browser" className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-ui-page">
      <div className="z-10 flex-shrink-0 border-b border-ui-border bg-ui-surface/95 px-3 py-3 backdrop-blur sm:px-4">
        {!canAddToCart && hasBranch && shiftChecked && (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-ui-warning/30 bg-ui-warning/10 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2"><LockKeyhole className="h-4 w-4 shrink-0 text-ui-warning" /><p className="truncate text-[11px] font-black text-ui-text">{isAr ? 'ممنوع إضافة منتجات بدون شفت مفتوح' : 'An open shift is required before adding products'}</p></div>
            {can('shifts.view') && <button type="button" onClick={() => navigate(APP_ROUTES.shifts)} className="flex shrink-0 items-center gap-1 rounded-lg bg-ui-warning px-2.5 py-1.5 text-[10px] font-black text-white"><Timer className="h-3 w-3" />{isAr ? 'فتح الشفت' : 'Open shift'}</button>}
          </div>
        )}
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ui-subtle" />
            <input ref={inputRef} value={search} onChange={(event) => onSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { const product = products.find((item) => item.barcode === search || item.sku === search); if (product && canAddToCart) { selectProduct(product); onSearch(''); } } }} placeholder={isAr ? 'ابحث عن منتج أو امسح الباركود / SKU (F2)...' : 'Search a product or scan barcode / SKU (F2)...'} className="h-11 w-full rounded-xl border border-ui-border bg-ui-page-alt ps-10 pe-9 text-sm font-bold text-ui-text outline-none transition focus:border-ui-primary focus:ring-2 focus:ring-ui-ring" autoComplete="off" />
            {search ? <button type="button" onClick={() => onSearch('')} className="absolute end-2 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-ui-subtle hover:bg-ui-page-alt"><X className="h-4 w-4" /></button> : <ScanBarcode className="absolute end-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ui-subtle" />}
          </div>
          <div className="hidden min-w-14 items-center justify-center rounded-xl border border-ui-border bg-ui-page-alt px-2 text-xs font-black text-ui-muted sm:flex">{filteredProducts.length}</div>
        </div>
        <div className="mt-3 flex gap-2 overflow-x-auto pb-0.5 scrollbar-none" data-testid="pos-category-strip">
          <button type="button" onClick={() => onSelectCategory('')} className={`flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-xs font-black transition ${!selectedCategory ? 'bg-ui-primary text-ui-primary-fg shadow-ui-sm' : 'border border-ui-border bg-ui-surface text-ui-muted hover:border-ui-primary hover:text-ui-text'}`}><span className="text-base">▦</span>{t('allCategories')} <span className="opacity-60">{products.length}</span></button>
          {categories.map((category) => <button key={category.id} type="button" onClick={() => onSelectCategory(selectedCategory === category.id ? '' : category.id)} className={`min-h-11 shrink-0 rounded-xl px-4 text-xs font-black transition ${selectedCategory === category.id ? 'bg-ui-primary text-ui-primary-fg shadow-ui-sm' : 'border border-ui-border bg-ui-surface text-ui-muted hover:border-ui-primary hover:text-ui-text'}`}>{isAr ? category.name : category.name_en || category.name} <span className="ms-1 opacity-50">{counts[category.id] || 0}</span></button>)}
        </div>
      </div>

      <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-y-contain p-3 sm:p-4">
        {!hasBranch ? <div className="flex h-full flex-col items-center justify-center text-center text-ui-subtle"><ShoppingCart className="mb-3 h-10 w-10 opacity-20" /><p className="font-black">{isAr ? 'اختر الفرع أولاً' : 'Select a branch first'}</p></div> : filteredProducts.length === 0 ? <div className="flex h-full flex-col items-center justify-center text-center text-ui-subtle"><Package className="mb-3 h-10 w-10 opacity-20" /><p className="font-black">{t('noData')}</p></div> : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(138px,1fr))] gap-3" data-testid="pos-product-grid">
            {filteredProducts.map((product) => {
              const manufactured = product.product_type === 'manufactured';
              const source = manufactured ? sellableStock : stockMap;
              const stockKnown = hasStockValue(source, product.id);
              const stock = stockKnown ? source[product.id] : 0;
              const unavailable = stockKnown && stock <= 0;
              const unknownAvailability = !stockKnown;
              const blocked = unavailable || unknownAvailability || !canAddToCart;
              const productLabel = isAr ? product.name : product.name_en || product.name;
              const categoryLabel = product.category_id ? categoryById[product.category_id] : '';
              const imageUrl = imageOverrides[product.id] || product.image_url;
              const uploading = uploadingProductId === product.id;
              return (
                <article key={product.id} data-testid={`pos-product-card-${product.id}`} className={`group relative flex min-h-[176px] flex-col overflow-hidden rounded-2xl border bg-ui-surface text-start shadow-ui-sm transition ${blocked ? 'border-ui-border opacity-55' : 'border-ui-border hover:-translate-y-0.5 hover:border-ui-primary hover:shadow-ui-md'}`}>
                  <button type="button" disabled={blocked} onClick={() => selectProduct(product)} className={`relative h-28 w-full overflow-hidden bg-ui-page-alt text-start ${blocked ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                    <ProductImage src={imageUrl} name={productLabel} category={categoryLabel} className="h-full w-full" imgClassName="h-full w-full object-cover transition duration-200 group-hover:scale-105" />
                    <span className={`absolute end-2 top-2 rounded-lg px-2 py-1 text-[9px] font-black text-white shadow-ui-sm ${unavailable ? 'bg-ui-danger/90' : unknownAvailability ? 'bg-ui-warning/90' : stock <= (product.low_stock_threshold || 5) ? 'bg-ui-warning/90' : 'bg-ui-success/90'}`}>{unknownAvailability ? (isAr ? 'تعذر التحقق' : 'Stock unknown') : unavailable ? (isAr ? 'نفد المخزون' : 'Out of stock') : `${isAr ? 'متاح' : 'Stock'} ${stock}`}</span>
                  </button>
                  {can('products.edit') && (
                    <label onClick={(event) => event.stopPropagation()} className="absolute start-2 top-2 z-10 flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border border-white/70 bg-ui-surface/95 text-ui-muted shadow-ui-sm backdrop-blur transition hover:text-ui-primary" title={isAr ? 'رفع صورة للمنتج' : 'Upload product photo'}>
                      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                      <input data-testid={`product-image-upload-${product.id}`} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" className="hidden" disabled={!!uploadingProductId} onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ''; void handleImageUpload(product, file); }} />
                    </label>
                  )}
                  <div className="flex flex-1 flex-col p-2.5">
                    <p className="line-clamp-2 min-h-9 text-xs font-black leading-4 text-ui-text" title={productLabel}>{productLabel}</p>
                    {categoryLabel && <p className="mt-0.5 truncate text-[10px] font-medium text-ui-subtle">{categoryLabel}</p>}
                    <div className="mt-auto flex items-end justify-between gap-1 pt-2">
                      <span className="min-w-0 truncate text-sm font-black text-ui-accent">{formatCurrency(product.sale_price, currency, lang)}</span>
                      {!blocked && <div className="flex shrink-0 items-center gap-1">{onConfigureProduct && <button type="button" onClick={(event) => { event.stopPropagation(); onConfigureProduct(product); }} title={isAr ? 'تخصيص الصنف' : 'Configure Item'} className="flex h-8 w-8 items-center justify-center rounded-lg border border-ui-border bg-ui-page-alt text-ui-muted transition hover:border-ui-primary hover:text-ui-accent"><SlidersHorizontal className="h-3.5 w-3.5" /></button>}<button type="button" aria-label={isAr ? 'إضافة' : 'Add'} onClick={(event) => { event.stopPropagation(); addProductDirectly(product); }} className="flex h-8 w-8 items-center justify-center rounded-lg bg-ui-primary text-ui-primary-fg shadow-ui-sm transition hover:bg-ui-primary/90 active:scale-95"><Plus className="h-4 w-4" /></button></div>}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}