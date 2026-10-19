'use client';

import Link from 'next/link';
import type { Brand } from '@/lib/brands';
import { money } from '@/lib/format';
import { useT } from '@/lib/i18n';

const SIZES = {
  // four to a row on phones, like app icons
  sm: { radius: 'rounded-xl', name: 'text-[12px] sm:text-[13px]', price: 'text-[11px]', gap: 'gap-1.5' },
  md: { radius: 'rounded-2xl', name: 'text-[14px]', price: 'text-xs', gap: 'gap-2.5' },
} as const;

/** One brand in the shop grid: its card, its name, and the lowest price. */
export default function BrandTile({ brand, size = 'md' }: { brand: Brand; size?: keyof typeof SIZES }) {
  const t = useT();
  const s = SIZES[size];
  const from = brand.products[0];
  const allOut = brand.products.every((p) => p.inStock === false);

  return (
    <Link href={`/brands/${brand.key}`} className={`group flex min-w-0 flex-col ${s.gap}`}>
      <div
        className={`relative aspect-square overflow-hidden ${s.radius} bg-[rgb(var(--surface-2))] shadow-card transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-float group-active:scale-[0.97]`}
      >
        {brand.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.image} alt={brand.title} loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="grid h-full w-full place-items-center text-3xl font-extrabold text-teal/40">
            {brand.title.slice(0, 1)}
          </div>
        )}
        {brand.maxDiscount > 0 && (
          // dir=ltr keeps the minus in front ("-5%") inside right-to-left text
          <span
            dir="ltr"
            className="absolute start-1.5 top-1.5 rounded-full bg-gold px-1.5 py-0.5 text-[10px] font-extrabold text-ink-950"
          >
            -{brand.maxDiscount}%
          </span>
        )}
      </div>
      <div className="px-0.5">
        <div className={`line-clamp-2 min-h-[2.5em] font-bold leading-[1.25] ${s.name}`}>{brand.title}</div>
        <div className={`mt-0.5 text-muted ${s.price}`}>
          {allOut ? (
            t('غير متوفّر')
          ) : (
            <>
              {t('من')}{' '}
              <span className="tnum font-bold text-teal">{money(from.sellPrice, from.currency)}</span>
            </>
          )}
        </div>
      </div>
    </Link>
  );
}

export function BrandTileSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <div className="aspect-square animate-pulse rounded-xl bg-[rgb(var(--surface-2))]" />
      <div className="h-3.5 w-3/4 animate-pulse rounded bg-[rgb(var(--surface-2))]" />
      <div className="h-3 w-1/2 animate-pulse rounded bg-[rgb(var(--surface-2))]" />
    </div>
  );
}
