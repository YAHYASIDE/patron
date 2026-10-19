'use client';

import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { dateTime, num } from '@/lib/format';
import Notice from '@/components/Notice';

type Rate = {
  code: string;
  nameAr: string;
  symbol: string;
  decimals: number;
  rate: string | null;
  source: string | null;
  effectiveAt: string | null;
  stale: boolean;
};
type HistoryRow = { id: string; rate: string; source: string; isActive: boolean; effectiveAt: string };

const FLAG: Record<string, string> = { MRU: '🇲🇷', XOF: '🇲🇱', DZD: '🇩🇿', EUR: '🇪🇺' };
const UNIT: Record<string, string> = { MRU: 'أوقية', XOF: 'فرنك', DZD: 'دينار', EUR: 'يورو' };
const SOURCE: Record<string, string> = { MANUAL: 'أنت', FEED: 'تلقائي' };
// an example price, so the owner sees what a rate means for a product
const EXAMPLE_USD = 10;

/** Read a rate the way people type it: "39,8" and "39.8" are the same; Arabic digits too. */
function parseRate(text: string): number | null {
  const latin = text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(',', '.').trim();
  if (!/^\d+(\.\d{1,6})?$/.test(latin)) return null;
  const n = Number(latin);
  return n > 0 && n <= 1_000_000 ? n : null;
}

/**
 * Exchange rates: how much of each country's currency one dollar buys. The
 * owner sets them by hand (there is no automatic feed); products with a fixed
 * local price do not follow them, every other price does.
 */
export default function CurrenciesPage() {
  const { data, error, loading, reload } = useFetch<Rate[]>('/admin/fx');
  // the shop's own markets first, in the order the owner thinks of them
  const ORDER = ['MRU', 'XOF', 'DZD', 'EUR'];
  const rank = (code: string) => (ORDER.includes(code) ? ORDER.indexOf(code) : ORDER.length);
  const list = (Array.isArray(data) ? data : []).slice().sort((a, b) => rank(a.code) - rank(b.code));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">أسعار الصرف</h1>
        <p className="mt-1 text-sm text-muted">
          كم يساوي الدولار الواحد بعملة كل بلد. تتغيّر أسعار المنتجات بالعملات المحلية معه، إلا المنتجات التي
          وضعت لها سعرًا ثابتًا.
        </p>
      </div>

      {error && <Notice text={`تعذّر جلب أسعار الصرف: ${error}`} />}
      {loading && !data && <p className="text-sm text-muted">جارٍ التحميل…</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {list.map((c) => (
          <RateCard key={c.code} c={c} onSaved={reload} />
        ))}
      </div>

      {data && list.length === 0 && <Notice tone="muted" text="لا توجد عملات غير الدولار مفعّلة في المتجر." />}
    </div>
  );
}

function RateCard({ c, onSaved }: { c: Rate; onSaved: () => void }) {
  const unit = UNIT[c.code] ?? c.symbol;
  const current = c.rate ? Number(c.rate) : null;
  const [text, setText] = useState(c.rate ? String(Number(c.rate)) : '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // a fresh list from the server (after a save) resets the field
  useEffect(() => {
    setText(c.rate ? String(Number(c.rate)) : '');
  }, [c.rate]);

  const value = parseRate(text);
  const change = value && current ? ((value - current) / current) * 100 : null;
  const big = change !== null && Math.abs(change) > 15;
  const unchanged = value !== null && current !== null && value === current;

  async function save(confirm: boolean) {
    if (value === null) return setMsg({ tone: 'bad', text: 'اكتب رقمًا صحيحًا أكبر من صفر، مثل 39.8' });
    setBusy(true);
    setMsg(null);
    try {
      await api.post(`/admin/fx/${c.code}`, { rate: value, ...(confirm && { confirm: true }) });
      setConfirming(false);
      setMsg({ tone: 'ok', text: 'تم الحفظ. الأسعار في المتجر تتبع السعر الجديد الآن.' });
      onSaved();
    } catch (e) {
      // the server asks before a move of more than 15%
      if (e instanceof ApiError && e.status === 409) {
        setConfirming(true);
      } else {
        setMsg({ tone: 'bad', text: e instanceof Error ? e.message : 'تعذّر الحفظ.' });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="surface flex flex-col gap-3 rounded-2xl p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold">
            <span aria-hidden>{FLAG[c.code] ?? '🌍'}</span> {c.nameAr}{' '}
            <span className="tnum text-xs font-semibold text-muted" dir="ltr">
              {c.code}
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            {c.effectiveAt
              ? `آخر تحديث ${dateTime(c.effectiveAt)}${c.source ? ` · ${SOURCE[c.source] ?? c.source}` : ''}`
              : 'لم يُحدَّد سعر بعد'}
          </p>
        </div>
        {c.stale && (
          <span className="flex-none rounded-full bg-warn/15 px-2.5 py-1 text-xs font-bold text-warn">قديم</span>
        )}
      </div>

      <div className="rounded-xl bg-[rgb(var(--surface-2))] px-4 py-3">
        <div className="text-xs text-muted">السعر الحالي</div>
        <div className="tnum mt-0.5 text-xl font-extrabold" dir="ltr">
          1 $ = {current !== null ? num(current, current >= 100 ? 0 : 2) : '—'} {unit}
        </div>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          save(false);
        }}
        className="flex flex-col gap-2"
      >
        <label className="text-sm font-semibold" htmlFor={`rate-${c.code}`}>
          السعر الجديد (كم {unit} مقابل 1 $)
        </label>
        <div className="flex gap-2">
          <input
            id={`rate-${c.code}`}
            inputMode="decimal"
            dir="ltr"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setMsg(null);
              setConfirming(false);
            }}
            className="surface-2 hairline tnum w-full min-w-0 rounded-xl border px-3 py-2.5 text-start text-base outline-none focus:border-teal"
            placeholder="39.8"
          />
          <button
            type="submit"
            disabled={busy || value === null || unchanged}
            className="btn-brand flex-none rounded-xl px-5 py-2.5 text-sm font-bold disabled:opacity-50"
          >
            {busy ? 'جارٍ…' : 'حفظ'}
          </button>
        </div>

        {value !== null && !unchanged && (
          <p className="text-xs text-muted">
            منتج بـ {EXAMPLE_USD} $ سيكلّف الزبون{' '}
            <b className="tnum text-[rgb(var(--text))]">
              {num(EXAMPLE_USD * value, value >= 10 ? 0 : 2)} {unit}
            </b>
            {change !== null && (
              <span className={big ? ' font-bold text-warn' : ''}>
                {' '}
                ({change > 0 ? '+' : ''}
                {num(change, 1)}% عن الحالي)
              </span>
            )}
          </p>
        )}
        {text.trim() !== '' && value === null && (
          <p className="text-xs text-bad">اكتب رقمًا فقط، مثل 39.8</p>
        )}
      </form>

      {confirming && change !== null && (
        <div className="rounded-xl border border-warn/30 bg-warn/10 p-3 text-sm text-warn">
          <p className="font-semibold">
            هذا تغيير كبير ({change > 0 ? '+' : ''}
            {num(change, 1)}%). ستتغيّر أسعار المنتجات بالعملة المحلية بنفس النسبة. هل أنت متأكد؟
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => save(true)}
              disabled={busy}
              className="rounded-lg bg-warn px-4 py-2 text-sm font-bold text-white disabled:opacity-60"
            >
              نعم، طبّق السعر
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-[rgb(var(--line))] px-4 py-2 text-sm font-bold text-muted"
            >
              تراجع
            </button>
          </div>
        </div>
      )}

      {msg && <Notice tone={msg.tone} text={msg.text} />}

      <button
        type="button"
        onClick={() => setShowHistory((v) => !v)}
        className="self-start text-xs font-semibold text-teal hover:underline"
      >
        {showHistory ? 'إخفاء السجل' : 'سجل التغييرات'}
      </button>
      {showHistory && <History code={c.code} unit={unit} />}
    </div>
  );
}

function History({ code, unit }: { code: string; unit: string }) {
  const { data, error, loading } = useFetch<HistoryRow[]>(`/admin/fx/${code}`);
  if (loading) return <p className="text-xs text-muted">جارٍ التحميل…</p>;
  if (error) return <Notice text={error} />;
  const rows = (data ?? []).slice(0, 8);
  if (!rows.length) return <p className="text-xs text-muted">لا يوجد سجل بعد.</p>;
  return (
    <ul className="divide-y divide-[rgb(var(--line))] text-xs">
      {rows.map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-2 py-1.5">
          <span className="tnum font-semibold" dir="ltr">
            1 $ = {num(Number(r.rate), Number(r.rate) >= 100 ? 0 : 2)} {unit}
          </span>
          <span className="text-muted">
            {dateTime(r.effectiveAt)} · {SOURCE[r.source] ?? r.source}
            {!r.isActive && ' · متوقف'}
          </span>
        </li>
      ))}
    </ul>
  );
}
