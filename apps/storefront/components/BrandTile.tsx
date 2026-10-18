import Link from 'next/link';
import type { Brand } from '@/lib/brands';
import { money } from '@/lib/format';

/** One brand in the shop grid: its card, its name, and the lowest price. */
export default function BrandTile({ brand, size = 'md' }: { brand: Brand; size?: 'md' | 'lg' }) {
  const from = brand.products[0];
  const allOut = brand.products.every((p) => p.inStock === false);

  return (
    <Link
      href={`/brands/${brand.key}`}
      className={'group flex flex-col gap-2.5 ' + (size === 'lg' ? 'w-36 flex-none snap-start sm:w-44' : '')}
    >
      <div className="relative aspect-square overflow-hidden rounded-2xl bg-[rgb(var(--surface-2))] shadow-card transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-float group-active:scale-[0.98]">
        {brand.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.image} alt={brand.title} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-4xl font-extrabold text-teal/40">
            {brand.title.slice(0, 1)}
          </div>
        )}
        {brand.maxDiscount > 0 && (
          // dir=ltr keeps the minus in front ("-5%") inside right-to-left text
          <span
            dir="ltr"
            className="absolute start-2 top-2 rounded-full bg-gold px-2 py-0.5 text-[11px] font-extrabold text-ink-950"
          >
            -{brand.maxDiscount}%
          </span>
        )}
      </div>
      <div className="px-0.5">
        <div className="line-clamp-2 min-h-[2.5em] text-[14px] font-bold leading-[1.25]">{brand.title}</div>
        <div className="mt-0.5 text-xs text-muted">
          {allOut ? (
            'غير متوفّر حاليًا'
          ) : (
            <>
              من <span className="tnum font-bold text-teal">{money(from.sellPrice, from.currency)}</span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}

export function BrandTileSkeleton() {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="aspect-square animate-pulse rounded-2xl bg-[rgb(var(--surface-2))]" />
      <div className="h-4 w-3/4 animate-pulse rounded bg-[rgb(var(--surface-2))]" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-[rgb(var(--surface-2))]" />
    </div>
  );
}
