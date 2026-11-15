'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  amountText,
  cleanAmount,
  fixedChanged,
  fixedTexts,
  pricesBody,
  priceInLabel,
  productPatchBody,
  updateProduct,
  type AdminProduct,
  type ShopCurrency,
} from '@/lib/api';
import { num } from '@/lib/format';
import { LocalPriceField, productError } from '@/components/PriceFields';
import Notice from '@/components/Notice';

const field =
  'surface-2 hairline w-full min-w-0 rounded-xl border px-3.5 py-2.5 text-[15px] outline-none focus:border-teal';

/**
 * The fields the owner changes most, in a bottom sheet (phone) or a side panel
 * (desktop): $ price, the local price (fixed or automatic), cost, discount,
 * stock and visibility. Saves with one PATCH and hands the saved row back.
 */
export default function QuickEdit<T extends AdminProduct & { _count?: { codes?: number } }>({
  product: p,
  local,
  rates,
  onClose,
  onSaved,
}: {
  product: T;
  /** the local currency to edit here (MRU first); others keep their prices */
  local: ShopCurrency | undefined;
  rates: Record<string, number>;
  onClose: () => void;
  onSaved: (row: T) => void;
}) {
  const [sell, setSell] = useState(amountText(p.sellPrice));
  const [cost, setCost] = useState(amountText(p.costPrice));
  const [disc, setDisc] = useState(p.discountPercent ? String(p.discountPercent) : '');
  const [stock, setStock] = useState(p.stockQty === null ? '' : String(p.stockQty));
  const [active, setActive] = useState(p.isActive);
  const [savedFixed] = useState(() => fixedTexts(p.prices));
  const [fixed, setFixed] = useState(savedFixed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escape closes; the page behind does not scroll while the sheet is open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);

  const s = parseFloat(sell);
  const c = parseFloat(cost);
  const d = disc === '' ? 0 : Number(disc);
  const pays = isFinite(s) ? s * (1 - d / 100) : NaN;
  const profit = pays - c;
  const manual = p.delivery === 'MANUAL';

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!isFinite(s) || !isFinite(c)) return setError('اكتب سعر البيع والتكلفة بالأرقام.');
    if (s < c) return setError('سعر البيع أقل من التكلفة، أي أنّ المنتج سيُباع بخسارة.');
    if (!/^\d*$/.test(disc) || d > 90) return setError('الخصم رقم صحيح من 0 إلى 90.');
    if (pays < c) return setError('الخصم كبير: السعر بعده أقل من التكلفة، أي بيع بخسارة.');
    if (!/^\d*$/.test(stock)) return setError('الكمية رقم صحيح بدون فواصل، أو اتركها فارغة = غير محدودة.');
    const changes: Record<string, unknown> = {
      sellPrice: s,
      costPrice: c,
      discountPercent: d > 0 ? d : null,
      isActive: active,
      ...(manual && { stockQty: stock === '' ? null : Number(stock) }),
    };
    if (local) {
      const t = (fixed[local.code] ?? '').trim();
      const n = Number(t);
      if (t !== '' && (!isFinite(n) || n <= 0))
        return setError(`${priceInLabel(local)}: اكتب رقمًا أكبر من صفر، أو اتركه فارغًا ليُحسب تلقائيًا.`);
      const rate = rates[local.code];
      if (t !== '' && rate && n * (1 - d / 100) < c * rate && !confirm(`${priceInLabel(local)} أقل من التكلفة، أي بيع بخسارة. هل تحفظ رغم ذلك؟`))
        return;
      // the server replaces every fixed price with this list: send it only when changed
      if (fixedChanged(fixed, savedFixed)) changes.prices = pricesBody(fixed, [local.code], p.prices);
    }

    setBusy(true);
    try {
      const saved = await updateProduct(p.id, productPatchBody(p, changes));
      onSaved({ ...p, ...saved, prices: saved.prices ?? p.prices });
    } catch (err) {
      setError(productError(err));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-labelledby="quick-edit-title">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <form
        onSubmit={save}
        className="surface absolute inset-x-0 bottom-0 flex max-h-[92dvh] flex-col rounded-t-3xl border-0 shadow-card md:inset-y-0 md:end-0 md:start-auto md:max-h-none md:w-[420px] md:rounded-none md:border-s md:border-[rgb(var(--line))]"
      >
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4">
          <div className="min-w-0">
            {/* the grab handle says "this slides"; on desktop it is a plain panel */}
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-[rgb(var(--line))] md:hidden" />
            <h2 id="quick-edit-title" className="text-base font-bold">
              {p.nameAr}
            </h2>
            <div className="break-all text-xs text-muted" dir="ltr">
              {p.sku}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="mt-4 flex-none text-sm font-bold text-muted hover:text-[rgb(var(--text))] md:mt-0"
          >
            إغلاق
          </button>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto px-5 pb-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-sm font-semibold">السعر ($)</span>
              <input inputMode="decimal" dir="ltr" value={sell} onChange={(e) => setSell(cleanAmount(e.target.value))} className={field + ' text-right tnum'} />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-sm font-semibold">التكلفة ($)</span>
              <input inputMode="decimal" dir="ltr" value={cost} onChange={(e) => setCost(cleanAmount(e.target.value))} className={field + ' text-right tnum'} />
            </label>
          </div>
          {isFinite(pays) && isFinite(c) && (
            <p className={'-mt-2 text-xs font-semibold ' + (profit < 0 ? 'text-bad' : 'text-ok')}>
              {profit < 0 ? 'خسارة' : 'ربحك'} <span className="tnum">{num(Math.abs(profit), 2)} $</span>
              {pays > 0 && (
                <>
                  {' '}
                  {/* dir=ltr keeps "(2.8%)" from flipping inside the Arabic line */}
                  <span dir="ltr" className="tnum">({num((profit / pays) * 100, 1)}%)</span>
                </>
              )}
              {d > 0 && <span className="text-muted"> · يدفع <span className="tnum">{num(pays, 2)} $</span> بعد الخصم</span>}
            </p>
          )}

          {local && (
            <div className="surface-2 rounded-xl p-3.5">
              <LocalPriceField
                currency={local}
                rate={rates[local.code]}
                usd={s}
                costUsd={c}
                discount={isFinite(d) ? d : 0}
                value={fixed[local.code] ?? ''}
                onChange={(v) => setFixed((m) => ({ ...m, [local.code]: v }))}
                className={field.replace('surface-2', 'surface')}
              />
              <p className="mt-1.5 text-xs text-muted">اتركه فارغًا ليُحسب تلقائيًا من سعر الدولار.</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-sm font-semibold">الخصم %</span>
              <input
                inputMode="numeric"
                dir="ltr"
                value={disc}
                onChange={(e) => setDisc(cleanAmount(e.target.value).replace(/\./g, '').slice(0, 2))}
                className={field + ' text-right tnum'}
                placeholder="بلا خصم"
              />
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-sm font-semibold">المخزون</span>
              {manual ? (
                <input
                  inputMode="numeric"
                  dir="ltr"
                  value={stock}
                  onChange={(e) => setStock(cleanAmount(e.target.value).replace(/\./g, ''))}
                  className={field + ' text-right tnum'}
                  placeholder="غير محدود"
                />
              ) : (
                <span className="surface-2 rounded-xl px-3.5 py-2.5 text-xs text-muted">
                  {p.delivery === 'CODE_POOL'
                    ? `${num(p._count?.codes ?? 0)} كود متاح`
                    : 'من المورّد عند الطلب'}
                </span>
              )}
            </label>
          </div>
          {manual && <p className="-mt-2 text-xs text-muted">اترك المخزون فارغًا = غير محدود.</p>}

          <label className="surface-2 flex items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-sm font-semibold">
            <span>
              ظاهر في المتجر
              <span className="block text-xs font-normal text-muted">
                {active ? 'يراه الزبائن ويمكنهم شراؤه.' : 'مخفي: لا يراه الزبائن.'}
              </span>
            </span>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="h-5 w-5 flex-none accent-teal" />
          </label>

          {error && <Notice text={error} />}
        </div>

        <div className="hairline flex items-center gap-3 border-t px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          <button
            type="submit"
            disabled={busy}
            className="flex-1 rounded-xl bg-teal py-3 text-[15px] font-bold text-white transition hover:bg-teal-deep disabled:opacity-60"
          >
            {busy ? 'جارٍ الحفظ…' : 'حفظ'}
          </button>
          <Link
            href={`/products/${p.id}`}
            className="flex-none rounded-xl border border-[rgb(var(--line))] px-4 py-3 text-sm font-bold hover:border-teal"
          >
            كل التفاصيل
          </Link>
        </div>
      </form>
    </div>
  );
}
