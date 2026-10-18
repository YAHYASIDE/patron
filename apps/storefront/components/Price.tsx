import type { Product } from '@/lib/types';
import { money } from '@/lib/format';

const SIZES = {
  sm: { now: 'text-sm', was: 'text-[11px]', badge: 'text-[10px] px-1.5 py-0.5' },
  md: { now: 'text-lg', was: 'text-xs', badge: 'text-[11px] px-2 py-0.5' },
  lg: { now: 'text-3xl', was: 'text-base', badge: 'text-xs px-2.5 py-1' },
} as const;

/**
 * A product's price as the customer pays it. When the owner set a discount,
 * the original price is shown struck through with the percent beside it. The
 * API computes both numbers, so this never does price math itself.
 */
export default function Price({
  product,
  size = 'md',
}: {
  product: Pick<Product, 'sellPrice' | 'listPrice' | 'discountPercent' | 'currency'>;
  size?: keyof typeof SIZES;
}) {
  const s = SIZES[size];
  const discounted =
    (product.discountPercent ?? 0) > 0 &&
    product.listPrice !== undefined &&
    parseFloat(product.listPrice) > parseFloat(product.sellPrice);

  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className={`tnum font-extrabold text-teal ${s.now}`}>{money(product.sellPrice, product.currency)}</span>
      {discounted && (
        <>
          <span className={`tnum text-muted line-through ${s.was}`}>{money(product.listPrice, product.currency)}</span>
          {/* dir=ltr keeps the minus in front ("-5%") inside right-to-left text */}
          <span dir="ltr" className={`rounded-full bg-gold/15 font-bold text-gold-deep ${s.badge}`}>
            -{product.discountPercent}%
          </span>
        </>
      )}
    </span>
  );
}
