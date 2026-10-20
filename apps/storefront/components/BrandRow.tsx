'use client';

import { useEffect, useState } from 'react';
import { brandKey, type Brand } from '@/lib/brands';
import { store } from '@/lib/api';
import type { Product } from '@/lib/types';
import BrandTile from './BrandTile';

/**
 * A titled row of brand tiles that scrolls sideways on phones (4 in view)
 * and shows up to 8 across on wide screens. Nothing renders when empty.
 */
export default function BrandRow({
  title,
  icon,
  brands,
  action,
}: {
  title: string;
  icon?: React.ReactNode;
  brands: Brand[];
  action?: React.ReactNode;
}) {
  if (brands.length === 0) return null;
  return (
    <section className="mx-auto max-w-page px-4 pt-7">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl font-extrabold">
          {icon && <span className="text-teal">{icon}</span>}
          {title}
        </h2>
        {action}
      </div>
      <div className="-mx-4 mt-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex gap-2.5">
          {brands.slice(0, 8).map((b) => (
            <div
              key={b.key}
              className="w-[calc((100%-3*0.625rem)/4)] flex-none sm:w-[calc((100%-4*0.625rem)/5)] md:w-[calc((100%-6*0.625rem)/7)] lg:w-[calc((100%-7*0.625rem)/8)]"
            >
              <BrandTile brand={b} size="sm" />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/** Brands for the given keys, in that order, skipping ones no longer sold. */
export function brandsByKeys(brands: Brand[], keys: string[]): Brand[] {
  const byKey = new Map(brands.map((b) => [b.key, b]));
  return keys.map((k) => byKey.get(k)).filter((b): b is Brand => !!b);
}

/**
 * The brands that sold most in the last 30 days (GET /catalog/best-sellers),
 * one entry per brand, best first. Empty while loading, when nothing sold yet
 * or when the API does not answer.
 */
export function useBestSellers(brands: Brand[], products: Product[] | null): Brand[] {
  const [keys, setKeys] = useState<string[]>([]);
  useEffect(() => {
    if (!products) return;
    let alive = true;
    const byId = new Map(products.map((p) => [p.id, p]));
    const bySku = new Map(products.map((p) => [p.sku, p]));
    store
      .bestSellers(12)
      .then((rows) => {
        if (!alive || !Array.isArray(rows)) return;
        const out: string[] = [];
        for (const r of rows) {
          const p = byId.get(r.productId) ?? bySku.get(r.sku);
          const k = p ? brandKey(p) : null;
          if (k && !out.includes(k)) out.push(k);
        }
        setKeys(out);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [products]);
  return brandsByKeys(brands, keys);
}
