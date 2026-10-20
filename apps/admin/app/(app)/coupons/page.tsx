'use client';

import { useState } from 'react';
import { api, ApiError, NOT_READY } from '@/lib/api';
import { rowsOf, useFetch } from '@/lib/hooks';
import { date, money, num } from '@/lib/format';
import Notice from '@/components/Notice';

type Coupon = {
  id: string;
  code: string;
  discountType: 'PERCENT' | 'FIXED';
  discountValue: string | number;
  maxDiscount: string | number | null;
  minOrderTotal: string | number | null;
  maxUses: number | null;
  maxUsesPerUser: number | null;
  usedCount: number;
  startsAt: string | null;
  expiresAt: string | null;
  isActive: boolean;
};

type Form = {
  code: string;
  discountType: 'PERCENT' | 'FIXED';
  discountValue: string;
  maxDiscount: string;
  minOrderTotal: string;
  maxUses: string;
  maxUsesPerUser: string;
  from: string; // yyyy-mm-dd, empty = from now
  to: string; // yyyy-mm-dd inclusive, empty = no end
  isActive: boolean;
};

const EMPTY: Form = {
  code: '',
  discountType: 'PERCENT',
  discountValue: '',
  maxDiscount: '',
  minOrderTotal: '',
  maxUses: '',
  maxUsesPerUser: '1',
  from: '',
  to: '',
  isActive: true,
};

const field =
  'surface-2 hairline w-full min-w-0 rounded-xl border px-3.5 py-2.5 text-[15px] outline-none transition focus:border-teal';

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-CA') : '');
const str = (v: string | number | null | undefined) => (v === null || v === undefined ? '' : String(v));

function toForm(c: Coupon): Form {
  // expiresAt is stored as the start of the day after the last day
  const to = c.expiresAt ? day(new Date(new Date(c.expiresAt).getTime() - 86_400_000).toISOString()) : '';
  return {
    code: c.code,
    discountType: c.discountType,
    discountValue: str(c.discountValue),
    maxDiscount: str(c.maxDiscount),
    minOrderTotal: str(c.minOrderTotal),
    maxUses: str(c.maxUses),
    maxUsesPerUser: str(c.maxUsesPerUser),
    from: day(c.startsAt),
    to,
    isActive: c.isActive,
  };
}

/** On create an empty field is left out; on edit it is sent as null so the limit is removed. */
function toBody(f: Form, editing: boolean) {
  const opt = (v: string) => (v.trim() === '' ? (editing ? null : undefined) : Number(v));
  const end = f.to ? new Date(`${f.to}T00:00:00`) : null;
  if (end) end.setDate(end.getDate() + 1);
  return {
    code: f.code.trim().toUpperCase(),
    discountType: f.discountType,
    discountValue: Number(f.discountValue),
    maxDiscount: f.discountType === 'PERCENT' ? opt(f.maxDiscount) : editing ? null : undefined,
    minOrderTotal: opt(f.minOrderTotal),
    maxUses: opt(f.maxUses),
    maxUsesPerUser: opt(f.maxUsesPerUser),
    startsAt: f.from ? new Date(`${f.from}T00:00:00`).toISOString() : editing ? null : undefined,
    expiresAt: end ? end.toISOString() : editing ? null : undefined,
    isActive: f.isActive,
  };
}

function stateOf(c: Coupon): { t: string; c: string } {
  const now = Date.now();
  if (!c.isActive) return { t: 'موقوفة', c: 'bg-ink-400/15 text-muted' };
  if (c.expiresAt && new Date(c.expiresAt).getTime() <= now)
    return { t: 'انتهت', c: 'bg-ink-400/15 text-muted' };
  if (c.maxUses !== null && c.usedCount >= c.maxUses) return { t: 'استُنفدت', c: 'bg-ink-400/15 text-muted' };
  if (c.startsAt && new Date(c.startsAt).getTime() > now) return { t: 'مجدولة', c: 'bg-warn/12 text-warn' };
  return { t: 'فعّالة', c: 'bg-ok/12 text-ok' };
}

const valueOf = (c: Pick<Coupon, 'discountType' | 'discountValue'>) =>
  c.discountType === 'PERCENT' ? `${num(c.discountValue, 0)}%` : money(c.discountValue);

function friendly(e: unknown): string {
  if (!(e instanceof ApiError)) return 'تعذّر الاتصال بالخادم.';
  if (e.message === NOT_READY) return NOT_READY;
  if (e.status === 409) return 'هذا الرمز مستخدم لقسيمة أخرى.';
  if (e.status === 403) return 'ليست لديك صلاحية إدارة القسائم.';
  return e.message;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-sm font-semibold">{label}</span>
      {children}
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

function Editor({ initial, id, onDone }: { initial: Form; id: string | null; onDone: () => void }) {
  const [f, setF] = useState<Form>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const v = Number(f.discountValue);
    if (!/^[A-Z0-9_-]{3,30}$/i.test(f.code.trim()))
      return setError('الرمز من 3 إلى 30 حرفًا لاتينيًا أو رقمًا.');
    if (!(v > 0)) return setError('اكتب قيمة الخصم.');
    if (f.discountType === 'PERCENT' && v > 100) return setError('النسبة لا تتجاوز 100%.');
    if (f.from && f.to && f.to < f.from) return setError('تاريخ النهاية قبل تاريخ البداية.');
    setBusy(true);
    setError(null);
    try {
      if (id) await api.patch(`/admin/coupons/${id}`, toBody(f, true));
      else await api.post('/admin/coupons', toBody(f, false));
      onDone();
    } catch (err) {
      setError(friendly(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="surface flex flex-col gap-4 rounded-2xl p-5 shadow-card">
      <h2 className="text-base font-bold">{id ? `تعديل القسيمة ${initial.code}` : 'قسيمة جديدة'}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="الرمز" hint="يكتبه الزبون عند الدفع، مثال: EID10">
          <input
            value={f.code}
            onChange={(e) => set('code', e.target.value.toUpperCase())}
            maxLength={30}
            dir="ltr"
            placeholder="EID10"
            className={field + ' font-mono uppercase'}
          />
        </Field>
        <Field label="نوع الخصم">
          <div className="flex gap-2">
            {(['PERCENT', 'FIXED'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => set('discountType', t)}
                className={
                  'flex-1 rounded-xl border py-2.5 text-sm font-bold transition ' +
                  (f.discountType === t ? 'border-teal bg-teal/10 text-teal' : 'hairline text-muted')
                }
              >
                {t === 'PERCENT' ? 'نسبة %' : 'مبلغ ثابت $'}
              </button>
            ))}
          </div>
        </Field>
        <Field label={f.discountType === 'PERCENT' ? 'النسبة (%)' : 'المبلغ ($)'}>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={f.discountValue}
            onChange={(e) => set('discountValue', e.target.value)}
            dir="ltr"
            className={field}
          />
        </Field>
        {f.discountType === 'PERCENT' && (
          <Field label="أقصى خصم ($)" hint="اختياري: سقف الخصم في الطلب الواحد">
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={f.maxDiscount}
              onChange={(e) => set('maxDiscount', e.target.value)}
              dir="ltr"
              className={field}
            />
          </Field>
        )}
        <Field label="أقل مبلغ للطلب ($)" hint="اختياري">
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={f.minOrderTotal}
            onChange={(e) => set('minOrderTotal', e.target.value)}
            dir="ltr"
            className={field}
          />
        </Field>
        <Field label="عدد الاستخدامات الكلي" hint="فارغ = بلا حد">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={f.maxUses}
            onChange={(e) => set('maxUses', e.target.value)}
            dir="ltr"
            className={field}
          />
        </Field>
        <Field label="لكل زبون" hint="كم مرة يستخدمها الزبون الواحد">
          <input
            type="number"
            inputMode="numeric"
            min={1}
            value={f.maxUsesPerUser}
            onChange={(e) => set('maxUsesPerUser', e.target.value)}
            dir="ltr"
            className={field}
          />
        </Field>
        <Field label="من يوم" hint="فارغ = من الآن">
          <input type="date" value={f.from} onChange={(e) => set('from', e.target.value)} className={field} />
        </Field>
        <Field label="حتى يوم (يشمله)" hint="فارغ = بلا نهاية">
          <input type="date" value={f.to} onChange={(e) => set('to', e.target.value)} className={field} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <input
          type="checkbox"
          checked={f.isActive}
          onChange={(e) => set('isActive', e.target.checked)}
          className="h-4 w-4 accent-[#0d6d64]"
        />
        فعّالة
      </label>
      <p className="text-xs text-muted">
        المبالغ بالدولار (العملة الأساسية)، وتُحوَّل لعملة الزبون عند الدفع.
      </p>
      {error && <Notice text={error} />}
      <div className="flex gap-2">
        <button
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

/** Discount codes: who can use them, until when, and how often they were used. */
export default function CouponsPage() {
  const list = useFetch<Coupon[] | { data: Coupon[] }>('/admin/coupons');
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = rowsOf(list.data);

  async function toggle(c: Coupon) {
    setError(null);
    try {
      await api.patch(`/admin/coupons/${c.id}`, { isActive: !c.isActive });
      list.reload();
    } catch (e) {
      setError(friendly(e));
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">القسائم</h1>
          <p className="mt-1 text-sm text-muted">رموز خصم يكتبها الزبون عند الدفع. أوقفها متى شئت.</p>
        </div>
        {!editing && !list.error && (
          <button
            onClick={() => setEditing({ id: null, form: EMPTY })}
            className="rounded-xl bg-teal px-5 py-2.5 text-sm font-bold text-white transition hover:bg-teal-deep"
          >
            + قسيمة جديدة
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

      {error && <Notice text={error} />}
      {list.loading && !list.data && <p className="text-sm text-muted">جارٍ التحميل…</p>}
      {list.error && <Notice text={list.error} />}
      {list.data && rows.length === 0 && !editing && (
        <div className="rounded-2xl border border-dashed border-[rgb(var(--line))] p-10 text-center text-sm text-muted">
          لا قسائم بعد.
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {rows.map((c) => {
          const s = stateOf(c);
          const pct = c.maxUses ? Math.min(100, (100 * c.usedCount) / c.maxUses) : 0;
          return (
            <section key={c.id} className="surface flex flex-col gap-3 rounded-2xl p-4 shadow-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-mono text-lg font-extrabold" dir="ltr">
                    {c.code}
                  </div>
                  <div className="text-sm text-muted">
                    خصم <b className="text-[rgb(var(--text))]">{valueOf(c)}</b>
                    {c.maxDiscount ? ` حتى ${money(c.maxDiscount)}` : ''}
                    {c.minOrderTotal ? ` · من ${money(c.minOrderTotal)}` : ''}
                  </div>
                </div>
                <span className={`flex-none rounded-full px-2.5 py-1 text-xs font-bold ${s.c}`}>{s.t}</span>
              </div>
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted">الاستخدام</span>
                  <span className="tnum font-bold">
                    {num(c.usedCount)}
                    {c.maxUses ? ` / ${num(c.maxUses)}` : ' (بلا حد)'}
                  </span>
                </div>
                {c.maxUses ? (
                  <div className="h-1.5 overflow-hidden rounded-full surface-2" aria-hidden>
                    <div className="h-full rounded-full bg-teal" style={{ width: `${pct}%` }} />
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                {c.maxUsesPerUser ? <span>{num(c.maxUsesPerUser)} لكل زبون</span> : null}
                {c.startsAt && <span>من {date(c.startsAt)}</span>}
                {c.expiresAt && (
                  <span>
                    حتى {date(new Date(new Date(c.expiresAt).getTime() - 86_400_000).toISOString())}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setEditing({ id: c.id, form: toForm(c) });
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="hairline flex-1 rounded-xl border py-2 text-sm font-bold hover:border-teal"
                >
                  تعديل
                </button>
                <button
                  onClick={() => toggle(c)}
                  className={
                    'flex-1 rounded-xl border py-2 text-sm font-bold ' +
                    (c.isActive ? 'border-warn/40 text-warn' : 'border-ok/40 text-ok')
                  }
                >
                  {c.isActive ? 'إيقاف مؤقت' : 'استئناف'}
                </button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
