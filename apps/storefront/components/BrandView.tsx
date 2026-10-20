'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cart } from '@/lib/cart';
import { money } from '@/lib/format';
import { denominationLabel, type Brand } from '@/lib/brands';
import { tNow, useLang, useT } from '@/lib/i18n';
import { sectionOf } from '@/lib/sections';
import type { GameInput, Product } from '@/lib/types';
import { pushRecent } from '@/lib/recent';
import { report } from '@/lib/events';
import { etaMinutes, useIsNew } from '@/lib/fresh';
import BrandTile from './BrandTile';
import Guide, { guideOf } from './Guide';
import { BoltIcon, CheckIcon, ChevronIcon, ShieldIcon } from './icons';
import { ClockIcon } from './discovery-icons';
import FavoriteButton from './FavoriteButton';
import ShareButton from './ShareButton';
import { PriceWatchButton, StockWatchList } from './WatchButtons';
import { RatingLine, ReviewList, useReviews } from './BrandReviews';
import { SavedInputChips, savable, useSavedInputs } from './SavedInputs';

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="surface rounded-2xl p-4 shadow-card sm:p-5">
      <h2 className="flex items-center gap-2.5 text-base font-extrabold">
        <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-teal text-sm text-white tnum">
          {n}
        </span>
        {title}
      </h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/**
 * One brand's purchase page, laid out the way top-up shops do it: who is it
 * for (account inputs), which amount (denomination tiles), then pay. On phones
 * the total and the buy button stay pinned at the bottom.
 */
export default function BrandView({
  brand,
  initialId,
  related,
}: {
  brand: Brand;
  initialId?: string;
  related: Brand[];
}) {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  // account input labels come from the game: English for French and English visitors
  const labelOf = (f: GameInput) => (lang === 'ar' ? f.labelAr || f.labelEn : f.labelEn || f.labelAr);
  // where to find the value, in the page's language (Arabic when no translation)
  const helpOf = (f: GameInput) => (lang === 'fr' ? f.helpFr : lang === 'en' ? f.helpEn : f.helpAr) || f.helpAr;
  const section = sectionOf(brand);
  const firstAvailable = brand.products.find((p) => p.inStock !== false) ?? brand.products[0];
  const [selectedId, setSelectedId] = useState(
    brand.products.some((p) => p.id === initialId)
      ? initialId!
      : (brand.products.find((p) => p.isFeatured && p.inStock !== false) ?? firstAvailable).id,
  );
  const product = brand.products.find((p) => p.id === selectedId) ?? firstAvailable;
  const [qty, setQty] = useState(1);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [added, setAdded] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const errRef = useRef<HTMLParagraphElement>(null);
  const isNew = useIsNew(brand);
  const reviews = useReviews(useMemo(() => brand.products.map((p) => p.id), [brand.products]));
  // account details used before for this game, and whether to keep these ones
  const saved = useSavedInputs(product.gameId);
  const [remember, setRemember] = useState(true);

  useEffect(() => pushRecent(brand.key), [brand.key]);
  // for the owner's "most viewed": the title is the Arabic one (French and English visits show another name)
  useEffect(() => {
    report('brand_view', brand.key, lang === 'ar' ? { detail: { title: brand.title } } : undefined);
  }, [brand.key, brand.title, lang]);

  // the buy bar sits at the bottom on phones, so bring a problem into view
  useEffect(() => {
    if (err) errRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [err]);

  const schema: GameInput[] = product.game?.inputSchema ?? [];
  const cap = useMemo(
    () => Math.max(1, Math.min(product.maxPerOrder ?? 99, product.stockQty ?? 99)),
    [product],
  );
  const manual = product.delivery === 'MANUAL';
  // the brand's guide lives on its products; the selected one, else the first that has one
  const guide = guideOf(product.metadata) ?? brand.products.map((p) => guideOf(p.metadata)).find(Boolean) ?? null;
  const total = parseFloat(product.sellPrice) * qty;
  const step = schema.length > 0 ? 1 : 0;
  const eta = etaMinutes(product);
  const canSave = saved.authed && !!product.gameId && schema.some((f) => !f.sensitive);

  function select(p: Product) {
    setSelectedId(p.id);
    setQty(1);
    setErr(null);
  }

  function validate(): boolean {
    for (const f of schema) {
      const v = (inputs[f.key] ?? '').trim();
      if (f.required && !v) {
        setErr(tNow('اكتب {label} أولًا.', { label: labelOf(f) }));
        return false;
      }
      if (f.regex && v) {
        try {
          if (!new RegExp(f.regex).test(v)) {
            setErr(tNow('تحقّق من {label}: الصيغة غير صحيحة.', { label: labelOf(f) }));
            return false;
          }
        } catch {
          /* ignore a bad regex from the server */
        }
      }
    }
    setErr(null);
    return true;
  }

  function addToCart(): boolean {
    if (product.inStock === false) {
      setErr(tNow('هذه الفئة غير متوفّرة حاليًا، اختر فئة أخرى.'));
      return false;
    }
    if (!validate()) return false;
    cart.add({
      productId: product.id,
      sku: product.sku,
      nameAr: product.nameAr || product.nameEn,
      imageUrl: product.imageUrl,
      unitPrice: product.sellPrice,
      currency: product.currency,
      quantity: qty,
      gameId: product.gameId,
      delivery: product.delivery,
      maxPerOrder: product.maxPerOrder,
      inputs: schema.map((f) => ({ key: f.key, value: (inputs[f.key] ?? '').trim() })).filter((i) => i.value),
    });
    if (canSave && remember) saved.save(savable(schema, inputs));
    return true;
  }

  function onAdd() {
    if (addToCart()) {
      setAdded(true);
      setTimeout(() => setAdded(false), 2200);
    }
  }
  function onBuyNow() {
    if (addToCart()) router.push('/checkout');
  }

  return (
    <div className="mx-auto max-w-page px-4 pb-32 pt-6 lg:pb-16">
      <nav className="mb-4 flex items-center gap-1.5 text-sm text-muted">
        <Link href="/products" className="hover:text-[rgb(var(--text))]">
          {t('المتجر')}
        </Link>
        <ChevronIcon size={14} />
        <Link href={`/products?s=${section.id}`} className="hover:text-[rgb(var(--text))]">
          {t(section.label)}
        </Link>
      </nav>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
        {/* brand card */}
        <aside className="surface flex gap-4 rounded-2xl p-4 shadow-card lg:sticky lg:top-20 lg:flex-col lg:p-5">
          <div className="aspect-square w-24 flex-none overflow-hidden rounded-xl bg-[rgb(var(--surface-2))] lg:w-full">
            {brand.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.image} alt={brand.title} className="h-full w-full object-cover" />
            ) : (
              <div className="grid h-full place-items-center text-3xl font-extrabold text-teal/40">
                {brand.title.slice(0, 1)}
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-xl font-extrabold leading-snug lg:text-2xl">
              {brand.title}
              {isNew && (
                <span className="ms-2 inline-block rounded-full bg-teal-soft px-2 py-0.5 align-middle text-[11px] font-extrabold leading-none text-teal-ink">
                  {t('جديد')}
                </span>
              )}
            </h1>
            {reviews && <RatingLine summary={reviews} />}
            <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-bold text-teal">
              <span className="inline-flex items-center gap-1">
                <BoltIcon size={13} /> {manual ? t('يُجهَّز بعد تأكيد الدفع') : t('يُسلَّم فور الدفع')}
              </span>
              {eta && (
                <span className="inline-flex items-center gap-1 text-muted">
                  <ClockIcon size={13} />
                  {eta < 60
                    ? t('عادة خلال {n} دقيقة', { n: eta })
                    : t('عادة خلال {n} ساعة', { n: Math.round(eta / 60) })}
                </span>
              )}
            </p>
            {product.description && (
              <p className="mt-2 hidden text-sm leading-relaxed text-muted sm:block">{product.description}</p>
            )}
            <div className="mt-3 flex items-center gap-2">
              <FavoriteButton brandKey={brand.key} variant="page" />
              <ShareButton title={brand.title} path={`/brands/${brand.key}`} />
            </div>
          </div>
        </aside>

        <div className="flex flex-col gap-4">
          {schema.length > 0 && (
            <Section n={1} title={t('بيانات الحساب')}>
              <SavedInputChips
                list={saved.list}
                schema={schema}
                current={inputs}
                onPick={(values) => {
                  setInputs((v) => ({ ...v, ...values }));
                  setErr(null);
                }}
              />
              <div className="grid gap-3 sm:grid-cols-2">
                {schema.map((f) => (
                  <label key={f.key} className="flex flex-col gap-1.5">
                    <span className="text-sm font-semibold">
                      {labelOf(f)}
                      {f.required && <span className="text-bad"> *</span>}
                    </span>
                    {f.options?.length ? (
                      <select
                        value={inputs[f.key] ?? ''}
                        onChange={(e) => {
                          setInputs((v) => ({ ...v, [f.key]: e.target.value }));
                          setErr(null);
                        }}
                        className="surface-2 hairline rounded-xl border px-3.5 py-3 text-[15px] outline-none transition focus:border-teal"
                      >
                        <option value="">{t('اختر…')}</option>
                        {f.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {lang === 'ar' ? o.labelAr : o.labelEn}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={
                          f.sensitive ? 'password' : f.type === 'tel' || f.type === 'email' ? f.type : 'text'
                        }
                        inputMode={f.type === 'tel' ? 'tel' : undefined}
                        dir={f.type === 'tel' || f.type === 'email' || f.type === 'address' ? 'ltr' : undefined}
                        value={inputs[f.key] ?? ''}
                        onChange={(e) => {
                          setInputs((v) => ({ ...v, [f.key]: e.target.value }));
                          setErr(null);
                        }}
                        className="surface-2 hairline rounded-xl border px-3.5 py-3 text-[15px] outline-none transition focus:border-teal"
                      />
                    )}
                    {helpOf(f) && <span className="text-xs leading-relaxed text-muted">{helpOf(f)}</span>}
                  </label>
                ))}
              </div>
              {canSave && (
                <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={remember}
                    onChange={(e) => setRemember(e.target.checked)}
                    className="h-4 w-4 flex-none accent-[#0d6d64]"
                  />
                  {t('احفظ هذه البيانات لطلباتي القادمة')}
                </label>
              )}
              <p className="mt-2.5 inline-flex items-center gap-1.5 text-xs text-muted">
                <ShieldIcon size={14} className="text-teal" /> {t('لا نطلب كلمة المرور أبدًا.')}
              </p>
            </Section>
          )}

          {guide && (guide.before?.length || guide.warning) && (
            <Guide title="قبل الدفع" steps={guide.before} warning={guide.warning} />
          )}

          <Section n={step + 1} title={t('اختر الفئة')}>
            <div role="radiogroup" className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
              {brand.products.map((p) => {
                const on = p.id === product.id;
                const out = p.inStock === false;
                const off =
                  (p.discountPercent ?? 0) > 0 &&
                  p.listPrice &&
                  parseFloat(p.listPrice) > parseFloat(p.sellPrice);
                return (
                  <button
                    key={p.id}
                    role="radio"
                    aria-checked={on}
                    disabled={out}
                    onClick={() => select(p)}
                    className={
                      'relative flex min-h-[84px] flex-col items-start justify-between gap-2 rounded-xl border-2 p-3 text-start transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45 ' +
                      (on ? 'border-teal bg-teal/[0.06]' : 'border-[rgb(var(--line))] hover:border-teal/50')
                    }
                  >
                    <span className="text-[15px] font-extrabold leading-snug">
                      {denominationLabel(p, brand)}
                    </span>
                    <span className="flex flex-wrap items-baseline gap-x-1.5">
                      <span className="tnum text-sm font-bold text-teal">
                        {money(p.sellPrice, p.currency)}
                      </span>
                      {off && (
                        <span className="tnum text-[11px] text-muted line-through">
                          {money(p.listPrice, p.currency)}
                        </span>
                      )}
                    </span>
                    {out && <span className="text-[11px] font-bold text-bad">{t('غير متوفّر')}</span>}
                    {on && (
                      <span className="absolute end-2 top-2 grid h-5 w-5 place-items-center rounded-full bg-teal text-white">
                        <CheckIcon size={12} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            <StockWatchList products={brand.products} labelOf={(p) => denominationLabel(p, brand)} />
          </Section>

          <Section n={step + 2} title={t('أكمل الشراء')}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-muted">{t('الكمية')}</span>
                <div className="surface-2 flex items-center rounded-xl">
                  <button
                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                    className="h-10 w-10 text-lg font-bold disabled:opacity-40"
                    disabled={qty <= 1}
                    aria-label={t('إنقاص')}
                  >
                    −
                  </button>
                  <span className="w-8 text-center font-bold tnum">{qty}</span>
                  <button
                    onClick={() => setQty((q) => Math.min(cap, q + 1))}
                    className="h-10 w-10 text-lg font-bold disabled:opacity-40"
                    disabled={qty >= cap}
                    aria-label={t('زيادة')}
                  >
                    +
                  </button>
                </div>
              </div>
              <div className="text-end">
                <div className="text-xs text-muted">{t('الإجمالي')}</div>
                <div className="tnum text-2xl font-extrabold text-teal">{money(total, product.currency)}</div>
              </div>
            </div>

            {err && (
              <p
                ref={errRef}
                role="alert"
                className="mt-4 rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad"
              >
                {err}
              </p>
            )}

            <div className="mt-4 hidden gap-2.5 lg:flex">
              <button onClick={onBuyNow} className="btn-brand flex-1 rounded-xl py-3.5 text-[15px] font-bold">
                {t('اشترِ الآن')}
              </button>
              <button
                onClick={onAdd}
                className="rounded-xl border border-[rgb(var(--line))] px-6 text-[15px] font-bold transition hover:border-teal hover:text-teal"
              >
                {added ? t('أُضيف إلى السلّة') : t('أضف إلى السلّة')}
              </button>
            </div>

            {product.inStock !== false && (
              <div className="mt-4 border-t border-[rgb(var(--line))] pt-3">
                <PriceWatchButton key={product.id} product={product} />
              </div>
            )}
          </Section>

          {product.description && (
            <p className="px-4 text-sm leading-relaxed text-muted sm:hidden">{product.description}</p>
          )}
        </div>
      </div>

      {reviews && <ReviewList summary={reviews} />}

      {related.length > 0 && (
        <section className="mt-12">
          <h2 className="text-lg font-extrabold">{t('من نفس القسم')}</h2>
          <div className="mt-4 grid grid-cols-4 gap-x-2.5 gap-y-4 sm:grid-cols-6 md:grid-cols-8">
            {related.map((b) => (
              <BrandTile key={b.key} brand={b} size="sm" />
            ))}
          </div>
        </section>
      )}

      {/* phones: the total and the buy button stay in reach */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[rgb(var(--line))] bg-[rgb(var(--surface))]/95 px-4 py-3 backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-page items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="line-clamp-1 text-xs text-muted">{denominationLabel(product, brand)}</div>
            <div className="tnum text-lg font-extrabold text-teal">{money(total, product.currency)}</div>
          </div>
          <button
            onClick={onAdd}
            aria-label={t('أضف إلى السلّة')}
            className="rounded-xl border border-[rgb(var(--line))] px-3.5 py-3 text-sm font-bold"
          >
            {added ? t('أُضيف') : t('للسلّة')}
          </button>
          <button onClick={onBuyNow} className="btn-brand rounded-xl px-6 py-3 text-[15px] font-bold">
            {t('اشترِ الآن')}
          </button>
        </div>
      </div>
    </div>
  );
}
