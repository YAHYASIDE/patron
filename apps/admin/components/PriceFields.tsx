'use client';

import { useId, useMemo } from 'react';
import {
  ApiError,
  NOT_READY,
  CURRENCIES_PATH,
  RATES_PATH,
  autoLocalPrice,
  cleanAmount,
  fixedAfterDiscount,
  localCurrencies,
  priceInLabel,
  type FixedPrice,
  type FxRates,
  type ShopCurrency,
} from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { moneyIn, num } from '@/lib/format';

/** The local currencies (Mauritania first) and the latest rate for each. */
export function usePriceSetup() {
  const cur = useFetch<ShopCurrency[]>(CURRENCIES_PATH);
  const fx = useFetch<FxRates>(RATES_PATH);
  const local = useMemo(() => localCurrencies(cur.data), [cur.data]);
  return {
    local,
    rates: fx.data?.rates ?? {},
    loading: cur.loading || fx.loading,
    error: cur.error ?? fx.error,
  };
}

/** The list price one currency shows (before any discount): the fixed one, else the converted dollar price. */
export function localListPrice(
  p: { sellPrice: number | string; prices?: FixedPrice[] },
  c: ShopCurrency,
  rate: number | undefined,
): { amount: number; fixed: boolean } | null {
  const own = p.prices?.find((x) => x.currencyCode === c.code && x.isActive !== false);
  if (own) return { amount: Number(own.sellPrice), fixed: true };
  const auto = autoLocalPrice(Number(p.sellPrice), rate, c);
  return auto === null ? null : { amount: auto, fixed: false };
}

/** Translate the API's English validation messages about a product into Arabic. */
export function productError(err: unknown): string {
  if (!(err instanceof ApiError)) return 'تعذّر الاتصال بالخادم.';
  if (err.message === NOT_READY) return 'هذه الميزة غير متاحة على الخادم بعد.';
  if (err.status === 0) return err.message;
  if (err.status === 403) return 'ليست لديك صلاحية تعديل المنتجات أو الأسعار.';
  if (err.status === 409) return 'رمز SKU مستخدم لمنتج آخر. غيّره ثم أعد المحاولة.';
  const m = err.message;
  if (/discountPercent/i.test(m)) return 'الخصم كبير: السعر بعده أقل من التكلفة، أي بيع بخسارة.';
  if (/below costPrice/i.test(m)) return 'سعر البيع أقل من التكلفة، أي أنّ المنتج سيُباع بخسارة.';
  if (/GAME_TOPUP/i.test(m)) return 'منتج «شحن ألعاب» يجب ربطه بلعبة.';
  if (/Invalid categoryId/i.test(m)) return 'اختر فئة صحيحة.';
  if (/Invalid gameId/i.test(m)) return 'اللعبة المختارة غير صحيحة.';
  if (/same currency/i.test(m)) return 'سعر عملة مكرّر. اترك سعرًا واحدًا لكل عملة.';
  if (/Currency .* not supported/i.test(m)) return 'إحدى العملات غير مفعّلة في المتجر.';
  if (/prices/i.test(m)) return 'السعر المحلي غير صحيح: اكتب رقمًا أكبر من صفر، أو اتركه فارغًا.';
  if (/stockQty/i.test(m)) return 'الكمية يجب أن تكون رقمًا صحيحًا، 0 أو أكثر.';
  if (/sellPrice|costPrice/i.test(m)) return 'السعر والتكلفة أرقام موجبة، بأربعة أرقام بعد الفاصلة على الأكثر.';
  if (err.status === 404) return 'المنتج غير موجود، ربما حُذف.';
  // anything else the server said in English is no use to the owner
  return /[؀-ۿ]/.test(m) ? m : `تعذّر الحفظ (خطأ ${err.status}). حاول مرة أخرى.`;
}

/** Profit shown in whole units when the currency is priced in whole units (ouguiya, franc, dinar). */
function shownProfit(v: number, c: ShopCurrency) {
  return Number(c.roundingStep ?? 0) >= 1 || c.decimals === 0 ? Math.round(v) : Math.round(v * 100) / 100;
}

/**
 * One local price: empty = automatic (the dollar price × the rate, shown as the
 * placeholder), filled = a fixed price that does not move with the dollar.
 * Under it, what the customer pays and the profit, red when below cost.
 */
export function LocalPriceField({
  currency: c,
  rate,
  usd,
  costUsd,
  discount,
  value,
  onChange,
  className,
}: {
  currency: ShopCurrency;
  rate: number | undefined;
  usd: number;
  costUsd: number;
  discount: number;
  value: string;
  onChange: (v: string) => void;
  className: string;
}) {
  const id = useId();
  const fixed = value.trim() !== '';
  const fixedN = parseFloat(value);
  const autoList = autoLocalPrice(usd, rate, c);
  const pays = fixed
    ? isFinite(fixedN) && fixedN > 0
      ? fixedAfterDiscount(fixedN, c, discount)
      : null
    : autoLocalPrice(usd, rate, c, discount);
  const profit = pays !== null && rate && isFinite(costUsd) ? pays - costUsd * rate : null;
  const loss = profit !== null && profit < 0;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-semibold">
          {priceInLabel(c)}
        </label>
        <span
          className={
            'whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ' +
            (fixed ? 'bg-gold/15 text-gold-deep' : 'bg-teal/12 text-teal')
          }
        >
          {fixed ? 'ثابت' : 'تلقائي'}
        </span>
      </div>
      <div className="flex gap-2">
        <input
          id={id}
          inputMode="decimal"
          dir="ltr"
          value={value}
          onChange={(e) => onChange(cleanAmount(e.target.value))}
          className={className + ' min-w-0 text-right tnum'}
          placeholder={autoList !== null ? String(autoList) : 'تلقائي'}
        />
        {fixed && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="flex-none whitespace-nowrap rounded-xl border border-[rgb(var(--line))] px-3 text-xs font-bold text-muted hover:border-teal hover:text-[rgb(var(--text))]"
          >
            اجعله تلقائيًا
          </button>
        )}
      </div>
      {!rate ? (
        <p className="text-xs text-muted">لا يوجد سعر صرف لهذه العملة بعد.</p>
      ) : (
        <div className="flex flex-col gap-0.5 text-xs">
          {pays !== null && (
            <p className="text-muted">
              يدفع الزبون{' '}
              <span className="tnum font-bold text-[rgb(var(--text))]">{moneyIn(pays, c.code)}</span>
              {discount > 0 && ' بعد الخصم'}
            </p>
          )}
          {profit !== null && (
            <p className={'font-semibold ' + (loss ? 'text-bad' : 'text-ok')}>
              {loss ? 'خسارة' : 'ربحك'} <span className="tnum">{moneyIn(Math.abs(shownProfit(profit, c)), c.code)}</span>
              {pays ? (
                <>
                  {' '}
                  <span dir="ltr" className="tnum">({num((profit / pays) * 100, 1)}%)</span>
                </>
              ) : null}
              {loss && ' — أقل من التكلفة'}
            </p>
          )}
          <p className="text-muted">
            {fixed ? (
              'سعر ثابت: لا يتغيّر إذا غيّرت سعر الدولار.'
            ) : (
              <>
                يُحسب من سعر الدولار × <span className="tnum">{rate}</span>
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
