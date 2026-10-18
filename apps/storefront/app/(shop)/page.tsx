'use client';

import Link from 'next/link';
import { catalog } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import type { Category, Paginated, Product } from '@/lib/types';
import ProductCard from '@/components/ProductCard';
import Price from '@/components/Price';
import { BoltIcon, ShieldIcon, CheckIcon } from '@/components/icons';

function SkeletonCard() {
  return (
    <div className="surface overflow-hidden rounded-2xl">
      <div className="aspect-[4/3] animate-pulse bg-[rgb(var(--surface-2))]" />
      <div className="space-y-2 p-4">
        <div className="h-4 w-3/4 animate-pulse rounded bg-[rgb(var(--surface-2))]" />
        <div className="h-4 w-1/3 animate-pulse rounded bg-[rgb(var(--surface-2))]" />
      </div>
    </div>
  );
}

export default function HomePage() {
  const featured = useFetch<Paginated<Product>>(() => catalog.products({ isFeatured: true, limit: 8 }), []);
  const latest = useFetch<Paginated<Product>>(() => catalog.products({ limit: 12 }), []);
  const cats = useFetch<Category[]>(() => catalog.categories(), []);

  // Fall back to latest when nothing is flagged featured.
  const heroProducts = (featured.data?.data?.length ? featured.data.data : latest.data?.data ?? []).slice(0, 4);
  const grid = featured.data?.data?.length ? featured.data.data : latest.data?.data ?? [];

  return (
    <div>
      {/* ───────── Hero ───────── */}
      <section className="relative overflow-hidden border-b border-[rgb(var(--line))]">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              'radial-gradient(680px 340px at 88% 10%, rgba(233,196,90,.16), transparent 60%),' +
              'radial-gradient(760px 440px at 8% 92%, rgba(45,212,191,.20), transparent 58%)',
          }}
        />
        <div className="mx-auto grid max-w-page items-center gap-10 px-4 py-14 lg:grid-cols-2 lg:py-20">
          <div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-teal/10 px-3 py-1 text-xs font-bold text-teal">
              <BoltIcon size={13} /> تسليم لحظي بعد الدفع
            </span>
            <h1 className="mt-4 text-4xl font-extrabold leading-[1.15] md:text-5xl">
              شحن الألعاب والبطاقات الرقمية
              <br />
              <span className="text-teal">في مكان واحد</span>
            </h1>
            <p className="mt-4 max-w-md text-[15px] leading-relaxed text-muted">
              اختر منتجك، ادفع بأمان، واستلم الكود فورًا. أسعار واضحة بلا مفاجآت.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href="/products" className="btn-brand rounded-xl px-6 py-3 text-[15px] font-bold">
                تصفّح المنتجات
              </Link>
              <Link
                href="/orders"
                className="rounded-xl border border-[rgb(var(--line))] px-6 py-3 text-[15px] font-bold text-muted transition hover:text-[rgb(var(--text))]"
              >
                تتبّع طلب
              </Link>
            </div>
          </div>

          {/* real product preview, not a fake mock */}
          <div className="grid grid-cols-2 gap-3">
            {heroProducts.length === 0
              ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
              : heroProducts.map((p) => (
                  <Link
                    key={p.id}
                    href={`/products/${p.id}`}
                    className="surface flex flex-col gap-2 rounded-2xl p-3 shadow-card transition hover:shadow-float"
                  >
                    <div
                      className="grid aspect-square place-items-center overflow-hidden rounded-xl text-2xl font-extrabold text-teal/40"
                      style={{ backgroundColor: '#2dd4bf18' }}
                    >
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.imageUrl} alt={p.nameAr} className="h-full w-full object-cover" />
                      ) : (
                        (p.nameAr || p.nameEn).slice(0, 1)
                      )}
                    </div>
                    <div className="line-clamp-1 text-[13px] font-bold">{p.nameAr || p.nameEn}</div>
                    <Price product={p} size="sm" />
                  </Link>
                ))}
          </div>
        </div>
      </section>

      {/* ───────── trust strip ───────── */}
      <section className="border-b border-[rgb(var(--line))] bg-[rgb(var(--surface))]">
        <div className="mx-auto flex max-w-page flex-wrap items-center justify-center gap-x-8 gap-y-3 px-4 py-4 text-sm font-semibold">
          <span className="inline-flex items-center gap-2 text-muted">
            <BoltIcon size={16} className="text-teal" /> استلام فوري
          </span>
          <span className="inline-flex items-center gap-2 text-muted">
            <ShieldIcon size={16} className="text-teal" /> دفع مشفّر
          </span>
          <span className="inline-flex items-center gap-2 text-muted">
            <CheckIcon size={16} className="text-teal" /> أكواد أصلية مضمونة
          </span>
        </div>
      </section>

      {/* ───────── categories ───────── */}
      {(cats.data?.length ?? 0) > 0 && (
        <section className="mx-auto max-w-page px-4 py-10">
          <h2 className="text-xl font-extrabold">تسوّق حسب الفئة</h2>
          <div className="mt-5 flex flex-wrap gap-2.5">
            {cats.data!.map((c) => (
              <Link
                key={c.id}
                href={`/products?categoryId=${c.id}`}
                className="surface rounded-full px-4 py-2 text-sm font-bold transition hover:border-teal hover:text-teal"
              >
                {c.nameAr || c.nameEn}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* ───────── products ───────── */}
      <section className="mx-auto max-w-page px-4 py-6 pb-16">
        <div className="flex items-end justify-between">
          <h2 className="text-xl font-extrabold">{featured.data?.data?.length ? 'الأكثر طلبًا' : 'أحدث المنتجات'}</h2>
          <Link href="/products" className="text-sm font-bold text-teal hover:underline">
            عرض الكل
          </Link>
        </div>

        {(featured.error || latest.error) && (
          <div className="mt-6 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
            تعذّر تحميل المنتجات حاليًا. حدّث الصفحة بعد قليل.
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {featured.loading && latest.loading
            ? Array.from({ length: 8 }).map((_, i) => <SkeletonCard key={i} />)
            : grid.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>

        {!latest.loading && grid.length === 0 && !featured.error && !latest.error && (
          <div className="mt-8 rounded-2xl border border-[rgb(var(--line))] p-10 text-center text-muted">
            لا توجد منتجات متاحة بعد. عُد قريبًا!
          </div>
        )}
      </section>
    </div>
  );
}
