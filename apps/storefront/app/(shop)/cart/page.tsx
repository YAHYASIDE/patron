'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { catalog } from '@/lib/api';
import { useCart } from '@/lib/hooks';
import { cart, type CartItem } from '@/lib/cart';
import { useCurrency } from '@/lib/currency';
import { money } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { CartIcon, TrashIcon } from '@/components/icons';

type Change = { from: string; to: string; currency: string };

/**
 * Lines keep the price they were added at; the shop's price may have moved
 * since (#10). Look up today's price of each line (in its own currency), bring
 * the cart up to date and say which lines changed, by how much.
 */
async function refreshPrices(items: CartItem[]): Promise<Record<string, Change>> {
  const pairs = [...new Set(items.map((i) => `${i.productId}|${i.currency}`))];
  const fresh = await Promise.all(
    pairs.map(async (pair) => {
      const [id, currency] = pair.split('|');
      const p = await catalog.product(id, currency).catch(() => null);
      return [pair, p && p.currency === currency ? p.sellPrice : null] as const;
    }),
  );
  const now = new Map(fresh);
  const changes: Record<string, Change> = {};
  for (const i of items) {
    const price = now.get(`${i.productId}|${i.currency}`);
    if (price != null && Math.abs(parseFloat(price) - parseFloat(i.unitPrice)) >= 0.005) {
      changes[cart.keyOf(i)] = { from: i.unitPrice, to: String(price), currency: i.currency };
    }
  }
  if (Object.keys(changes).length) {
    cart.reprice((i) => {
      const c = changes[cart.keyOf(i)];
      return c && i.currency === c.currency ? { unitPrice: c.to, currency: c.currency } : null;
    });
  }
  return changes;
}

export default function CartPage() {
  const t = useT();
  const { items, total } = useCart();
  const currency = useCurrency();
  const [changes, setChanges] = useState<Record<string, Change>>({});

  // once per visit to the cart
  useEffect(() => {
    let alive = true;
    const now = cart.items();
    if (now.length) refreshPrices(now).then((c) => alive && setChanges(c)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // a currency switch re-prices every line on purpose: older notices no longer apply
  useEffect(() => {
    setChanges((c) => (Object.values(c).some((x) => x.currency !== currency) ? {} : c));
  }, [currency]);

  const changed = items.filter((i) => changes[cart.keyOf(i)]).length;

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-page px-4 py-20 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-teal/10 text-teal">
          <CartIcon size={28} />
        </div>
        <h1 className="mt-5 text-xl font-extrabold">{t('سلّتك فارغة')}</h1>
        <p className="mt-2 text-muted">{t('أضف بعض المنتجات لتبدأ.')}</p>
        <Link href="/products" className="btn-brand mt-6 inline-block rounded-xl px-6 py-3 font-bold">
          {t('تصفّح المنتجات')}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-page px-4 py-8">
      <h1 className="text-2xl font-extrabold">{t('سلّة التسوّق')}</h1>
      {changed > 0 && (
        <p role="status" className="mt-3 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">
          {changed === 1
            ? t('تغيّر سعر منتج في سلّتك منذ أضفته، وحدّثناه إلى السعر الحالي.')
            : t('تغيّرت أسعار {n} منتجات في سلّتك منذ أضفتها، وحدّثناها إلى الأسعار الحالية.', { n: changed })}
        </p>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* lines */}
        <div className="space-y-3 lg:col-span-2">
          {items.map((it) => {
            const key = cart.keyOf(it);
            const change = changes[key];
            const up = change && parseFloat(change.to) > parseFloat(change.from);
            return (
              <div key={key} className="surface flex gap-3 rounded-2xl p-3">
                <div
                  className="grid h-20 w-20 flex-none place-items-center overflow-hidden rounded-xl text-xl font-extrabold text-teal/40"
                  style={{ backgroundColor: '#2dd4bf14' }}
                >
                  {it.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={it.imageUrl} alt={it.nameAr} className="h-full w-full object-cover" />
                  ) : (
                    it.nameAr.slice(0, 1)
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-[15px] font-bold leading-snug">{it.nameAr}</h3>
                    <button
                      onClick={() => cart.remove(key)}
                      aria-label={t('حذف')}
                      className="grid h-8 w-8 flex-none place-items-center rounded-lg text-muted transition hover:bg-bad/10 hover:text-bad"
                    >
                      <TrashIcon size={17} />
                    </button>
                  </div>
                  {(it.inputs?.length ?? 0) > 0 && (
                    <p className="mt-0.5 break-all text-xs text-muted">
                      {it.inputs!.map((i) => i.value).join(' · ')}
                    </p>
                  )}
                  {change && (
                    <p
                      className={
                        'mt-1.5 rounded-lg px-2 py-1 text-xs font-bold ' + (up ? 'bg-warn/10 text-warn' : 'bg-ok/10 text-ok')
                      }
                    >
                      {up ? t('ارتفع السعر:') : t('انخفض السعر:')}{' '}
                      <span className="tnum">
                        <s className="font-normal opacity-80">{money(change.from, change.currency)}</s>
                        <span aria-hidden className="mx-1 inline-block ltr:rotate-180">←</span>
                        {money(change.to, change.currency)}
                      </span>
                    </p>
                  )}
                  <div className="mt-auto flex items-center justify-between pt-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => cart.setQuantity(key, it.quantity - 1)}
                        className="grid h-8 w-8 place-items-center rounded-lg border border-[rgb(var(--line))] font-bold"
                      >
                        −
                      </button>
                      <span className="w-7 text-center font-bold tnum">{it.quantity}</span>
                      <button
                        onClick={() => cart.setQuantity(key, it.quantity + 1)}
                        className="grid h-8 w-8 place-items-center rounded-lg border border-[rgb(var(--line))] font-bold"
                      >
                        +
                      </button>
                    </div>
                    <span className="tnum font-extrabold text-teal">
                      {money(parseFloat(it.unitPrice) * it.quantity, it.currency)}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
          <button onClick={() => cart.clear()} className="text-sm font-semibold text-muted hover:text-bad">
            {t('إفراغ السلّة')}
          </button>
        </div>

        {/* summary */}
        <div className="lg:col-span-1">
          <div className="surface sticky top-20 rounded-2xl p-5 shadow-card">
            <h2 className="text-base font-bold">{t('ملخّص الطلب')}</h2>
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-muted">{t('الإجمالي')}</span>
              <span className="tnum text-xl font-extrabold text-teal">{money(total.amount, total.currency)}</span>
            </div>
            <p className="mt-2 text-xs text-muted">{t('تُحتسب الرسوم والضرائب (إن وُجدت) عند الدفع.')}</p>
            <Link href="/checkout" className="btn-brand mt-5 block rounded-xl py-3 text-center text-[15px] font-bold">
              {t('متابعة الدفع')}
            </Link>
            <Link
              href="/products"
              className="mt-2 block rounded-xl border border-[rgb(var(--line))] py-3 text-center text-sm font-bold text-muted transition hover:text-[rgb(var(--text))]"
            >
              {t('مواصلة التسوّق')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
