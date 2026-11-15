'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiError, uploadUrl } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { date } from '@/lib/format';

type Tone = 'teal' | 'gold' | 'ink' | 'rose';
type LinkType = '' | 'product' | 'offers' | 'url';

type Banner = {
  id: string;
  titleAr: string;
  subtitleAr: string | null;
  imageUrl: string | null;
  tone: Tone;
  linkType: Exclude<LinkType, ''> | null;
  linkValue: string | null;
  sortOrder: number;
  isActive: boolean;
  startsAt: string | null;
  endsAt: string | null;
};

type Form = {
  titleAr: string;
  subtitleAr: string;
  imageUrl: string;
  tone: Tone;
  linkType: LinkType;
  linkValue: string;
  sortOrder: number;
  isActive: boolean;
  from: string; // yyyy-mm-dd, empty = from now
  to: string; // yyyy-mm-dd inclusive, empty = no end
};

type ProductHit = { id: string; sku: string; nameAr: string };

// same colours as the store's banners
const TONES: { id: Tone; label: string; cls: string }[] = [
  { id: 'teal', label: 'أخضر', cls: 'bg-gradient-to-br from-teal to-teal-ink text-white' },
  { id: 'gold', label: 'ذهبي', cls: 'bg-gradient-to-br from-gold-soft to-gold-deep text-ink-950' },
  { id: 'ink', label: 'داكن', cls: 'bg-gradient-to-br from-ink-800 to-ink-950 text-white' },
  { id: 'rose', label: 'وردي', cls: 'bg-gradient-to-br from-[#e5486b] to-[#9f1f45] text-white' },
];
const toneCls = (t: Tone) => (TONES.find((x) => x.id === t) ?? TONES[0]).cls;

const EMPTY: Form = {
  titleAr: '',
  subtitleAr: '',
  imageUrl: '',
  tone: 'teal',
  linkType: 'offers',
  linkValue: '',
  sortOrder: 0,
  isActive: true,
  from: '',
  to: '',
};

const field =
  'surface-2 hairline w-full rounded-xl border px-3.5 py-2.5 text-[15px] outline-none transition focus:border-teal';

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-CA') : '');

function toForm(b: Banner): Form {
  // endsAt is stored as the start of the day after the last day
  const to = b.endsAt ? day(new Date(new Date(b.endsAt).getTime() - 86_400_000).toISOString()) : '';
  return {
    titleAr: b.titleAr,
    subtitleAr: b.subtitleAr ?? '',
    imageUrl: b.imageUrl ?? '',
    tone: b.tone,
    linkType: b.linkType ?? '',
    linkValue: b.linkValue ?? '',
    sortOrder: b.sortOrder,
    isActive: b.isActive,
    from: day(b.startsAt),
    to,
  };
}

function toBody(f: Form) {
  const end = f.to ? new Date(`${f.to}T00:00:00`) : null;
  if (end) end.setDate(end.getDate() + 1);
  return {
    titleAr: f.titleAr.trim(),
    subtitleAr: f.subtitleAr.trim(),
    imageUrl: f.imageUrl.trim(),
    tone: f.tone,
    linkType: f.linkType,
    linkValue: f.linkType === 'product' || f.linkType === 'url' ? f.linkValue.trim() : null,
    sortOrder: f.sortOrder,
    isActive: f.isActive,
    startsAt: f.from ? new Date(`${f.from}T00:00:00`).toISOString() : null,
    endsAt: end ? end.toISOString() : null,
  };
}

function stateOf(b: Banner): { t: string; c: string } {
  const now = Date.now();
  if (!b.isActive) return { t: 'مخفي', c: 'bg-ink-400/15 text-muted' };
  if (b.endsAt && new Date(b.endsAt).getTime() <= now) return { t: 'انتهى', c: 'bg-ink-400/15 text-muted' };
  if (b.startsAt && new Date(b.startsAt).getTime() > now) return { t: 'مجدول', c: 'bg-warn/12 text-warn' };
  return { t: 'يظهر الآن', c: 'bg-ok/12 text-ok' };
}

function Preview({ titleAr, subtitleAr, imageUrl, tone }: Pick<Form, 'titleAr' | 'subtitleAr' | 'imageUrl' | 'tone'>) {
  return (
    <div
      className={`relative flex h-[120px] flex-col justify-end overflow-hidden rounded-2xl p-4 ${
        imageUrl ? 'bg-ink-900 text-white' : toneCls(tone)
      }`}
    >
      {imageUrl && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element -- owner-supplied link on any host */}
          <img
            src={imageUrl.startsWith('/uploads/') ? uploadUrl(imageUrl) : imageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
          <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
        </>
      )}
      <div className="relative">
        <div className="text-lg font-extrabold leading-snug">{titleAr || 'عنوان العرض'}</div>
        {subtitleAr && <div className="mt-0.5 text-sm opacity-90">{subtitleAr}</div>}
      </div>
    </div>
  );
}

/** Pick the product a banner opens, by searching the catalogue. */
function ProductPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<ProductHit[]>([]);
  const chosen = useFetch<ProductHit>(value ? `/admin/catalog/products/${value}` : null);

  useEffect(() => {
    if (q.trim().length < 2) return setHits([]);
    const t = setTimeout(() => {
      api
        .get<{ data: ProductHit[] }>(`/admin/catalog/products?limit=8&search=${encodeURIComponent(q.trim())}`)
        .then((r) => setHits(r.data))
        .catch(() => setHits([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="flex flex-col gap-2">
      {value && chosen.data && (
        <div className="surface-2 flex items-center justify-between gap-2 rounded-xl px-3.5 py-2.5 text-sm">
          <span className="font-bold">{chosen.data.nameAr}</span>
          <span dir="ltr" className="text-xs text-muted">
            {chosen.data.sku}
          </span>
        </div>
      )}
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={value ? 'غيّر المنتج: ابحث بالاسم…' : 'ابحث عن المنتج بالاسم…'}
        className={field}
      />
      {hits.length > 0 && (
        <ul className="surface hairline overflow-hidden rounded-xl border">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => {
                  onChange(h.id);
                  setQ('');
                  setHits([]);
                }}
                className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-start text-sm hover:bg-[rgb(var(--surface-2))]"
              >
                <span className="font-semibold">{h.nameAr}</span>
                <span dir="ltr" className="text-xs text-muted">
                  {h.sku}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Editor({ initial, id, onDone }: { initial: Form; id: string | null; onDone: () => void }) {
  const [f, setF] = useState<Form>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));
  const file = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // the owner has no image hosting: the picture is kept by the API
  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    setUploading(true);
    setError(null);
    try {
      const res = await api.upload<{ path: string }>('/admin/uploads/banner', picked);
      set('imageUrl', res.path);
    } catch {
      setError('تعذّر رفع الصورة (JPG أو PNG، أقل من 4 ميغا).');
    } finally {
      setUploading(false);
    }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (f.titleAr.trim().length < 2) return setError('اكتب عنوان العرض.');
    if (f.linkType === 'product' && !f.linkValue) return setError('اختر المنتج الذي يفتحه العرض.');
    if (f.linkType === 'url' && !/^(\/|https:\/\/)/.test(f.linkValue.trim()))
      return setError('الرابط يبدأ بـ / لصفحة في المتجر، أو بـ https://');
    if (f.imageUrl.trim() && !/^(https:\/\/|\/uploads\/)/.test(f.imageUrl.trim()))
      return setError('رابط الصورة يبدأ بـ https://');
    if (f.from && f.to && f.to < f.from) return setError('تاريخ النهاية قبل تاريخ البداية.');
    setBusy(true);
    setError(null);
    try {
      if (id) await api.put(`/admin/banners/${id}`, toBody(f));
      else await api.post('/admin/banners', toBody(f));
      onDone();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 403 ? 'ليست لديك صلاحية إدارة العروض.' : 'تعذّر حفظ العرض.',
      );
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="surface flex flex-col gap-4 rounded-2xl p-5 shadow-card">
      <h2 className="text-base font-bold">{id ? 'تعديل العرض' : 'عرض جديد'}</h2>
      <Preview {...f} />

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">العنوان</span>
        <input
          value={f.titleAr}
          onChange={(e) => set('titleAr', e.target.value)}
          maxLength={80}
          placeholder="مثال: خصم 10% على شدات ببجي"
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">سطر ثانٍ (اختياري)</span>
        <input
          value={f.subtitleAr}
          onChange={(e) => set('subtitleAr', e.target.value)}
          maxLength={140}
          placeholder="مثال: حتى نهاية الأسبوع فقط"
          className={field}
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">اللون</span>
        <div className="flex flex-wrap gap-2">
          {TONES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => set('tone', t.id)}
              aria-pressed={f.tone === t.id}
              className={`rounded-xl px-4 py-2 text-sm font-bold ${t.cls} ${
                f.tone === t.id ? 'ring-2 ring-teal ring-offset-2 ring-offset-[rgb(var(--surface))]' : 'opacity-80'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">صورة (اختياري)</span>
        <div className="flex gap-2">
          <input
            value={f.imageUrl}
            onChange={(e) => set('imageUrl', e.target.value)}
            dir="ltr"
            placeholder="https://…"
            className={field}
          />
          <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} className="hidden" />
          <button
            type="button"
            onClick={() => file.current?.click()}
            disabled={uploading}
            className="hairline flex-none rounded-xl border px-4 text-sm font-bold text-teal disabled:opacity-50"
          >
            {uploading ? 'جارٍ…' : 'ارفع صورة'}
          </button>
          {f.imageUrl && (
            <button type="button" onClick={() => set('imageUrl', '')} className="flex-none px-2 text-sm font-bold text-bad">
              إزالة
            </button>
          )}
        </div>
        <span className="text-xs text-muted">بدون صورة يظهر العرض باللون الذي اخترته.</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold">عند الضغط عليه يفتح</span>
        <select
          value={f.linkType}
          onChange={(e) => setF((x) => ({ ...x, linkType: e.target.value as LinkType, linkValue: '' }))}
          className={field}
        >
          <option value="offers">صفحة العروض والتخفيضات</option>
          <option value="product">منتجًا محدّدًا</option>
          <option value="url">رابطًا آخر</option>
          <option value="">لا شيء</option>
        </select>
        {f.linkType === 'product' && <ProductPicker value={f.linkValue} onChange={(v) => set('linkValue', v)} />}
        {f.linkType === 'url' && (
          <input
            value={f.linkValue}
            onChange={(e) => set('linkValue', e.target.value)}
            dir="ltr"
            placeholder="/products?s=games  أو  https://…"
            className={field}
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">من يوم</span>
          <input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">إلى يوم</span>
          <input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} className={field} />
        </label>
      </div>
      <p className="-mt-2 text-xs text-muted">اتركهما فارغين ليظهر العرض من الآن وبلا نهاية.</p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={f.isActive}
            onChange={(e) => set('isActive', e.target.checked)}
            className="h-4 w-4 accent-teal"
          />
          ظاهر في المتجر
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold">
          الترتيب
          <input
            type="number"
            min={0}
            max={999}
            value={f.sortOrder}
            onChange={(e) => set('sortOrder', Math.max(0, Math.min(999, Number(e.target.value) || 0)))}
            className={field + ' w-20 text-center'}
          />
        </label>
      </div>

      {error && <p className="rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="flex-1 rounded-xl bg-teal py-3 text-sm font-bold text-white transition hover:bg-teal-deep disabled:opacity-50"
        >
          {busy ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="hairline rounded-xl border px-5 py-3 text-sm font-bold text-muted hover:text-[rgb(var(--text))]"
        >
          إلغاء
        </button>
      </div>
    </form>
  );
}

export default function BannersPage() {
  const list = useFetch<Banner[]>('/admin/banners');
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(b: Banner) {
    if (!confirm(`حذف العرض «${b.titleAr}»؟`)) return;
    setError(null);
    try {
      await api.del(`/admin/banners/${b.id}`);
      list.reload();
    } catch {
      setError('تعذّر حذف العرض.');
    }
  }

  async function toggle(b: Banner) {
    setError(null);
    try {
      await api.put(`/admin/banners/${b.id}`, toBody({ ...toForm(b), isActive: !b.isActive }));
      list.reload();
    } catch {
      setError('تعذّر تحديث العرض.');
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">العروض</h1>
          <p className="mt-1 text-sm text-muted">لافتات تظهر أعلى الصفحة الرئيسية في المتجر، بالترتيب الذي تختاره.</p>
        </div>
        {!editing && (
          <button
            onClick={() => setEditing({ id: null, form: EMPTY })}
            className="rounded-xl bg-teal px-5 py-2.5 text-sm font-bold text-white transition hover:bg-teal-deep"
          >
            + عرض جديد
          </button>
        )}
      </div>

      {editing && (
        <Editor
          key={editing.id ?? 'new'}
          id={editing.id}
          initial={editing.form}
          onDone={() => {
            setEditing(null);
            list.reload();
          }}
        />
      )}

      {error && <div className="rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">{error}</div>}
      {list.loading && <p className="text-sm text-muted">جارٍ التحميل…</p>}
      {list.error && <p className="text-sm text-bad">{list.error}</p>}
      {list.data && list.data.length === 0 && !editing && (
        <div className="rounded-2xl border border-dashed border-[rgb(var(--line))] p-10 text-center text-sm text-muted">
          لا توجد عروض بعد. أضف أول عرض ليظهر في الصفحة الرئيسية.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {list.data?.map((b) => {
          const s = stateOf(b);
          return (
            <section key={b.id} className="surface flex flex-col gap-3 rounded-2xl p-4 shadow-card">
              <Preview
                titleAr={b.titleAr}
                subtitleAr={b.subtitleAr ?? ''}
                imageUrl={b.imageUrl ?? ''}
                tone={b.tone}
              />
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className={`rounded-full px-2.5 py-1 font-bold ${s.c}`}>{s.t}</span>
                <span>الترتيب {b.sortOrder}</span>
                {b.startsAt && <span>من {date(b.startsAt)}</span>}
                {b.endsAt && <span>حتى {date(new Date(new Date(b.endsAt).getTime() - 86_400_000).toISOString())}</span>}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setEditing({ id: b.id, form: toForm(b) });
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="hairline flex-1 rounded-xl border py-2 text-sm font-bold hover:border-teal"
                >
                  تعديل
                </button>
                <button
                  onClick={() => toggle(b)}
                  className="hairline flex-1 rounded-xl border py-2 text-sm font-bold text-muted hover:text-[rgb(var(--text))]"
                >
                  {b.isActive ? 'إخفاء' : 'إظهار'}
                </button>
                <button
                  onClick={() => remove(b)}
                  className="rounded-xl border border-bad/40 px-4 py-2 text-sm font-bold text-bad hover:bg-bad/10"
                >
                  حذف
                </button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
