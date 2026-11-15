'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isAuthed, me, shop, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import type { MyCode } from '@/lib/types';
import { useT, useLang } from '@/lib/i18n';
import { SearchIcon } from '@/components/icons';
import CodeList, { type Revealed } from '@/components/my/CodeList';
import { day, fold } from '@/components/my/when';

/** "أكوادي" (#5): every delivered code in one place, revealed on demand. */
export default function CodesPage() {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  useEffect(() => {
    if (!isAuthed()) router.replace('/login?next=/codes');
  }, [router]);

  const res = useFetch<MyCode[]>(() => me.codes(), []);
  const [q, setQ] = useState('');
  const [codes, setCodes] = useState<Record<string, Revealed[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const name = (c: MyCode) => (lang === 'ar' ? c.productNameAr || c.productNameEn : c.productNameEn || c.productNameAr);
  const list = useMemo(() => {
    const needle = fold(q);
    return (res.data ?? []).filter(
      (c) =>
        !needle ||
        fold(c.orderNumber).includes(needle) ||
        fold(c.productNameAr ?? '').includes(needle) ||
        fold(c.productNameEn ?? '').includes(needle),
    );
  }, [res.data, q]);

  async function reveal(itemId: string) {
    setBusy(itemId);
    setErrors((e) => ({ ...e, [itemId]: '' }));
    try {
      const out = await shop.reveal(itemId);
      setCodes((c) => ({ ...c, [itemId]: out }));
    } catch (err) {
      setErrors((e) => ({ ...e, [itemId]: err instanceof ApiError ? err.message : t('تعذّر إظهار الكود.') }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-page px-4 py-8">
      <h1 className="text-2xl font-extrabold">{t('أكوادي')}</h1>
      <p className="mt-1 text-sm text-muted">{t('كل ما استلمته من أكواد في مكان واحد.')}</p>

      {res.loading && <p className="mt-6 text-sm text-muted">{t('جارٍ التحميل…')}</p>}
      {res.error && (
        <div className="mt-6 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
          {t('تعذّر تحميل أكوادك الآن. حاول بعد قليل.')}
        </div>
      )}

      {!res.loading && !res.error && (res.data?.length ?? 0) === 0 && (
        <div className="mt-8 rounded-2xl border border-[rgb(var(--line))] p-10 text-center text-muted">
          {t('لم يصلك أي كود بعد.')}{' '}
          <Link href="/products" className="font-bold text-teal hover:underline">
            {t('ابدأ التسوّق')}
          </Link>
        </div>
      )}

      {(res.data?.length ?? 0) > 3 && (
        <label className="surface mt-5 flex items-center gap-2 rounded-xl px-3.5 py-2.5">
          <SearchIcon size={17} className="flex-none text-muted" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('ابحث برقم الطلب أو اسم المنتج')}
            aria-label={t('ابحث في أكوادي')}
            className="w-full min-w-0 bg-transparent text-[15px] outline-none"
          />
        </label>
      )}

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {list.map((c) => {
          const shown = codes[c.itemId];
          return (
            <div key={c.itemId} className="surface rounded-2xl p-4 shadow-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-bold">{name(c)}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    <Link href={`/orders/${c.orderId}`} dir="ltr" className="font-semibold hover:text-teal">
                      {c.orderNumber}
                    </Link>
                    {c.deliveredAt && (
                      <>
                        <span aria-hidden>·</span>
                        <span>{day(c.deliveredAt)}</span>
                      </>
                    )}
                  </div>
                </div>
                <span className="flex-none rounded-full bg-teal/10 px-2.5 py-1 text-xs font-bold text-teal tnum">
                  ×{c.quantity}
                </span>
              </div>
              {shown ? (
                <CodeList values={shown} product={name(c)} />
              ) : (
                <button
                  onClick={() => reveal(c.itemId)}
                  disabled={busy === c.itemId}
                  className="btn-brand mt-3 rounded-xl px-4 py-2 text-sm font-bold disabled:opacity-60"
                >
                  {busy === c.itemId ? t('جارٍ…') : t('إظهار الكود')}
                </button>
              )}
              {errors[c.itemId] && <p className="mt-2 text-sm text-bad">{errors[c.itemId]}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
