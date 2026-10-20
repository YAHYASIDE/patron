'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { isAuthed } from '@/lib/api';
import { groupBrands, useCatalog } from '@/lib/brands';
import { useCurrency } from '@/lib/currency';
import { useFavorites, useFavoritesReady } from '@/lib/favorites';
import { useT } from '@/lib/i18n';
import BrandGrid from '@/components/BrandGrid';
import { HeartIcon } from '@/components/my/icons';

/**
 * The favourites page (#6): the brands the customer hearted, as the same tiles
 * as the shop. The list is the shared one the hearts write (lib/favorites.ts):
 * the account's for a signed-in customer, this browser's for a guest, so
 * un-hearting a tile here removes it at once.
 */
export default function FavoritesPage() {
  const t = useT();
  const currency = useCurrency();
  const { products, error, loading, reload } = useCatalog(currency);
  const keys = useFavorites();
  const ready = useFavoritesReady();

  const brands = useMemo(() => {
    if (!products) return [];
    const byKey = new Map(groupBrands(products).map((b) => [b.key, b]));
    return keys.map((k) => byKey.get(k)).filter((b) => b !== undefined);
  }, [products, keys]);

  const busy = loading || !ready;

  return (
    <div className="mx-auto max-w-page px-4 py-8">
      <h1 className="text-2xl font-extrabold">{t('المفضّلة')}</h1>
      {!isAuthed() && ready && (
        <p className="mt-1 text-sm text-muted">
          {t('مفضّلتك محفوظة على هذا الجهاز فقط.')}{' '}
          <Link href="/login?next=/favorites" className="font-bold text-teal hover:underline">
            {t('سجّل الدخول لحفظها في حسابك')}
          </Link>
        </p>
      )}

      {error && (
        <div className="mt-6 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
          {error}{' '}
          <button onClick={reload} className="font-bold underline">
            {t('إعادة المحاولة')}
          </button>
        </div>
      )}

      {!busy && !error && brands.length === 0 && (
        <div className="mt-8 rounded-2xl border border-[rgb(var(--line))] p-10 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-teal/10 text-teal">
            <HeartIcon size={26} />
          </div>
          <p className="mt-4 font-bold">{t('لا توجد مفضّلة بعد')}</p>
          <p className="mt-1 text-sm text-muted">{t('اضغط على القلب في أي منتج ليظهر هنا.')}</p>
          <Link href="/products" className="btn-brand mt-5 inline-block rounded-xl px-6 py-2.5 text-sm font-bold">
            {t('تصفّح المنتجات')}
          </Link>
        </div>
      )}

      {(busy || brands.length > 0) && !error && (
        <div className="mt-6">
          <BrandGrid brands={brands} loading={busy} />
        </div>
      )}
    </div>
  );
}
