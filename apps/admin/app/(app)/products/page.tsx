'use client';

import { useState } from 'react';
import { useFetch } from '@/lib/hooks';
import { num, money } from '@/lib/format';

type Product = {
  id: string;
  sku: string;
  type: string;
  delivery: string;
  nameAr: string;
  nameEn: string;
  sellPrice: number | string;
  stockQty: number;
  isActive: boolean;
  isFeatured: boolean;
  category?: { nameEn?: string };
  game?: { nameEn?: string };
};
type Paginated<T> = { data: T[]; meta?: { page: number; limit: number; total: number; pages: number } };

const TYPE_LABEL: Record<string, string> = {
  GAME_TOPUP: 'شحن ألعاب',
  GIFT_CARD: 'بطاقة هدايا',
  SUBSCRIPTION: 'اشتراك',
  LICENSE: 'ترخيص',
};
const DELIVERY_LABEL: Record<string, string> = {
  CODE_POOL: 'مخزون أكواد',
  MANUAL: 'يدوي',
  AUTO_PROVIDER: 'تلقائي',
};

export default function ProductsPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  const qs = new URLSearchParams({ page: String(page), limit: '20' });
  if (query) qs.set('search', query);
  const { data, error, loading } = useFetch<Paginated<Product>>(
    `/admin/catalog/products?${qs.toString()}`,
  );

  const meta = data?.meta;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">المنتجات</h1>
          <p className="mt-1 text-sm text-muted">
            {meta ? `${num(meta.total)} منتج في الكتالوج` : 'كتالوج المتجر'}
          </p>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setQuery(search.trim());
          }}
          className="flex gap-2"
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث بالاسم أو SKU…"
            className="surface-2 hairline w-56 rounded-xl border px-3.5 py-2 text-sm outline-none focus:border-teal"
          />
          <button className="rounded-xl bg-teal px-4 py-2 text-sm font-bold text-white hover:bg-teal-deep">
            بحث
          </button>
        </form>
      </div>

      {error && (
        <div className="rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
          تعذّر جلب المنتجات: {error}
        </div>
      )}

      <div className="surface overflow-hidden rounded-2xl shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="surface-2 text-muted">
                {['المنتج', 'النوع', 'التسليم', 'المخزون', 'السعر', 'الحالة'].map((h) => (
                  <th key={h} className="px-5 py-3 text-start text-xs font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-muted">
                    جارٍ التحميل…
                  </td>
                </tr>
              )}
              {!loading && (data?.data?.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-muted">
                    لا توجد منتجات مطابقة.
                  </td>
                </tr>
              )}
              {data?.data?.map((p) => {
                const auto = p.delivery === 'AUTO_PROVIDER';
                const out = !auto && p.stockQty <= 0;
                return (
                  <tr key={p.id} className="border-t hairline">
                    <td className="px-5 py-3">
                      <div className="font-semibold">{p.nameAr}</div>
                      <div className="text-xs text-muted" dir="ltr">
                        {p.sku}
                        {p.game?.nameEn ? ` · ${p.game.nameEn}` : ''}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-muted">{TYPE_LABEL[p.type] ?? p.type}</td>
                    <td className="px-5 py-3 text-muted">{DELIVERY_LABEL[p.delivery] ?? p.delivery}</td>
                    <td className="px-5 py-3 tnum">{auto ? '∞' : num(p.stockQty)}</td>
                    <td className="px-5 py-3 tnum font-semibold">{money(p.sellPrice)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                            out ? 'bg-bad/12 text-bad' : p.isActive ? 'bg-ok/12 text-ok' : 'bg-ink-400/15 text-muted'
                          }`}
                        >
                          {out ? 'نفد' : p.isActive ? 'نشط' : 'موقوف'}
                        </span>
                        {p.isFeatured && (
                          <span className="rounded-full bg-gold/15 px-2.5 py-1 text-xs font-bold text-gold-deep">
                            مميّز
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {meta && meta.pages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-lg border border-[rgb(var(--line))] px-3.5 py-1.5 text-sm font-semibold disabled:opacity-40"
          >
            السابق
          </button>
          <span className="tnum text-sm text-muted">
            صفحة {num(meta.page)} من {num(meta.pages)}
          </span>
          <button
            disabled={page >= meta.pages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-lg border border-[rgb(var(--line))] px-3.5 py-1.5 text-sm font-semibold disabled:opacity-40"
          >
            التالي
          </button>
        </div>
      )}
    </div>
  );
}
