import Link from 'next/link';
import type { Product } from '@/lib/types';
import { money } from '@/lib/format';
import { BoltIcon } from './icons';

function deliveryLabel(delivery?: string): string | null {
  if (delivery === 'AUTO_PROVIDER' || delivery === 'CODE_POOL') return 'تسليم فوري';
  if (delivery === 'MANUAL') return 'تجهيز يدوي';
  return null;
}

// Deterministic soft tint for the image fallback, so cards vary without images.
const TINTS = ['#2dd4bf22', '#c79a3a22', '#60a5fa22', '#34d39922', '#f9731622', '#a78bfa22'];
function tintFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % TINTS.length;
  return TINTS[h];
}

export default function ProductCard({ product }: { product: Product }) {
  const name = product.nameAr || product.nameEn;
  const badge = deliveryLabel(product.delivery);
  const out = product.inStock === false;

  return (
    <Link
      href={`/products/${product.id}`}
      className="group surface flex flex-col overflow-hidden rounded-2xl shadow-card transition hover:shadow-float"
    >
      <div className="relative aspect-[4/3] overflow-hidden" style={{ backgroundColor: tintFor(product.id) }}>
        {product.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.imageUrl}
            alt={name}
            loading="lazy"
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="grid h-full w-full place-items-center text-4xl font-extrabold text-teal/40">
            {name.slice(0, 1)}
          </div>
        )}
        {badge && (
          <span className="absolute top-2 end-2 inline-flex items-center gap-1 rounded-full bg-[rgb(var(--surface))]/90 px-2 py-1 text-[11px] font-bold text-teal backdrop-blur">
            <BoltIcon size={12} />
            {badge}
          </span>
        )}
        {out && (
          <span className="absolute top-2 start-2 rounded-full bg-bad/90 px-2 py-1 text-[11px] font-bold text-white">
            غير متوفّر
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="line-clamp-2 text-[15px] font-bold leading-snug">{name}</h3>
        {product.game?.nameAr && <p className="text-xs text-muted">{product.game.nameAr}</p>}
        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="tnum text-lg font-extrabold text-teal">{money(product.sellPrice, product.currency)}</span>
          <span className="rounded-lg bg-teal/10 px-3 py-1.5 text-xs font-bold text-teal transition group-hover:bg-teal group-hover:text-white">
            عرض
          </span>
        </div>
      </div>
    </Link>
  );
}
