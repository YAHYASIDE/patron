'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { date, dateTime, money, moneyIn, num, statusChip } from '@/lib/format';
import { countryName, flagOf } from '@/lib/countries';
import Notice from '@/components/Notice';

type Customer = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  country: string | null;
  city: string | null;
  adminNote: string | null;
  tags: string[];
  phoneVerifiedAt: string | null;
  isBlocked: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  stats: { orders: number; paidOrders: number; totalSpentBase: string | number; lastOrderAt: string | null };
  orders: {
    id: string;
    orderNumber: string;
    status: string;
    total: string;
    currency: string;
    createdAt: string;
  }[];
};

const SUGGESTED_TAGS = ['VIP', 'مراقبة', 'جملة'];
const MAX_TAGS = 10;
const MAX_TAG = 20;
const MAX_NOTE = 1000;

/** One customer: who they are, what they bought, and the owner's private note and tags. */
export default function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: c, loading, error, reload } = useFetch<Customer>(`/admin/customers/${id}`);

  return (
    <div className="flex flex-col gap-5">
      <Link href="/customers" className="text-sm font-semibold text-muted hover:text-[rgb(var(--text))]">
        ← الزبائن
      </Link>
      {loading && !c && <p className="text-sm text-muted">جارٍ التحميل…</p>}
      {error && <Notice text={error} />}
      {c && <Profile c={c} onSaved={reload} />}
    </div>
  );
}

function Profile({ c, onSaved }: { c: Customer; onSaved: () => void }) {
  const stats = [
    { k: 'كل الطلبات', v: num(c.stats.orders) },
    { k: 'مدفوعة', v: num(c.stats.paidOrders) },
    { k: 'مجموع المشتريات', v: money(c.stats.totalSpentBase) },
    { k: 'آخر طلب', v: c.stats.lastOrderAt ? date(c.stats.lastOrderAt) : '—' },
  ];

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-extrabold">{c.fullName}</h1>
            {c.phoneVerifiedAt ? (
              <span className="rounded-full bg-ok/12 px-2 py-0.5 text-[11px] font-bold text-ok">موثّق</span>
            ) : (
              <span className="rounded-full bg-warn/12 px-2 py-0.5 text-[11px] font-bold text-warn">
                غير موثّق
              </span>
            )}
            {c.isBlocked && (
              <span className="rounded-full bg-bad/12 px-2 py-0.5 text-[11px] font-bold text-bad">موقوف</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-sm text-muted">
            {c.phone && <span dir="ltr">{c.phone}</span>}
            {c.email && <span dir="ltr">{c.email}</span>}
            <span>
              {flagOf(c.country)} {countryName(c.country)}
              {c.city ? ` · ${c.city}` : ''}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted">
            انضمّ {date(c.createdAt)} · آخر دخول {c.lastLoginAt ? dateTime(c.lastLoginAt) : '—'}
          </div>
        </div>
        {c.phone && (
          <a
            href={`https://wa.me/${c.phone.replace(/\D/g, '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl bg-[#1FA855] px-5 py-2.5 text-sm font-bold text-white"
          >
            واتساب
          </a>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.k} className="surface rounded-2xl p-4 shadow-card">
            <div className="text-xs font-semibold text-muted">{s.k}</div>
            <div className="tnum mt-1 text-xl font-extrabold">{s.v}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <NotesAndTags c={c} onSaved={onSaved} />
        </div>

        <section className="surface overflow-hidden rounded-2xl shadow-card lg:col-span-3">
          <div className="flex items-center justify-between gap-2 px-5 py-4">
            <h2 className="text-base font-bold">طلباته</h2>
            {c.phone && (
              <Link
                href={`/orders?search=${encodeURIComponent(c.phone)}`}
                className="text-sm font-semibold text-teal hover:underline"
              >
                كل طلباته
              </Link>
            )}
          </div>
          {c.orders.length === 0 && <p className="px-5 pb-5 text-sm text-muted">لم يطلب شيئًا بعد.</p>}
          <div className="flex flex-col divide-y divide-[rgb(var(--line))] border-t hairline">
            {c.orders.map((o) => {
              const chip = statusChip(o.status);
              return (
                <Link
                  key={o.id}
                  href={`/orders/${o.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm hover:bg-[rgb(var(--surface-2))]"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold" dir="ltr">
                      {o.orderNumber}
                    </span>
                    <span className="block text-xs text-muted">{date(o.createdAt)}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span
                      className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${chip.cls}`}
                    >
                      {chip.label}
                    </span>
                    <span className="tnum whitespace-nowrap font-bold">{moneyIn(o.total, o.currency)}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      </div>
    </>
  );
}

/** The owner's private note and tags (VIP, watch…), never shown to the customer. */
function NotesAndTags({ c, onSaved }: { c: Customer; onSaved: () => void }) {
  const [note, setNote] = useState(c.adminNote ?? '');
  const [tags, setTags] = useState<string[]>(c.tags ?? []);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    setNote(c.adminNote ?? '');
    setTags(c.tags ?? []);
  }, [c]);

  const dirty = note !== (c.adminNote ?? '') || tags.join('|') !== (c.tags ?? []).join('|');

  function add(raw: string) {
    const t = raw.trim().slice(0, MAX_TAG);
    if (!t || tags.includes(t) || tags.length >= MAX_TAGS) return;
    setTags((x) => [...x, t]);
    setDraft('');
    setMsg(null);
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      await api.patch(`/admin/customers/${c.id}`, { adminNote: note.trim() ? note.trim() : null, tags });
      setMsg({ ok: true, text: 'تم الحفظ.' });
      onSaved();
    } catch (e) {
      setMsg({
        ok: false,
        text:
          e instanceof ApiError
            ? e.status === 403
              ? 'ليست لديك صلاحية تعديل الزبائن.'
              : e.message
            : 'تعذّر الحفظ.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface flex flex-col gap-4 rounded-2xl p-5 shadow-card">
      <div>
        <h2 className="text-base font-bold">ملاحظات ووسوم</h2>
        <p className="mt-1 text-xs text-muted">لك وحدك، لا يراها الزبون.</p>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">الوسوم</span>
        <div className="flex flex-wrap gap-1.5">
          {tags.length === 0 && <span className="text-xs text-muted">لا وسوم.</span>}
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-full bg-gold/15 py-1 pe-1.5 ps-2.5 text-xs font-bold text-gold-deep"
            >
              {t}
              <button
                onClick={() => setTags((x) => x.filter((y) => y !== t))}
                aria-label={`إزالة ${t}`}
                className="grid h-5 w-5 place-items-center rounded-full hover:bg-gold/25"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTED_TAGS.filter((t) => !tags.includes(t)).map((t) => (
            <button
              key={t}
              onClick={() => add(t)}
              disabled={tags.length >= MAX_TAGS}
              className="rounded-full border border-dashed border-[rgb(var(--line))] px-2.5 py-1 text-xs font-bold text-muted hover:border-teal hover:text-teal disabled:opacity-40"
            >
              + {t}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            add(draft);
          }}
          className="flex gap-2"
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={MAX_TAG}
            placeholder="وسم آخر…"
            disabled={tags.length >= MAX_TAGS}
            className="surface-2 hairline min-w-0 flex-1 rounded-xl border px-3.5 py-2 text-sm outline-none focus:border-teal"
          />
          <button
            disabled={!draft.trim() || tags.length >= MAX_TAGS}
            className="rounded-xl border border-[rgb(var(--line))] px-4 text-sm font-bold disabled:opacity-40"
          >
            أضف
          </button>
        </form>
        {tags.length >= MAX_TAGS && <span className="text-xs text-muted">الحد {MAX_TAGS} وسوم.</span>}
      </div>

      <label className="flex flex-col gap-2">
        <span className="flex items-center justify-between text-sm font-semibold">
          ملاحظة
          <span className="tnum text-xs font-normal text-muted">
            {note.length}/{MAX_NOTE}
          </span>
        </span>
        <textarea
          rows={5}
          value={note}
          maxLength={MAX_NOTE}
          onChange={(e) => {
            setNote(e.target.value);
            setMsg(null);
          }}
          placeholder="مثال: يشتري بطاقات آيتونز كل أسبوع، يفضّل التحويل عبر بنكيلي."
          className="surface-2 hairline w-full rounded-xl border px-3.5 py-2.5 text-[15px] outline-none focus:border-teal"
        />
      </label>

      <button
        onClick={save}
        disabled={busy || !dirty}
        className="rounded-xl bg-teal py-2.5 text-sm font-bold text-white transition hover:bg-teal-deep disabled:opacity-50"
      >
        {busy ? 'جارٍ الحفظ…' : 'حفظ'}
      </button>
      {msg && <Notice text={msg.text} tone={msg.ok ? 'ok' : 'bad'} />}
    </section>
  );
}
