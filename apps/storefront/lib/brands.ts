'use client';

import { useEffect, useState } from 'react';
import { catalog } from './api';
import aliases from './brand-aliases.json';
import type { Product } from './types';

/**
 * The catalog stores one product per denomination (PUBG 60 UC, PUBG 325 UC…).
 * Shoppers think in brands, so the shop groups them: a product with a game
 * belongs to that game; any other product groups with the SKUs that share its
 * stem (GC-APPLE-US-25 and GC-APPLE-US-50 are both "gc-apple-us").
 */
export type Brand = {
  key: string;
  title: string;
  image: string | null;
  categoryId: string | null;
  categoryName: string | null;
  categorySlug: string | null;
  /** Denominations, cheapest first. */
  products: Product[];
  featured: boolean;
  /** Largest discount among its denominations (0 when none). */
  maxDiscount: number;
};

const ALIASES: Record<string, string> = aliases;

export function brandKey(p: Pick<Product, 'sku' | 'game'>): string {
  if (p.game?.slug) return `g-${p.game.slug}`;
  const parts = p.sku.toLowerCase().split('-');
  const key = parts.length > 1 ? parts.slice(0, -1).join('-') : parts[0];
  return ALIASES[key] ?? key; // e.g. the Microsoft 365 Personal and Family plans are one brand
}

const words = (s: string) => s.trim().split(/\s+/);

/** Words every name starts with / ends with (the brand part, not the amount). */
function commonEdges(names: string[]): { head: string[]; tail: string[] } {
  if (names.length < 2) return { head: [], tail: [] };
  const lists = names.map(words);
  const shortest = Math.min(...lists.map((l) => l.length));
  let h = 0;
  while (h < shortest - 1 && lists.every((l) => l[h] === lists[0][h])) h++;
  let t = 0;
  while (
    t < shortest - 1 - h &&
    lists.every((l) => l[l.length - 1 - t] === lists[0][lists[0].length - 1 - t])
  )
    t++;
  // a one-word tail is the unit ("660 شدة", "200 أوقية") and stays; a longer one is a shared note
  return { head: lists[0].slice(0, h), tail: t > 1 ? lists[0].slice(-t) : [] };
}

/** "PUBG Mobile 660 UC" in a PUBG brand → "660 UC". */
export function denominationLabel(p: Product, brand: Brand): string {
  const name = p.nameAr || p.nameEn;
  if (brand.products.length < 2) return name;
  // the brand name in front is the common case ("ببجي موبايل 660 شدة")
  if (name.startsWith(brand.title + ' ')) return name.slice(brand.title.length + 1);
  const { head, tail } = commonEdges(brand.products.map((x) => x.nameAr || x.nameEn));
  const w = words(name);
  const middle = w.slice(head.length, w.length - tail.length).join(' ');
  return middle || name;
}

// Pack art lives at <storefront>/art/<sku>.svg; its brand-level card sits at /art/brand/<key>.svg.
const PACK_ART = /\/art\/[a-z0-9-]+\.svg$/;

export function groupBrands(products: Product[]): Brand[] {
  const map = new Map<string, Product[]>();
  for (const p of products) {
    const k = brandKey(p);
    map.set(k, [...(map.get(k) ?? []), p]);
  }
  const brands: Brand[] = [];
  for (const [key, list] of map) {
    list.sort((a, b) => parseFloat(a.sellPrice) - parseFloat(b.sellPrice));
    const first = list[0];
    const names = list.map((x) => x.nameAr || x.nameEn);
    const { head } = commonEdges(names);
    const title = first.game?.nameAr || (head.length ? head.join(' ') : names[0]);
    const withImage = list.find((x) => x.imageUrl);
    const image = withImage?.imageUrl
      ? PACK_ART.test(withImage.imageUrl)
        ? withImage.imageUrl.replace(PACK_ART, `/art/brand/${key}.svg`)
        : withImage.imageUrl
      : null;
    brands.push({
      key,
      title,
      image,
      categoryId: first.category?.id ?? first.categoryId ?? null,
      categoryName: first.category?.nameAr ?? null,
      categorySlug: first.category?.slug ?? null,
      products: list,
      featured: list.some((x) => x.isFeatured),
      maxDiscount: Math.max(0, ...list.map((x) => x.discountPercent ?? 0)),
    });
  }
  return brands;
}

// The whole active catalog, once per currency per visit: a hundred-odd rows in two pages.
const cache = new Map<string, Promise<Product[]>>();

async function loadAll(currency: string): Promise<Product[]> {
  const first = await catalog.products({ limit: 100, page: 1, currency });
  const rest = await Promise.all(
    Array.from({ length: Math.max(0, first.meta.pages - 1) }, (_, i) =>
      catalog.products({ limit: 100, page: i + 2, currency }),
    ),
  );
  return [first, ...rest].flatMap((r) => r.data);
}

export function useCatalog(currency: string) {
  const [state, setState] = useState<{ products: Product[] | null; error: string | null }>({
    products: null,
    error: null,
  });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setState((s) => ({ products: s.products?.[0]?.currency === currency ? s.products : null, error: null }));
    let p = cache.get(currency);
    if (!p) {
      p = loadAll(currency);
      cache.set(currency, p);
      p.catch(() => cache.delete(currency)); // a failed load is retried next time
    }
    p.then((products) => alive && setState({ products, error: null })).catch(
      () => alive && setState({ products: null, error: 'تعذّر تحميل المنتجات. حاول مرة أخرى.' }),
    );
    return () => {
      alive = false;
    };
  }, [currency, tick]);

  return { ...state, loading: !state.products && !state.error, reload: () => setTick((t) => t + 1) };
}
