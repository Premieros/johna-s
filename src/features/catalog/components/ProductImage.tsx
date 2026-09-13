import { useEffect, useState } from 'react';

interface ProductImageProps {
  src?: string | null;
  name?: string | null;
  category?: string | null;
  className?: string;
  imgClassName?: string;
  alt?: string;
}

const VISUALS: Array<{ terms: string[]; emoji: string; label: string }> = [
  { terms: ['coffee', 'cafe', 'espresso', 'cappuccino', 'latte', 'mocha', 'قهوة', 'كابتشينو', 'لاتيه', 'موكا', 'اسبريسو'], emoji: '☕', label: 'Coffee' },
  { terms: ['tea', 'شاي'], emoji: '🫖', label: 'Tea' },
  { terms: ['juice', 'smoothie', 'drink', 'beverage', 'عصير', 'مشروب', 'كوكتيل'], emoji: '🥤', label: 'Drink' },
  { terms: ['water', 'مياه', 'ماء'], emoji: '💧', label: 'Water' },
  { terms: ['burger', 'برجر', 'برغر'], emoji: '🍔', label: 'Burger' },
  { terms: ['sandwich', 'wrap', 'ساندوتش', 'ساندويتش', 'راب'], emoji: '🥪', label: 'Sandwich' },
  { terms: ['pizza', 'بيتزا'], emoji: '🍕', label: 'Pizza' },
  { terms: ['fries', 'potato', 'بطاطس', 'بطاطا'], emoji: '🍟', label: 'Fries' },
  { terms: ['chicken', 'دجاج', 'فراخ'], emoji: '🍗', label: 'Chicken' },
  { terms: ['meat', 'beef', 'steak', 'كباب', 'لحم', 'لحمة', 'ستيك'], emoji: '🥩', label: 'Meat' },
  { terms: ['salad', 'سلطة'], emoji: '🥗', label: 'Salad' },
  { terms: ['cake', 'dessert', 'sweet', 'كيك', 'حلو', 'حلويات', 'ديسرت'], emoji: '🍰', label: 'Dessert' },
  { terms: ['ice cream', 'gelato', 'ايس كريم', 'آيس كريم'], emoji: '🍨', label: 'Ice cream' },
  { terms: ['breakfast', 'egg', 'فطار', 'إفطار', 'بيض'], emoji: '🍳', label: 'Breakfast' },
  { terms: ['soup', 'شوربة'], emoji: '🍲', label: 'Soup' },
  { terms: ['fish', 'shrimp', 'seafood', 'سمك', 'جمبري', 'سي فود'], emoji: '🍤', label: 'Seafood' },
];

export function getApproximateProductVisual(name?: string | null, category?: string | null) {
  const haystack = `${name || ''} ${category || ''}`.trim().toLocaleLowerCase();
  return VISUALS.find((entry) => entry.terms.some((term) => haystack.includes(term))) || { emoji: '🍽️', label: 'Food' };
}

export function ProductImage({ src, name, category, className = '', imgClassName = '', alt }: ProductImageProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const visual = getApproximateProductVisual(name, category);
  const fallbackLabel = category?.trim() || name?.trim() || visual.label;

  if (src && !failed) {
    return <img src={src} alt={alt || name || ''} className={imgClassName || className} loading="lazy" onError={() => setFailed(true)} />;
  }

  return (
    <div
      className={`flex h-full w-full select-none items-center justify-center bg-gradient-to-br from-ui-page-alt to-ui-surface px-3 ${className}`}
      role="img"
      aria-label={alt || fallbackLabel}
      title={fallbackLabel}
      data-product-image-fallback="true"
    >
      <span className="line-clamp-3 max-w-full text-center text-sm font-black leading-5 text-ui-muted sm:text-base">
        {fallbackLabel}
      </span>
    </div>
  );
}
