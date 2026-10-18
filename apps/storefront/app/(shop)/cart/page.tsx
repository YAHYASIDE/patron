'use client';

import Link from 'next/link';
import { useCart } from '@/lib/hooks';
import { cart } from '@/lib/cart';
import { money } from '@/lib/format';
import { CartIcon, TrashIcon } from '@/components/icons';

export default function CartPage() {
  const { items, total } = useCart();

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-page px-4 py-20 text-center">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-teal/10 text-teal">
          <CartIcon size={28} />
        </div>
        <h1 className="mt-5 text-xl font-extrabold">سلّتك فارغة</h1>
        <p className="mt-2 text-muted">أضف بعض المنتجات لتبدأ.</p>
        <Link href="/products" className="btn-brand mt-6 inline-block rounded-xl px-6 py-3 font-bold">
          تصفّح المنتجات
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-page px-4 py-8">
      <h1 className="text-2xl font-extrabold">سلّة التسوّق</h1>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        {/* lines */}
        <div className="space-y-3 lg:col-span-2">
          {items.map((it) => {
            const key = cart.keyOf(it);
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
                <div className="flex flex-1 flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="text-[15px] font-bold leading-snug">{it.nameAr}</h3>
                    <button
                      onClick={() => cart.remove(key)}
                      aria-label="حذف"
                      className="grid h-8 w-8 flex-none place-items-center rounded-lg text-muted transition hover:bg-bad/10 hover:text-bad"
                    >
                      <TrashIcon size={17} />
                    </button>
                  </div>
                  {(it.inputs?.length ?? 0) > 0 && (
                    <p className="mt-0.5 text-xs text-muted">
                      {it.inputs!.map((i) => i.value).join(' · ')}
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
            إفراغ السلّة
          </button>
        </div>

        {/* summary */}
        <div className="lg:col-span-1">
          <div className="surface sticky top-20 rounded-2xl p-5 shadow-card">
            <h2 className="text-base font-bold">ملخّص الطلب</h2>
            <div className="mt-4 flex items-center justify-between text-sm">
              <span className="text-muted">الإجمالي</span>
              <span className="tnum text-xl font-extrabold text-teal">{money(total.amount, total.currency)}</span>
            </div>
            <p className="mt-2 text-xs text-muted">تُحتسب الرسوم والضرائب (إن وُجدت) عند الدفع.</p>
            <Link href="/checkout" className="btn-brand mt-5 block rounded-xl py-3 text-center text-[15px] font-bold">
              متابعة الدفع
            </Link>
            <Link
              href="/products"
              className="mt-2 block rounded-xl border border-[rgb(var(--line))] py-3 text-center text-sm font-bold text-muted transition hover:text-[rgb(var(--text))]"
            >
              مواصلة التسوّق
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
