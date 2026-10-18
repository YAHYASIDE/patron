'use client';

import Link from 'next/link';
import { groupBrands, useCatalog, type Brand } from '@/lib/brands';
import { useCurrency } from '@/lib/currency';
import BrandView from './BrandView';

/**
 * Loads the catalog and shows one brand: by its key (/brands/gc-apple-us), or
 * the brand of a product id or SKU with that denomination selected (/products/:id).
 */
export default function BrandPage({ brandKey, productRef }: { brandKey?: string; productRef?: string }) {
  const currency = useCurrency();
  const { products, error, loading, reload } = useCatalog(currency);
  const brands: Brand[] = products ? groupBrands(products) : [];
  const product = productRef ? products?.find((p) => p.id === productRef || p.sku === productRef) : undefined;
  const brand = brands.find((b) => (product ? b.products.includes(product) : b.key === brandKey));

  if (loading) {
    return (
      <div className="mx-auto grid max-w-page gap-5 px-4 py-8 lg:grid-cols-[320px_1fr]">
        <div className="h-32 animate-pulse rounded-2xl bg-[rgb(var(--surface-2))] lg:h-96" />
        <div className="space-y-4">
          <div className="h-36 animate-pulse rounded-2xl bg-[rgb(var(--surface-2))]" />
          <div className="h-56 animate-pulse rounded-2xl bg-[rgb(var(--surface-2))]" />
        </div>
      </div>
    );
  }

  if (error || !brand) {
    return (
      <div className="mx-auto max-w-page px-4 py-20 text-center">
        <p className="text-muted">{error ?? 'هذا المنتج غير متاح حاليًا.'}</p>
        <div className="mt-4 flex justify-center gap-4">
          {error && (
            <button onClick={reload} className="font-bold text-teal hover:underline">
              إعادة المحاولة
            </button>
          )}
          <Link href="/products" className="font-bold text-teal hover:underline">
            تصفّح المتجر
          </Link>
        </div>
      </div>
    );
  }

  const related = brands.filter((b) => b.categoryId === brand.categoryId && b.key !== brand.key).slice(0, 6);
  return <BrandView key={brand.key} brand={brand} initialId={product?.id} related={related} />;
}
