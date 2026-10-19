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
  // absent on an API without the wallet yet
  wallets?: { currencyCode: string; balance: string; updatedAt: string }[];
  ledger?: LedgerRow[];
};

type LedgerType = 'TOPUP' | 'ORDER_PAYMENT' | 'REFUND' | 'ADMIN_ADJUSTMENT' | 'CASHBACK';
type LedgerRow = {
  id: string;
  type: LedgerType;
  /** Signed: + credit, − debit. */
  amount: string;
  balanceAfter: string;
  currency: string;
  description: string | null;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
  by: string | null;
};

const SUGGESTED_TAGS = ['VIP', 'مراقبة', 'جملة'];
const MAX_TAGS = 10;
const MAX_TAG = 20;
const MAX_NOTE = 1000;
const MAX_REASON = 500;
// offered even when the customer has no balance in them yet
const WALLET_CURRENCIES = ['MRU', 'XOF', 'USD'];

/** The API writes order and refund lines in English; the dashboard reads Arabic. */
function describe(text: string): string {
  const refund = /^Refund for order (\S+)$/.exec(text);
  if (refund) return `استرجاع الطلب ${refund[1]}`;
  const order = /^Order (\S+)$/.exec(text);
  if (order) return `دفع الطلب ${order[1]}`;
  return text;
}

const LEDGER_TYPE: Record<LedgerType, string> = {
  TOPUP: 'شحن',
  ORDER_PAYMENT: 'دفع طلب',
  REFUND: 'استرجاع',
  ADMIN_ADJUSTMENT: 'تعديل يدوي',
  CASHBACK: 'مكافأة',
};

/** "100", "١٠٠٫٥" or "100,5" → a positive number with at most 4 decimals, else null. */
function parseAmount(text: string): number | null {
  const latin = text
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[٫,]/, '.')
    .trim();
  if (!/^\d+(\.\d{1,4})?$/.test(latin)) return null;
  const n = Number(latin);
  return n > 0 ? n : null;
}

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
          <Wallet c={c} onSaved={onSaved} />
        </div>
        <div className="lg:col-span-3">
          <Ledger rows={c.ledger ?? []} />
        </div>
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

/** The customer's balance per currency, and a hand correction (add or take away) with a reason. */
function Wallet({ c, onSaved }: { c: Customer; onSaved: () => void }) {
  const wallets = c.wallets ?? [];
  const currencies = [...new Set([...wallets.map((w) => w.currencyCode), ...WALLET_CURRENCIES])];
  const [currency, setCurrency] = useState(wallets[0]?.currencyCode ?? 'MRU');
  const [kind, setKind] = useState<'add' | 'take'>('add');
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const value = parseAmount(text);
  const current = Number(wallets.find((w) => w.currencyCode === currency)?.balance ?? 0);
  const signed = value === null ? null : kind === 'add' ? value : -value;
  // 4 decimals like the API, without binary noise (0.1 + 0.2)
  const after = signed === null ? null : Number((current + signed).toFixed(4));
  const short = after !== null && after < 0;
  const ready = value !== null && !short && reason.trim().length >= 3;

  /** Any change to the form cancels a pending confirmation. */
  function edit(fn: () => void) {
    fn();
    setConfirming(false);
    setMsg(null);
  }

  async function send() {
    if (signed === null) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post<{ balanceAfter: string }>('/wallet/adjust', {
        userId: c.id,
        currency,
        amount: signed,
        reason: reason.trim(),
      });
      setConfirming(false);
      setText('');
      setReason('');
      setMsg({ ok: true, text: `تم تعديل الرصيد. الرصيد الآن: ${moneyIn(r.balanceAfter, currency)}` });
      onSaved();
    } catch (e) {
      setConfirming(false);
      setMsg({
        ok: false,
        text:
          e instanceof ApiError
            ? e.status === 403
              ? 'ليست لديك صلاحية تعديل المحفظة.'
              : e.message
            : 'تعذّر تعديل الرصيد.',
      });
    } finally {
      setBusy(false);
    }
  }

  const input =
    'surface-2 hairline min-h-11 w-full min-w-0 rounded-xl border px-3 py-2.5 text-base outline-none focus:border-teal';

  return (
    <section className="surface flex flex-col gap-4 rounded-2xl p-5 shadow-card">
      <h2 className="text-base font-bold">المحفظة</h2>

      {wallets.length === 0 ? (
        <p className="text-sm text-muted">لا يوجد رصيد في المحفظة.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {wallets.map((w) => (
            <div key={w.currencyCode} className="rounded-xl bg-[rgb(var(--surface-2))] px-4 py-3">
              <div className="tnum text-2xl font-extrabold">{moneyIn(w.balance, w.currencyCode)}</div>
              <div className="mt-0.5 text-xs text-muted">آخر تغيير {dateTime(w.updatedAt)}</div>
            </div>
          ))}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) setConfirming(true);
        }}
        className="flex flex-col gap-3 border-t hairline pt-4"
      >
        <span className="text-sm font-semibold">تعديل الرصيد</span>

        <div className="grid grid-cols-2 gap-2">
          {(
            [
              { id: 'add', label: 'إضافة رصيد', on: 'border-ok/40 bg-ok/12 text-ok' },
              { id: 'take', label: 'خصم رصيد', on: 'border-bad/40 bg-bad/12 text-bad' },
            ] as const
          ).map((k) => (
            <button
              key={k.id}
              type="button"
              aria-pressed={kind === k.id}
              onClick={() => edit(() => setKind(k.id))}
              className={`min-h-11 rounded-xl border px-3 text-sm font-bold ${
                kind === k.id ? k.on : 'border-[rgb(var(--line))] text-muted'
              }`}
            >
              {k.label}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <label className="flex w-28 flex-none flex-col gap-1">
            <span className="text-xs font-semibold text-muted">العملة</span>
            <select
              value={currency}
              onChange={(e) => edit(() => setCurrency(e.target.value))}
              className={input}
            >
              {currencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs font-semibold text-muted">المبلغ</span>
            <input
              inputMode="decimal"
              dir="ltr"
              value={text}
              onChange={(e) => edit(() => setText(e.target.value))}
              placeholder="100"
              className={`${input} tnum text-start`}
            />
          </label>
        </div>
        {text.trim() !== '' && value === null && (
          <p className="text-xs text-bad">اكتب رقمًا فقط، مثل 100 أو 2.5</p>
        )}
        {short && (
          <p className="text-xs text-bad">الرصيد لا يكفي: المتاح {moneyIn(current, currency)} فقط.</p>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">السبب</span>
          <input
            value={reason}
            maxLength={MAX_REASON}
            required
            onChange={(e) => edit(() => setReason(e.target.value))}
            placeholder="سبب التعديل، مثل: تعويض عن تأخير"
            className={input}
          />
        </label>

        {!confirming && (
          <button
            type="submit"
            disabled={busy || !ready}
            className="min-h-11 rounded-xl bg-teal py-2.5 text-sm font-bold text-white transition hover:bg-teal-deep disabled:opacity-50"
          >
            متابعة
          </button>
        )}
      </form>

      {confirming && value !== null && after !== null && (
        <div className="rounded-xl border border-warn/30 bg-warn/10 p-3 text-sm text-warn">
          <p className="font-semibold">
            {kind === 'add'
              ? `ستضيف ${moneyIn(value, currency)} إلى رصيد ${c.fullName}.`
              : `ستخصم ${moneyIn(value, currency)} من رصيد ${c.fullName}.`}{' '}
            الرصيد بعدها: <span className="tnum">{moneyIn(after, currency)}</span>
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={send}
              disabled={busy}
              className="min-h-11 flex-1 rounded-xl bg-teal px-4 text-sm font-bold text-white transition hover:bg-teal-deep disabled:opacity-50"
            >
              {busy ? 'جارٍ الحفظ…' : 'تأكيد'}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={busy}
              className="min-h-11 flex-1 rounded-xl border border-[rgb(var(--line))] px-4 text-sm font-bold text-muted disabled:opacity-50"
            >
              تراجع
            </button>
          </div>
        </div>
      )}

      {msg && <Notice text={msg.text} tone={msg.ok ? 'ok' : 'bad'} />}
    </section>
  );
}

/** Every move in the wallet, newest first (the API sends the last 30). */
function Ledger({ rows }: { rows: LedgerRow[] }) {
  return (
    <section className="surface overflow-hidden rounded-2xl shadow-card">
      <h2 className="px-5 py-4 text-base font-bold">سجل الحركات</h2>
      {rows.length === 0 && <p className="px-5 pb-5 text-sm text-muted">لا توجد حركات بعد.</p>}
      <div className="flex flex-col divide-y divide-[rgb(var(--line))] border-t hairline">
        {rows.map((l) => {
          const v = parseFloat(l.amount);
          const order = l.referenceType === 'order' && l.referenceId ? l.referenceId : null;
          const body = (
            <>
              <span className="min-w-0">
                <span className="block font-semibold">{LEDGER_TYPE[l.type] ?? l.type}</span>
                {l.description && <span className="block text-xs text-muted">{describe(l.description)}</span>}
                <span className="block text-xs text-muted">
                  {dateTime(l.createdAt)}
                  {l.by ? ` · بواسطة ${l.by}` : ''}
                  {order && <span className="font-semibold text-teal"> · عرض الطلب</span>}
                </span>
              </span>
              <span className="flex flex-col items-end">
                <span
                  className={`tnum whitespace-nowrap font-bold ${v < 0 ? 'text-bad' : 'text-ok'}`}
                  dir="ltr"
                >
                  {v < 0 ? '−' : '+'}
                  {moneyIn(Math.abs(v), l.currency)}
                </span>
                <span className="tnum whitespace-nowrap text-xs text-muted">
                  الرصيد {moneyIn(l.balanceAfter, l.currency)}
                </span>
              </span>
            </>
          );
          const cls = 'flex items-start justify-between gap-3 px-5 py-3 text-sm';
          return order ? (
            <Link key={l.id} href={`/orders/${order}`} className={`${cls} hover:bg-[rgb(var(--surface-2))]`}>
              {body}
            </Link>
          ) : (
            <div key={l.id} className={cls}>
              {body}
            </div>
          );
        })}
      </div>
    </section>
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
