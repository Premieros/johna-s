import { useEffect, useMemo, useState } from 'react';

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

const SPRITE_COLUMNS = 8;
const SPRITE_ROWS = 37;
const SPRITE_GROUP_START_ROW: Record<string, number> = {
  appetizers: 0,
  breakfast: 3,
  'burgers-sandwiches': 5,
  'pizza-pasta-salads': 8,
  'main-courses': 13,
  'coffee-hot': 17,
  'iced-cocktail-mojito': 22,
  'juices-smoothies': 26,
  'frappe-milkshake': 30,
  desserts: 33,
};

type SpriteFrame = {
  imageUrl: string;
  backgroundPosition: string;
};

function resolveSpriteFrame(src?: string | null): SpriteFrame | null {
  if (!src) return null;
  const hashIndex = src.lastIndexOf('#');
  if (hashIndex < 0) return null;

  const imageUrl = src.slice(0, hashIndex);
  if (!imageUrl.endsWith('/catalog-product-sprite.svg') && !imageUrl.endsWith('catalog-product-sprite.svg')) return null;

  const fragment = src.slice(hashIndex + 1);
  const match = fragment.match(/^(.+)-p(\d+)$/);
  if (!match) return null;

  const group = match[1];
  const itemIndex = Number(match[2]);
  const startRow = SPRITE_GROUP_START_ROW[group];
  if (!Number.isInteger(itemIndex) || startRow === undefined) return null;

  const column = itemIndex % SPRITE_COLUMNS;
  const row = startRow + Math.floor(itemIndex / SPRITE_COLUMNS);
  if (row < 0 || row >= SPRITE_ROWS) return null;

  const x = column === 0 ? 0 : (column / (SPRITE_COLUMNS - 1)) * 100;
  const y = row === 0 ? 0 : (row / (SPRITE_ROWS - 1)) * 100;

  return {
    imageUrl,
    backgroundPosition: `${x}% ${y}%`,
  };
}

export function getApproximateProductVisual(name?: string | null, category?: string | null) {
  const haystack = `${name || ''} ${category || ''}`.trim().toLocaleLowerCase();
  return VISUALS.find((entry) => entry.terms.some((term) => haystack.includes(term))) || { emoji: '🍽️', label: 'Food' };
}

export function ProductImage({ src, name, category, className = '', imgClassName = '', alt }: ProductImageProps) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);

  const spriteFrame = useMemo(() => resolveSpriteFrame(src), [src]);
  const visual = getApproximateProductVisual(name, category);
  const fallbackLabel = category?.trim() || visual.label;
  const accessibleLabel = alt || name || fallbackLabel;

  if (src && spriteFrame && !failed) {
    return (
      <div
        className={`flex h-full w-full items-center justify-center overflow-hidden bg-white ${className}`}
        role="img"
        aria-label={accessibleLabel}
        title={accessibleLabel}
        data-product-sprite-frame="true"
      >
        <div
          className="aspect-square h-full max-h-full max-w-full shrink-0 bg-white"
          aria-hidden="true"
          style={{
            backgroundImage: `url("${spriteFrame.imageUrl}")`,
            backgroundRepeat: 'no-repeat',
            backgroundSize: '800% 3700%',
            backgroundPosition: spriteFrame.backgroundPosition,
          }}
        />
      </div>
    );
  }

  if (src && !failed) {
    return <img src={src} alt={alt || name || ''} className={imgClassName || className} loading="lazy" onError={() => setFailed(true)} />;
  }

  return (
    <div
      className={`flex h-full w-full select-none items-center justify-center bg-gradient-to-br from-ui-page-alt to-ui-surface px-3 ${className}`}
      role="img"
      aria-label={alt || name || fallbackLabel}
      title={fallbackLabel}
      data-product-image-fallback="true"
    >
      <span className="line-clamp-3 max-w-full text-center text-sm font-black leading-5 text-ui-muted sm:text-base">
        {fallbackLabel}
      </span>
    </div>
  );
}
