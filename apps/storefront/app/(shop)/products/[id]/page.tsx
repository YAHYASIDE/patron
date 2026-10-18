'use client';

import { use, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { catalog } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { cart } from '@/lib/cart';
import { useCurrency } from '@/lib/currency';
import type { GameInput, Paginated, Product } from '@/lib/types';
import Price from '@/components/Price';
import { BoltIcon, CheckIcon, ShieldIcon, ChevronIcon } from '@/components/icons';

export default function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();

  const currency = useCurrency();
  const prod = useFetch<Product>(() => catalog.product(id, currency), [id, currency]);
  const product = prod.data;

  const [qty, setQty] = useState(1);
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [added, setAdded] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // other denominations of the same game
  const siblings = useFetch<Paginated<Product>>(
    () => (product?.gameId ? catalog.products({ gameId: product.gameId, limit: 24, currency }) : Promise.resolve({ data: [], meta: { page: 1, limit: 0, total: 0, pages: 0 } })),
    [product?.gameId, currency],
  );

  const schema: GameInput[] = product?.game?.inputSchema ?? [];
  const cap = useMemo(() => {
    const m = product?.maxPerOrder ?? undefined;
    const s = product?.stockQty ?? undefined;
    return Math.max(1, Math.min(m ?? 99, s ?? 99));
  }, [product]);

  function validate(): boolean {
    for (const f of schema) {
      if (f.required && !(inputs[f.key] ?? '').trim()) {
        setErr(`يرجى تعبئة: ${f.labelAr || f.labelEn}`);
        return false;
      }
      if (f.regex && inputs[f.key]) {
        try {
          if (!new RegExp(f.regex).test(inputs[f.key])) {
            setErr(`القيمة غير صحيحة: ${f.labelAr || f.labelEn}`);
            return false;
          }
        } catch {
          /* ignore bad regex from server */
        }
      }
    }
    setErr(null);
    return true;
  }

  function addToCart(): boolean {
    if (!product) return false;
    if (product.inStock === false) {
      setErr('هذا المنتج غير متوفّر حاليًا.');
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
      inputs: schema.map((f) => ({ key: f.key, value: inputs[f.key] ?? '' })).filter((i) => i.value),
    });
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

  if (prod.loading) {
    return (
      <div className="mx-auto max-w-page px-4 py-10">
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="aspect-square animate-pulse rounded-3xl bg-[rgb(var(--surface-2))]" />
          <div className="space-y-4">
            <div className="h-8 w-2/3 animate-pulse rounded bg-[rgb(var(--surface-2))]" />
            <div className="h-5 w-1/3 animate-pulse rounded bg-[rgb(var(--surface-2))]" />
            <div className="h-24 animate-pulse rounded bg-[rgb(var(--surface-2))]" />
          </div>
        </div>
      </div>
    );
  }

  if (prod.error || !product) {
    return (
      <div className="mx-auto max-w-page px-4 py-20 text-center">
        <p className="text-muted">{prod.error ?? 'المنتج غير موجود.'}</p>
        <Link href="/products" className="mt-4 inline-block font-bold text-teal hover:underline">
          العودة للمنتجات
        </Link>
      </div>
    );
  }

  const name = product.nameAr || product.nameEn;
  const dels = product.delivery === 'MANUAL' ? 'يُجهّز يدويًّا بعد الدفع' : 'يُسلّم فورًا بعد الدفع';

  return (
    <div className="mx-auto max-w-page px-4 py-8">
      <nav className="mb-5 flex items-center gap-1.5 text-sm text-muted">
        <Link href="/" className="hover:text-[rgb(var(--text))]">
          الرئيسية
        </Link>
        <ChevronIcon size={14} />
        <Link href="/products" className="hover:text-[rgb(var(--text))]">
          المنتجات
        </Link>
        <ChevronIcon size={14} />
        <span className="line-clamp-1 text-[rgb(var(--text))]">{name}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* image */}
        <div
          className="grid aspect-square place-items-center overflow-hidden rounded-3xl text-6xl font-extrabold text-teal/30"
          style={{ backgroundColor: '#2dd4bf14' }}
        >
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.imageUrl} alt={name} className="h-full w-full object-cover" />
          ) : (
            name.slice(0, 1)
          )}
        </div>

        {/* details */}
        <div>
          {product.game?.nameAr && <p className="text-sm font-semibold text-teal">{product.game.nameAr}</p>}
          <h1 className="mt-1 text-2xl font-extrabold md:text-3xl">{name}</h1>

          <div className="mt-3 flex items-center gap-3">
            <Price product={product} size="lg" />
            {product.inStock === false ? (
              <span className="rounded-full bg-bad/10 px-2.5 py-1 text-xs font-bold text-bad">غير متوفّر</span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-teal/10 px-2.5 py-1 text-xs font-bold text-teal">
                <BoltIcon size={13} /> {dels}
              </span>
            )}
          </div>

          {product.description && (
            <p className="mt-4 max-w-prose text-[15px] leading-relaxed text-muted">{product.description}</p>
          )}

          {/* denominations */}
          {product.gameId && (siblings.data?.data?.length ?? 0) > 1 && (
            <div className="mt-6">
              <div className="mb-2 text-sm font-bold">اختر الفئة</div>
              <div className="flex flex-wrap gap-2">
                {siblings.data!.data.map((s) => (
                  <Link
                    key={s.id}
                    href={`/products/${s.id}`}
                    className={
                      'rounded-xl border px-3 py-2 text-sm font-bold transition ' +
                      (s.id === product.id
                        ? 'border-teal bg-teal/10 text-teal'
                        : 'border-[rgb(var(--line))] hover:border-teal')
                    }
                  >
                    {(s.nameAr || s.nameEn).replace(product.game?.nameAr ?? '', '').trim() || s.nameAr || s.nameEn}
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* game inputs */}
          {schema.length > 0 && (
            <div className="mt-6 space-y-3">
              {schema.map((f) => (
                <div key={f.key} className="flex flex-col gap-1.5">
                  <label className="text-sm font-semibold">
                    {f.labelAr || f.labelEn}
                    {f.required && <span className="text-bad"> *</span>}
                  </label>
                  <input
                    type={f.sensitive ? 'password' : f.type === 'tel' || f.type === 'email' ? f.type : 'text'}
                    inputMode={f.type === 'tel' ? 'tel' : undefined}
                    dir={f.type === 'tel' || f.type === 'email' ? 'ltr' : undefined}
                    value={inputs[f.key] ?? ''}
                    onChange={(e) => setInputs((v) => ({ ...v, [f.key]: e.target.value }))}
                    className="surface-2 hairline rounded-xl border px-3.5 py-2.5 text-[15px] outline-none focus:border-teal"
                    placeholder={f.labelAr || f.labelEn}
                  />
                </div>
              ))}
            </div>
          )}

          {/* quantity */}
          <div className="mt-6 flex items-center gap-4">
            <span className="text-sm font-bold">الكمية</span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="grid h-9 w-9 place-items-center rounded-lg border border-[rgb(var(--line))] text-lg font-bold"
              >
                −
              </button>
              <span className="w-8 text-center text-lg font-bold tnum">{qty}</span>
              <button
                onClick={() => setQty((q) => Math.min(cap, q + 1))}
                className="grid h-9 w-9 place-items-center rounded-lg border border-[rgb(var(--line))] text-lg font-bold"
              >
                +
              </button>
            </div>
          </div>

          {err && (
            <p role="alert" className="mt-4 rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad">
              {err}
            </p>
          )}

          {/* actions */}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={onBuyNow}
              disabled={product.inStock === false}
              className="btn-brand flex-1 rounded-xl px-6 py-3.5 text-[15px] font-bold disabled:opacity-50"
            >
              اشترِ الآن
            </button>
            <button
              onClick={onAdd}
              disabled={product.inStock === false}
              className="flex-1 rounded-xl border border-[rgb(var(--line))] px-6 py-3.5 text-[15px] font-bold transition hover:border-teal hover:text-teal disabled:opacity-50"
            >
              {added ? (
                <span className="inline-flex items-center justify-center gap-1.5 text-teal">
                  <CheckIcon size={16} /> أُضيف للسلّة
                </span>
              ) : (
                'أضف إلى السلّة'
              )}
            </button>
          </div>

          <div className="mt-6 flex items-center gap-2 text-xs text-muted">
            <ShieldIcon size={15} className="text-teal" /> دفع آمن ومشفّر، وكود أصلي مضمون.
          </div>
        </div>
      </div>
    </div>
  );
}
