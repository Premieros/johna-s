import { useEffect, useRef, useState } from 'react';
import { Move, RotateCcw, X } from 'lucide-react';
import { ProductImage } from '@/features/catalog/components/ProductImage';

export type ProductImageView = {
  x: number;
  y: number;
  zoom: number;
};

interface ProductImageAdjustModalProps {
  open: boolean;
  src?: string | null;
  name?: string | null;
  category?: string | null;
  initial: ProductImageView;
  isAr: boolean;
  saving?: boolean;
  onClose: () => void;
  onSave: (value: ProductImageView) => void;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export function ProductImageAdjustModal({
  open,
  src,
  name,
  category,
  initial,
  isAr,
  saving = false,
  onClose,
  onSave,
}: ProductImageAdjustModalProps) {
  const [view, setView] = useState<ProductImageView>(initial);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    if (open) setView(initial);
  }, [open, initial.x, initial.y, initial.zoom]);

  if (!open) return null;

  const beginDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y,
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
    };
  };

  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = ((event.clientX - drag.startX) / drag.width) * 100;
    const dy = ((event.clientY - drag.startY) / drag.height) * 100;
    setView((current) => ({
      ...current,
      x: clamp(Math.round((drag.originX + dx) * 10) / 10, -50, 50),
      y: clamp(Math.round((drag.originY + dy) * 10) / 10, -50, 50),
    }));
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm" data-testid="product-image-adjust-modal">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-ui-border bg-ui-surface shadow-ui-2xl">
        <div className="flex items-center justify-between border-b border-ui-border px-4 py-3">
          <div>
            <h3 className="text-sm font-black text-ui-text">{isAr ? 'ضبط صورة المنتج' : 'Adjust product image'}</h3>
            <p className="mt-0.5 text-[11px] font-medium text-ui-subtle">{isAr ? 'اسحب الصورة داخل المربع ثم اضبط الحجم.' : 'Drag the image inside the square, then adjust its size.'}</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-full text-ui-muted hover:bg-ui-page-alt" aria-label={isAr ? 'إغلاق' : 'Close'}>
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <div
            className="mx-auto aspect-square w-full max-w-[320px] touch-none cursor-grab select-none overflow-hidden rounded-2xl border-2 border-dashed border-ui-border bg-white active:cursor-grabbing"
            onPointerDown={beginDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            data-testid="product-image-drag-area"
          >
            <ProductImage
              src={src}
              name={name}
              category={category}
              className="h-full w-full bg-white"
              imgClassName="h-full w-full bg-white object-contain"
              positionX={view.x}
              positionY={view.y}
              zoom={view.zoom}
            />
          </div>

          <div className="rounded-xl border border-ui-border bg-ui-page-alt p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <label htmlFor="product-image-zoom" className="text-xs font-black text-ui-muted">{isAr ? 'حجم الصورة' : 'Image size'}</label>
              <span className="text-xs font-black text-ui-accent">{Math.round(view.zoom * 100)}%</span>
            </div>
            <input
              id="product-image-zoom"
              data-testid="product-image-zoom"
              type="range"
              min="0.5"
              max="2.5"
              step="0.05"
              value={view.zoom}
              onChange={(event) => setView((current) => ({ ...current, zoom: Number(event.target.value) }))}
              className="w-full accent-current"
            />
            <div className="mt-2 flex items-center gap-2 text-[10px] font-bold text-ui-subtle">
              <Move className="h-3.5 w-3.5" />
              <span>{isAr ? 'اسحب في أي اتجاه لتغيير موضع الصورة.' : 'Drag in any direction to reposition the image.'}</span>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setView({ x: 0, y: 0, zoom: 1 })}
              className="flex min-h-10 items-center gap-2 rounded-xl border border-ui-border bg-ui-surface px-3 text-xs font-black text-ui-muted hover:bg-ui-page-alt"
            >
              <RotateCcw className="h-4 w-4" />
              {isAr ? 'إعادة ضبط' : 'Reset'}
            </button>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="min-h-10 rounded-xl border border-ui-border px-4 text-xs font-black text-ui-muted">{isAr ? 'إلغاء' : 'Cancel'}</button>
              <button
                type="button"
                disabled={saving}
                onClick={() => onSave({ x: Math.round(view.x), y: Math.round(view.y), zoom: Math.round(view.zoom * 100) / 100 })}
                className="min-h-10 rounded-xl bg-ui-primary px-4 text-xs font-black text-ui-primary-fg disabled:opacity-50"
              >
                {saving ? (isAr ? 'جارٍ الحفظ...' : 'Saving...') : (isAr ? 'حفظ الضبط' : 'Save position')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
