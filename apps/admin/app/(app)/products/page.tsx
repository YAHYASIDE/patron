'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useFetch } from '@/lib/hooks';
import { num, money, moneyIn } from '@/lib/format';
import type { AdminProduct } from '@/lib/api';
import BulkPrice from '@/components/BulkPrice';
import QuickEdit from '@/components/QuickEdit';
import { localListPrice, usePriceSetup } from '@/components/PriceFields';

type Product = AdminProduct & {
  category?: { nameEn?: string };
  game?: { nameEn?: string };
  _count?: { codes?: number };
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
  const [saved, setSaved] = useState(false);
  const [bulk, setBulk] = useState(false);
  // ticked rows for the bulk price tool, kept across pages
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  // quick edit: the open row, rows saved since the last fetch, and a short "saved" line
  const [quick, setQuick] = useState<Product | null>(null);
  const [edited, setEdited] = useState<Record<string, Product>>({});
  const [quickSaved, setQuickSaved] = useState<string | null>(null);
  const pricing = usePriceSetup();
  // the local price shown next to the dollar (ouguiya first)
  const local = pricing.local[0];

  // brief confirmation after returning from the add/edit form (?saved=1)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('saved')) {
      setSaved(true);
      window.history.replaceState(null, '', '/products');
      const t = setTimeout(() => setSaved(false), 3500);
      return () => clearTimeout(t);
    }
  }, []);

  const qs = new URLSearchParams({ page: String(page), limit: '20' });
  if (query) qs.set('search', query);
  const { data, error, loading, reload } = useFetch<Paginated<Product>>(
    `/admin/catalog/products?${qs.toString()}`,
  );

  const meta = data?.meta;
  const cols = bulk ? 7 : 6;
  const rows = data?.data?.map((p) => edited[p.id] ?? p);

  // a fresh page (search, paging, bulk price) replaces any row saved in place
  useEffect(() => setEdited({}), [data]);
  useEffect(() => {
    if (!quickSaved) return;
    const t = setTimeout(() => setQuickSaved(null), 3500);
    return () => clearTimeout(t);
  }, [quickSaved]);

  const closeQuick = useCallback(() => setQuick(null), []);
  const onQuickSaved = useCallback((row: Product) => {
    setEdited((m) => ({ ...m, [row.id]: row }));
    setQuick(null);
    setQuickSaved(row.nameAr);
  }, []);

  function toggle(p: Product) {
    setPicked((m) => {
      const next = new Map(m);
      if (next.has(p.id)) next.delete(p.id);
      else next.set(p.id, p.nameAr);
      return next;
    });
  }

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
          className="flex flex-wrap gap-2"
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث بالاسم أو SKU…"
            className="surface-2 hairline w-56 rounded-xl border px-3.5 py-2 text-sm outline-none focus:border-teal"
          />
          <button className="rounded-xl border border-[rgb(var(--line))] px-4 py-2 text-sm font-bold">
            بحث
          </button>
          <Link
            href="/products/new"
            className="rounded-xl bg-teal px-4 py-2 text-sm font-bold text-white hover:bg-teal-deep"
          >
            + منتج جديد
          </Link>
          {!bulk && (
            <button
              type="button"
              onClick={() => setBulk(true)}
              className="rounded-xl border border-[rgb(var(--line))] px-4 py-2 text-sm font-bold hover:border-teal"
            >
              تعديل الأسعار جماعيًا
            </button>
          )}
        </form>
      </div>

      {bulk && (
        <BulkPrice
          selected={[...picked].map(([id, nameAr]) => ({ id, nameAr }))}
          onClose={() => {
            setBulk(false);
            setPicked(new Map());
          }}
          onApplied={reload}
        />
      )}

      {quickSaved && (
        <div role="status" className="rounded-xl border border-ok/30 bg-ok/10 px-4 py-3 text-sm font-semibold text-ok">
          تم حفظ «{quickSaved}».
        </div>
      )}

      {saved && (
        <div className="rounded-xl border border-ok/30 bg-ok/10 px-4 py-3 text-sm font-semibold text-ok">
          تم حفظ المنتج بنجاح.
        </div>
      )}

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
                {bulk && (
                  <th className="w-10 px-3 py-3">
                    <span className="sr-only">تحديد</span>
                  </th>
                )}
                {['المنتج', 'النوع', 'التسليم', 'المخزون', 'السعر', 'الحالة'].map((h) => (
                  // phones: type, delivery, stock and status show under the name instead
                  <th
                    key={h}
                    className={
                      'px-3 py-3 text-start text-xs font-semibold sm:px-5 ' + (h === 'المنتج' || h === 'السعر' ? '' : 'hidden md:table-cell')
                    }
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={cols} className="px-5 py-8 text-center text-muted">
                    جارٍ التحميل…
                  </td>
                </tr>
              )}
              {!loading && (rows?.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={cols} className="px-5 py-8 text-center text-muted">
                    لا توجد منتجات مطابقة.
                  </td>
                </tr>
              )}
              {rows?.map((p) => {
                const auto = p.delivery === 'AUTO_PROVIDER';
                // null stockQty means unlimited, not "sold out"
                const out = !auto && p.stockQty !== null && p.stockQty <= 0;
                const lp = local ? localListPrice(p, local, pricing.rates[local.code]) : null;
                return (
                  <tr
                    key={p.id}
                    // tapping a row opens the quick edit (or ticks it while bulk pricing)
                    onClick={() => (bulk ? toggle(p) : setQuick(p))}
                    className={
                      'cursor-pointer border-t hairline transition hover:bg-teal/5 ' + (picked.has(p.id) ? 'bg-teal/5' : '')
                    }
                  >
                    {bulk && (
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={picked.has(p.id)}
                          onChange={() => toggle(p)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label={`تحديد ${p.nameAr}`}
                          className="h-4 w-4 accent-[#0d6d64]"
                        />
                      </td>
                    )}
                    <td className="px-3 py-3 sm:px-5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setQuick(p);
                        }}
                        className="text-start font-semibold text-teal hover:underline"
                      >
                        {p.nameAr}
                      </button>
                      <div className="break-all text-xs text-muted" dir="ltr">
                        {p.sku}
                        {p.game?.nameEn ? ` · ${p.game.nameEn}` : ''}
                      </div>
                      <div className="mt-1 text-xs text-muted md:hidden">
                        {TYPE_LABEL[p.type] ?? p.type} · {DELIVERY_LABEL[p.delivery] ?? p.delivery} · المخزون{' '}
                        <span className="tnum">{auto || p.stockQty === null ? '∞' : num(p.stockQty)}</span>
                      </div>
                      <div className="mt-1.5 md:hidden">
                        <StatusChips p={p} out={out} />
                      </div>
                    </td>
                    <td className="hidden px-5 py-3 text-muted md:table-cell">{TYPE_LABEL[p.type] ?? p.type}</td>
                    <td className="hidden px-5 py-3 text-muted md:table-cell">
                      {DELIVERY_LABEL[p.delivery] ?? p.delivery}
                    </td>
                    <td className="hidden px-5 py-3 tnum md:table-cell">
                      {auto || p.stockQty === null ? '∞' : num(p.stockQty)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 align-top sm:px-5">
                      <div className="tnum font-semibold">{money(p.sellPrice)}</div>
                      {lp && (
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                          <span className="tnum">{moneyIn(lp.amount, local!.code)}</span>
                          {lp.fixed && (
                            <span
                              title="سعر ثابت لا يتغيّر مع سعر الدولار"
                              className="rounded-full bg-gold/15 px-1.5 py-px text-[10px] font-bold text-gold-deep"
                            >
                              ثابت
                            </span>
                          )}
                        </div>
                      )}
                      {!bulk && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setQuick(p);
                          }}
                          className="mt-1.5 rounded-lg border border-[rgb(var(--line))] px-2.5 py-1 text-xs font-bold text-muted hover:border-teal hover:text-[rgb(var(--text))]"
                        >
                          تعديل سريع
                        </button>
                      )}
                    </td>
                    <td className="hidden px-5 py-3 md:table-cell">
                      <StatusChips p={p} out={out} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {quick && (
        <QuickEdit
          key={quick.id}
          product={quick}
          local={local}
          rates={pricing.rates}
          onClose={closeQuick}
          onSaved={onQuickSaved}
        />
      )}

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

function StatusChips({ p, out }: { p: Product; out: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${
          out ? 'bg-bad/12 text-bad' : p.isActive ? 'bg-ok/12 text-ok' : 'bg-ink-400/15 text-muted'
        }`}
      >
        {out ? 'نفد' : p.isActive ? 'نشط' : 'موقوف'}
      </span>
      {(p.discountPercent ?? 0) > 0 && (
        <span className="whitespace-nowrap rounded-full bg-teal/12 px-2.5 py-1 text-xs font-bold text-teal">
          خصم {num(p.discountPercent)}%
        </span>
      )}
      {p.isFeatured && (
        <span className="whitespace-nowrap rounded-full bg-gold/15 px-2.5 py-1 text-xs font-bold text-gold-deep">
          مميّز
        </span>
      )}
    </div>
  );
}
