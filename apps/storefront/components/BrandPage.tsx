'use client';

import { useEffect, useMemo } from 'react';
import Link from 'next/link';
import { groupBrands, useCatalog, type Brand } from '@/lib/brands';
import { useCurrency } from '@/lib/currency';
import { useT } from '@/lib/i18n';
import { sectionOf } from '@/lib/sections';
import { noteCatalog } from '@/lib/fresh';
import { useBrandRestriction } from '@/lib/markets';
import { useRegion } from '@/lib/regions';
import { useMe } from '@/lib/session';
import BrandView from './BrandView';
import { ShieldIcon } from './icons';

const NOTICE = {
  UNAVAILABLE: 'هذا المنتج غير متاح للاستخدام في بلدك. تأكّد قبل الشراء.',
  REGION_ACCOUNT_REQUIRED:
    'هذا المنتج يعمل فقط مع حساب من منطقته (مثل حساب أمريكي لبطاقة أمريكية). تأكّد من منطقة حسابك قبل الشراء.',
} as const;

/**
 * A short notice when the owner approved a rule saying this brand does not work
 * in the customer's region, or needs an account from its own region. Shows
 * nothing while loading, when there is no such rule, or when the call fails.
 */
function MarketNotice({ brandKey }: { brandKey: string }) {
  const t = useT();
  const { me } = useMe();
  const restriction = useBrandRestriction(brandKey, useRegion(me));
  if (!restriction) return null;
  return (
    <div className="mx-auto max-w-page px-4 pt-4">
      <p
        role="note"
        className="flex items-start gap-2 rounded-xl bg-warn/10 px-3 py-2 text-sm font-semibold leading-relaxed text-warn"
      >
        <ShieldIcon size={16} className="mt-0.5 flex-none" />
        {t(NOTICE[restriction])}
      </p>
    </div>
  );
}

/**
 * Loads the catalog and shows one brand: by its key (/brands/gc-apple-us), or
 * the brand of a product id or SKU with that denomination selected (/products/:id).
 */
export default function BrandPage({ brandKey, productRef }: { brandKey?: string; productRef?: string }) {
  const t = useT();
  const currency = useCurrency();
  const { products, error, loading, reload } = useCatalog(currency);
  const brands: Brand[] = useMemo(() => (products ? groupBrands(products) : []), [products]);
  useEffect(() => noteCatalog(brands), [brands]);
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
        <p className="text-muted">{error ?? t('هذا المنتج غير متاح حاليًا.')}</p>
        <div className="mt-4 flex justify-center gap-4">
          {error && (
            <button onClick={reload} className="font-bold text-teal hover:underline">
              {t('إعادة المحاولة')}
            </button>
          )}
          <Link href="/products" className="font-bold text-teal hover:underline">
            {t('تصفّح المتجر')}
          </Link>
        </div>
      </div>
    );
  }

  const section = sectionOf(brand).id;
  const related = brands.filter((b) => sectionOf(b).id === section && b.key !== brand.key).slice(0, 8);
  return (
    <>
      <MarketNotice brandKey={brand.key} />
      <BrandView key={brand.key} brand={brand} initialId={product?.id} related={related} />
    </>
  );
}
