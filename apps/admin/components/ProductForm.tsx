'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';

type Category = { id: string; nameAr: string; nameEn: string };
type Game = { id: string; nameAr: string; nameEn: string; categoryId?: string };
type Paginated<T> = { data: T[] };

/** The editable shape of a product, as the admin list returns it. */
export type ProductInput = {
  id?: string;
  sku: string;
  type: string;
  delivery: string;
  nameAr: string;
  nameEn: string;
  categoryId: string;
  gameId?: string | null;
  costPrice: number | string;
  sellPrice: number | string;
  discountPercent?: number | string | null;
  description?: string | null;
  imageUrl?: string | null;
  stockQty?: number | null;
  maxPerOrder?: number | null;
  isActive: boolean;
  isFeatured: boolean;
};

const TYPES = [
  { v: 'GIFT_CARD', l: 'بطاقة هدايا' },
  { v: 'GAME_TOPUP', l: 'شحن ألعاب' },
  { v: 'SUBSCRIPTION', l: 'اشتراك' },
  { v: 'LICENSE', l: 'ترخيص برنامج' },
];

const DELIVERIES = [
  { v: 'MANUAL', l: 'يدوي', hint: 'الزبون يشتري، وأنت تسلّمه الكود بنفسك من صفحة الطلبات. يعمل الآن.' },
  {
    v: 'CODE_POOL',
    l: 'مخزون أكواد',
    hint: 'يُسحب الكود تلقائيًّا من مخزون مرفوع مسبقًا. رفع الأكواد غير متاح بعد، فسيظهر المنتج «غير متوفّر».',
  },
  {
    v: 'AUTO_PROVIDER',
    l: 'تلقائي عبر مورّد',
    hint: 'يُشترى من مورّد خارجي لحظة الطلب. يحتاج ربط مورّد حقيقي، وإلا سيظهر «غير متوفّر».',
  },
];

const EMPTY: ProductInput = {
  sku: '',
  type: 'GIFT_CARD',
  delivery: 'MANUAL',
  nameAr: '',
  nameEn: '',
  categoryId: '',
  gameId: '',
  costPrice: '',
  sellPrice: '',
  discountPercent: null,
  description: '',
  imageUrl: '',
  stockQty: null,
  maxPerOrder: null,
  isActive: true,
  isFeatured: false,
};

/** Upper-case, dash-separated SKU from the English name (3–40 chars). */
function skuFrom(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Translate the API's English validation messages into Arabic. */
function friendly(err: unknown): string {
  if (!(err instanceof ApiError)) return 'تعذّر الاتصال بالخادم.';
  if (err.status === 409) return 'رمز SKU مستخدم لمنتج آخر. غيّره ثم أعد المحاولة.';
  const m = err.message;
  if (/discountPercent/i.test(m)) return 'الخصم كبير: السعر بعده أقل من التكلفة، أي بيع بخسارة.';
  if (/below costPrice/i.test(m)) return 'سعر البيع أقل من التكلفة، أي أنّ المنتج سيُباع بخسارة.';
  if (/GAME_TOPUP/i.test(m)) return 'منتج «شحن ألعاب» يجب ربطه بلعبة.';
  if (/Invalid categoryId/i.test(m)) return 'اختر فئة صحيحة.';
  if (/Invalid gameId/i.test(m)) return 'اللعبة المختارة غير صحيحة.';
  if (err.status === 403) return 'ليست لديك صلاحية تعديل المنتجات أو الأسعار.';
  return m;
}

const input =
  'surface-2 hairline w-full rounded-xl border px-3.5 py-2.5 text-[15px] outline-none focus:border-teal';

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-semibold">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export default function ProductForm({
  initial,
  onSaved,
}: {
  initial?: ProductInput;
  onSaved: (id: string) => void;
}) {
  const editing = !!initial?.id;
  const [f, setF] = useState<ProductInput>(initial ?? EMPTY);
  const [skuTouched, setSkuTouched] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cats = useFetch<Category[]>('/admin/catalog/categories');
  const games = useFetch<Paginated<Game>>(
    f.categoryId ? `/admin/catalog/games?limit=100&categoryId=${f.categoryId}` : null,
  );

  // default to the first category once loaded
  useEffect(() => {
    if (!f.categoryId && cats.data?.length) setF((v) => ({ ...v, categoryId: cats.data![0].id }));
  }, [cats.data, f.categoryId]);

  function set<K extends keyof ProductInput>(k: K, v: ProductInput[K]) {
    setF((prev) => {
      const next = { ...prev, [k]: v };
      if (k === 'nameEn' && !skuTouched) next.sku = skuFrom(String(v));
      if (k === 'categoryId') next.gameId = '';
      return next;
    });
  }

  const discount = String(f.discountPercent ?? '') === '' ? 0 : Number(f.discountPercent);

  // What the customer actually pays, and what is left after cost.
  const margin = useMemo(() => {
    const s = parseFloat(String(f.sellPrice));
    const c = parseFloat(String(f.costPrice));
    if (!isFinite(s) || !isFinite(c)) return null;
    const pays = isFinite(discount) ? s * (1 - discount / 100) : s;
    return { pays, profit: pays - c, pct: pays > 0 ? ((pays - c) / pays) * 100 : 0 };
  }, [f.sellPrice, f.costPrice, discount]);

  const delivery = DELIVERIES.find((d) => d.v === f.delivery);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const sell = parseFloat(String(f.sellPrice));
    const cost = parseFloat(String(f.costPrice));
    if (!isFinite(sell) || !isFinite(cost)) return setError('أدخل سعر البيع والتكلفة بالأرقام.');
    if (sell < cost) return setError('سعر البيع أقل من التكلفة، أي أنّ المنتج سيُباع بخسارة.');
    if (!/^\d*$/.test(String(f.discountPercent ?? '')) || discount > 90)
      return setError('الخصم رقم صحيح من 0 إلى 90.');
    if (sell * (1 - discount / 100) < cost) return setError('الخصم كبير: السعر بعده أقل من التكلفة، أي بيع بخسارة.');
    if (f.sku.trim().length < 3) return setError('رمز SKU يجب أن يكون 3 أحرف على الأقل.');
    if (f.type === 'GAME_TOPUP' && !f.gameId) return setError('منتج «شحن ألعاب» يجب ربطه بلعبة.');
    const wholeOrBlank = (v: unknown) => v === null || v === undefined || String(v) === '' || /^\d+$/.test(String(v));
    if (!wholeOrBlank(f.stockQty) || !wholeOrBlank(f.maxPerOrder))
      return setError('الكمية يجب أن تكون رقمًا صحيحًا (بدون فواصل).');
    if (String(f.maxPerOrder ?? '') === '0') return setError('أقصى كمية للطلب يجب أن تكون 1 على الأقل.');

    // Only DTO fields: the API rejects unknown properties.
    const body: Record<string, unknown> = {
      sku: f.sku.trim(),
      type: f.type,
      delivery: f.delivery,
      nameAr: f.nameAr.trim(),
      nameEn: f.nameEn.trim(),
      categoryId: f.categoryId,
      gameId: f.gameId || null,
      costPrice: cost,
      sellPrice: sell,
      // blank or 0 clears it (null), so the store shows no discount
      discountPercent: discount > 0 ? discount : null,
      description: f.description?.trim() || null,
      imageUrl: f.imageUrl?.trim() || null,
      stockQty: f.stockQty === null || f.stockQty === undefined || String(f.stockQty) === '' ? null : Number(f.stockQty),
      isActive: f.isActive,
      isFeatured: f.isFeatured,
    };
    // maxPerOrder is non-nullable in the DB (default 10): omit it when blank.
    if (f.maxPerOrder !== null && f.maxPerOrder !== undefined && String(f.maxPerOrder) !== '') {
      body.maxPerOrder = Number(f.maxPerOrder);
    }

    setBusy(true);
    try {
      const saved = editing
        ? await api.patch<{ id: string }>(`/admin/catalog/products/${initial!.id}`, body)
        : await api.post<{ id: string }>('/admin/catalog/products', body);
      onSaved(saved.id);
    } catch (err) {
      setError(friendly(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-5 lg:grid-cols-3">
      <div className="flex flex-col gap-5 lg:col-span-2">
        <section className="surface flex flex-col gap-4 rounded-2xl p-5 shadow-card">
          <h2 className="text-base font-bold">المعلومات الأساسية</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="الاسم بالعربية *">
              <input required minLength={2} maxLength={120} value={f.nameAr} onChange={(e) => set('nameAr', e.target.value)} className={input} placeholder="بطاقة آيتونز 25$" />
            </Field>
            <Field label="الاسم بالإنجليزية *">
              <input required minLength={2} maxLength={120} dir="ltr" value={f.nameEn} onChange={(e) => set('nameEn', e.target.value)} className={input + ' text-right'} placeholder="iTunes Gift Card $25" />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="نوع المنتج *">
              <select value={f.type} onChange={(e) => set('type', e.target.value)} className={input}>
                {TYPES.map((t) => (
                  <option key={t.v} value={t.v}>
                    {t.l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="الفئة *">
              <select required value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)} className={input}>
                {cats.loading && <option>جارٍ التحميل…</option>}
                {cats.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nameAr}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field
            label={f.type === 'GAME_TOPUP' ? 'اللعبة *' : 'اللعبة (اختياري)'}
            hint="اربط المنتج بلعبة ليطلب المتجر من الزبون بياناتها (مثل رقم اللاعب)."
          >
            <select value={f.gameId ?? ''} onChange={(e) => set('gameId', e.target.value)} className={input}>
              <option value="">— بدون لعبة —</option>
              {games.data?.data.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.nameAr}
                </option>
              ))}
            </select>
          </Field>
          <Field label="الوصف (اختياري)">
            <textarea rows={3} value={f.description ?? ''} onChange={(e) => set('description', e.target.value)} className={input} placeholder="تفاصيل تظهر للزبون في صفحة المنتج." />
          </Field>
        </section>

        <section className="surface flex flex-col gap-4 rounded-2xl p-5 shadow-card">
          <h2 className="text-base font-bold">السعر</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="سعر البيع ($) *" hint="السعر الأصلي قبل أي خصم. يراه الزبون كما هو بالضبط.">
              <input required inputMode="decimal" dir="ltr" value={f.sellPrice} onChange={(e) => set('sellPrice', e.target.value)} className={input + ' text-right tnum'} placeholder="26.50" />
            </Field>
            <Field label="التكلفة ($) *" hint="ما تدفعه أنت للمورّد. لا تظهر للزبون.">
              <input required inputMode="decimal" dir="ltr" value={f.costPrice} onChange={(e) => set('costPrice', e.target.value)} className={input + ' text-right tnum'} placeholder="24.00" />
            </Field>
          </div>
          <Field label="الخصم % (اختياري)" hint="اكتب نسبة الخصم فيظهر للزبون السعر القديم مشطوبًا. اتركه فارغًا = بلا خصم.">
            <input
              inputMode="numeric"
              dir="ltr"
              value={f.discountPercent ?? ''}
              onChange={(e) => set('discountPercent', e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
              className={input + ' text-right tnum sm:w-40'}
              placeholder="مثال: 10"
            />
          </Field>
          {margin && (
            <div className="surface-2 flex flex-col gap-1 rounded-xl px-4 py-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted">يدفع الزبون</span>
                {/* dir=ltr keeps "$" and the struck price in reading order inside RTL text */}
                <span dir="ltr" className="tnum font-bold">
                  {discount > 0 && (
                    <span className="me-2 text-muted line-through">${parseFloat(String(f.sellPrice)).toFixed(2)}</span>
                  )}
                  ${margin.pays.toFixed(2)}
                </span>
              </div>
              <div className={'flex items-center justify-between font-semibold ' + (margin.profit < 0 ? 'text-bad' : 'text-ok')}>
                <span>ربحك لكل قطعة</span>
                <span dir="ltr" className="tnum">
                  ${margin.profit.toFixed(2)} ({margin.pct.toFixed(1)}%)
                </span>
              </div>
            </div>
          )}
        </section>

        <section className="surface flex flex-col gap-4 rounded-2xl p-5 shadow-card">
          <h2 className="text-base font-bold">التسليم والمخزون</h2>
          <Field label="طريقة التسليم *" hint={delivery?.hint}>
            <select value={f.delivery} onChange={(e) => set('delivery', e.target.value)} className={input}>
              {DELIVERIES.map((d) => (
                <option key={d.v} value={d.v}>
                  {d.l}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="الكمية المتاحة (اختياري)" hint="اتركها فارغة = غير محدودة.">
              <input inputMode="numeric" dir="ltr" value={f.stockQty ?? ''} onChange={(e) => set('stockQty', e.target.value === '' ? null : (e.target.value as unknown as number))} className={input + ' text-right tnum'} />
            </Field>
            <Field label="أقصى كمية للطلب الواحد (اختياري)">
              <input inputMode="numeric" dir="ltr" value={f.maxPerOrder ?? ''} onChange={(e) => set('maxPerOrder', e.target.value === '' ? null : (e.target.value as unknown as number))} className={input + ' text-right tnum'} />
            </Field>
          </div>
        </section>
      </div>

      <div className="flex flex-col gap-5">
        <section className="surface flex flex-col gap-4 rounded-2xl p-5 shadow-card">
          <h2 className="text-base font-bold">الصورة</h2>
          <div className="grid aspect-[4/3] place-items-center overflow-hidden rounded-xl bg-teal/10 text-3xl font-extrabold text-teal/40">
            {f.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={f.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              (f.nameAr || 'P').slice(0, 1)
            )}
          </div>
          <Field label="رابط الصورة (اختياري)" hint="الصق رابط صورة يبدأ بـ https://">
            <input dir="ltr" value={f.imageUrl ?? ''} onChange={(e) => set('imageUrl', e.target.value)} className={input + ' text-right'} placeholder="https://…" />
          </Field>
        </section>

        <section className="surface flex flex-col gap-3 rounded-2xl p-5 shadow-card">
          <h2 className="text-base font-bold">الظهور</h2>
          <label className="flex items-center justify-between gap-3 text-sm font-semibold">
            ظاهر في المتجر
            <input type="checkbox" checked={f.isActive} onChange={(e) => set('isActive', e.target.checked)} className="h-5 w-5 accent-teal" />
          </label>
          <label className="flex items-center justify-between gap-3 text-sm font-semibold">
            منتج مميّز (يظهر في الرئيسية)
            <input type="checkbox" checked={f.isFeatured} onChange={(e) => set('isFeatured', e.target.checked)} className="h-5 w-5 accent-teal" />
          </label>
          <Field label="رمز المنتج SKU *" hint="يُولَّد تلقائيًّا من الاسم الإنجليزي.">
            <input
              required
              minLength={3}
              maxLength={40}
              dir="ltr"
              value={f.sku}
              onChange={(e) => {
                setSkuTouched(true);
                set('sku', e.target.value.toUpperCase());
              }}
              className={input + ' text-right font-mono text-sm'}
            />
          </Field>
        </section>

        {error && (
          <p role="alert" className="rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad">
            {error}
          </p>
        )}

        <button type="submit" disabled={busy} className="rounded-xl bg-teal py-3 text-[15px] font-bold text-white transition hover:bg-teal-deep disabled:opacity-60">
          {busy ? 'جارٍ الحفظ…' : editing ? 'حفظ التعديلات' : 'إضافة المنتج'}
        </button>
      </div>
    </form>
  );
}
