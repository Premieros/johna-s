/** Scale a per-unit price when changing compatible purchase units. */
export function convertPurchaseUnitPrice(price: number, from: string, to: string): number | null {
  const unit = (label: string): [string, number] => {
    const v = label.trim().toLowerCase();
    if (['kg', 'kgs', 'kilogram', 'kilograms', 'كجم', 'كغ', 'كيلو', 'ك'].includes(v)) return ['mass', 1000];
    if (['g', 'gr', 'gm', 'gram', 'grams', 'جم', 'جرام'].includes(v)) return ['mass', 1];
    if (['l', 'lt', 'liter', 'litre', 'liters', 'litres', 'liter', 'ل', 'لتر'].includes(v)) return ['volume', 1000];
    if (['ml', 'mil', 'milliliter', 'milliliters', 'مل'].includes(v)) return ['volume', 1];
    return [v, 1];
  };
  const a = unit(from); const b = unit(to);
  if (!Number.isFinite(price) || price < 0 || a[0] !== b[0]) return null;
  return price * b[1] / a[1];
}
