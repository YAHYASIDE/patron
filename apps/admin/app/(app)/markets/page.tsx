'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { rowsOf, useFetch } from '@/lib/hooks';
import { date, num } from '@/lib/format';
import { flagOf } from '@/lib/countries';
import Notice from '@/components/Notice';
import { Chip, Empty, Sheet, Skeleton } from '@/components/IntelBits';
import { createMarket, friendlyError, MARKETS_PATH, useStaffCan, type MarketRow, type NewCountry } from '@/lib/intelligence';
import { ApprovalExplainer } from './shared';

/**
 * The countries the shop serves or is studying. Research suggests payment
 * methods and product rules per country; the owner approves them here, and a
 * method reaches customers only once it is linked to a receiving account.
 */
export default function MarketsPage() {
  const list = useFetch<MarketRow[] | { data: MarketRow[] }>(MARKETS_PATH);
  const rows = [...rowsOf(list.data)].sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.nameAr.localeCompare(b.nameAr, 'ar'));
  const { can } = useStaffCan();
  const canManage = can('markets.manage');
  const [adding, setAdding] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold">الدول والأسواق</h1>
          <p className="mt-1 text-sm text-muted">
            لكل دولة عملتها ولغاتها ووسائل دفعها. البحث يقترح، وأنت تقرّر. لا يُفعَّل شيء تلقائيًا.
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => setAdding(true)}
            className="min-h-11 w-full rounded-xl bg-teal px-5 text-sm font-bold text-white transition hover:bg-teal-deep sm:w-auto"
          >
            + إضافة دولة
          </button>
        )}
      </div>

      <ApprovalExplainer />

      {list.error && <Notice text={list.error} />}
      {list.loading && !list.data && <Skeleton rows={3} h="h-28" />}
      {list.data && rows.length === 0 && (
        <Empty>لا دول بعد. {canManage ? 'أضف دولة لتبدأ البحث عن وسائل الدفع فيها.' : ''}</Empty>
      )}

      <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((c) => (
          <li key={c.code}>
            <CountryCard c={c} />
          </li>
        ))}
      </ul>

      {adding && (
        <AddCountry
          existing={rows.map((r) => r.code)}
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            list.reload();
          }}
        />
      )}
    </div>
  );
}

function CountryCard({ c }: { c: MarketRow }) {
  const m = c.methods ?? { pending: 0, approved: 0, active: 0, rejected: 0, deferred: 0 };
  const rulesPending = c.rules?.pending ?? 0;
  return (
    <Link
      href={`/markets/${encodeURIComponent(c.code)}`}
      className={`surface flex h-full flex-col gap-3 rounded-2xl p-4 shadow-card transition hover:border-teal/40 ${c.enabled ? '' : 'opacity-90'}`}
    >
      <div className="flex items-start gap-3">
        <span className="text-3xl leading-none" aria-hidden>
          {flagOf(c.code)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-bold">{c.nameAr}</span>
            <span className="text-xs text-muted" dir="ltr">
              {c.code}
            </span>
          </div>
          <div className="mt-0.5 text-xs text-muted">
            العملة <b dir="ltr">{c.currency}</b>
            {c.dialCode && (
              <>
                {' · '}
                <span dir="ltr">{c.dialCode}</span>
              </>
            )}
          </div>
        </div>
        {c.enabled ? <Chip label="مفعّلة" cls="bg-ok/12 text-ok" /> : <Chip label="متوقفة" cls="bg-ink-400/15 text-muted" />}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat n={m.pending} label="بانتظار المراجعة" tone={m.pending > 0 ? 'text-warn' : 'text-muted'} />
        <Stat n={m.approved} label="موافق عليها" tone="text-teal" />
        <Stat n={m.active} label="مربوطة بحساب" tone={m.active > 0 ? 'text-ok' : 'text-muted'} />
      </div>

      <div className="mt-auto flex flex-col gap-1.5 text-xs">
        {c.stale > 0 && (
          <p className="rounded-lg bg-warn/10 px-2.5 py-1.5 font-semibold text-warn">
            ⚠ {num(c.stale)} {c.stale === 1 ? 'معلومة تحتاج' : 'معلومات تحتاج'} إعادة تحقق
          </p>
        )}
        {/* what customers see comes from the receiving accounts (وسائل الدفع), not from this count:
            a country can sell through its accounts before any researched method is linked */}
        {c.enabled && m.active === 0 && (
          <p className="rounded-lg bg-warn/10 px-2.5 py-1.5 font-semibold text-warn">
            لم تُربط أي وسيلة مبحوثة بحساب استقبال بعد. ما يراه الزبائن تحدده صفحة وسائل الدفع.
          </p>
        )}
        <div className="flex flex-wrap gap-x-3 text-muted">
          {rulesPending > 0 && <span>{num(rulesPending)} قاعدة منتج بانتظار المراجعة</span>}
          <span>آخر بحث: {c.lastResearchedAt ? date(c.lastResearchedAt) : 'لم يُبحث بعد'}</span>
        </div>
      </div>
    </Link>
  );
}

function Stat({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className="surface-2 rounded-xl px-1.5 py-2">
      <div className={`tnum text-lg font-extrabold ${tone}`}>{num(n ?? 0)}</div>
      <div className="text-[10.5px] leading-tight text-muted">{label}</div>
    </div>
  );
}

const input =
  'surface-2 hairline min-h-11 w-full rounded-xl border px-3.5 text-[15px] outline-none transition focus:border-teal';

const listOf = (s: string, upper: boolean) =>
  [...new Set(s.split(/[\s,،]+/).map((x) => (upper ? x.toUpperCase() : x.toLowerCase())).filter(Boolean))];

/** A region name in one language from the browser (a starting point the owner can edit). */
function regionName(code: string, lang: string): string {
  try {
    const n = new Intl.DisplayNames([lang], { type: 'region' }).of(code);
    return n && n !== code ? n : '';
  } catch {
    return '';
  }
}

function AddCountry({
  existing,
  onClose,
  onCreated,
}: {
  existing: string[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const router = useRouter();
  const [f, setF] = useState({
    code: '',
    nameAr: '',
    nameFr: '',
    nameEn: '',
    currency: '',
    currencies: '',
    languages: 'ar, fr',
    dialCode: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof f>) => {
    setF((x) => ({ ...x, ...patch }));
    setError(null);
  };

  function setCode(raw: string) {
    const code = raw.replace(/[^a-z]/gi, '').slice(0, 2).toUpperCase();
    const patch: Partial<typeof f> = { code };
    // fill the three names from the browser once the code is complete, without overwriting what was typed
    if (code.length === 2) {
      if (!f.nameAr) patch.nameAr = regionName(code, 'ar');
      if (!f.nameFr) patch.nameFr = regionName(code, 'fr');
      if (!f.nameEn) patch.nameEn = regionName(code, 'en');
    }
    set(patch);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const currency = f.currency.trim().toUpperCase();
    const dial = '+' + f.dialCode.replace(/\D/g, '');
    if (!/^[A-Z]{2}$/.test(f.code)) return setError('رمز الدولة حرفان لاتينيان، مثل ML.');
    if (existing.includes(f.code)) return setError('هذه الدولة موجودة من قبل.');
    if (!f.nameAr.trim() || !f.nameFr.trim() || !f.nameEn.trim()) return setError('اكتب اسم الدولة باللغات الثلاث.');
    if (!/^[A-Z]{3}$/.test(currency)) return setError('العملة ثلاثة أحرف لاتينية، مثل XOF.');
    if (!/^\+\d{1,4}$/.test(dial)) return setError('رمز الاتصال أرقام فقط، مثل 223+.');
    const currencies = listOf(f.currencies, true);
    if (currencies.some((c) => !/^[A-Z]{3}$/.test(c))) return setError('العملات الأخرى: رموز من ثلاثة أحرف، مفصولة بفاصلة.');
    const languages = listOf(f.languages, false);
    if (languages.some((l) => !/^[a-z]{2,3}$/.test(l))) return setError('اللغات: رموز مثل ar, fr, en مفصولة بفاصلة.');

    const body: NewCountry = {
      code: f.code,
      nameAr: f.nameAr.trim(),
      nameFr: f.nameFr.trim(),
      nameEn: f.nameEn.trim(),
      currency,
      currencies: [...new Set([currency, ...currencies])],
      languages,
      dialCode: dial,
    };
    setBusy(true);
    setError(null);
    try {
      await createMarket(body);
      onCreated();
      router.push(`/markets/${body.code}`);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  return (
    <Sheet title="إضافة دولة" onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-3.5">
        <p className="rounded-xl bg-teal/10 px-3 py-2 text-xs font-semibold text-teal">
          تُضاف الدولة <b>متوقفة</b>: لا يراها الزبائن حتى تفعّلها، ويبدأ البحث عن وسائل الدفع فيها لتراجعها.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="رمز الدولة (ISO)">
            <input
              className={input + ' uppercase'}
              dir="ltr"
              value={f.code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="ML"
              autoCapitalize="characters"
              autoComplete="off"
              required
            />
          </Field>
          <Field label="رمز الاتصال">
            <input
              className={input}
              dir="ltr"
              inputMode="tel"
              value={f.dialCode}
              onChange={(e) => set({ dialCode: e.target.value })}
              placeholder="+223"
              required
            />
          </Field>
        </div>
        <Field label="الاسم بالعربية">
          <input className={input} value={f.nameAr} maxLength={80} onChange={(e) => set({ nameAr: e.target.value })} required />
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="الاسم بالفرنسية">
            <input className={input} dir="ltr" value={f.nameFr} maxLength={80} onChange={(e) => set({ nameFr: e.target.value })} required />
          </Field>
          <Field label="الاسم بالإنجليزية">
            <input className={input} dir="ltr" value={f.nameEn} maxLength={80} onChange={(e) => set({ nameEn: e.target.value })} required />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="العملة الأساسية">
            <input
              className={input + ' uppercase'}
              dir="ltr"
              value={f.currency}
              maxLength={3}
              onChange={(e) => set({ currency: e.target.value.replace(/[^a-z]/gi, '').toUpperCase() })}
              placeholder="XOF"
              required
            />
          </Field>
          <Field label="عملات أخرى (اختياري)">
            <input className={input} dir="ltr" value={f.currencies} onChange={(e) => set({ currencies: e.target.value })} placeholder="USD, EUR" />
          </Field>
        </div>
        <Field label="اللغات">
          <input className={input} dir="ltr" value={f.languages} onChange={(e) => set({ languages: e.target.value })} placeholder="ar, fr" />
        </Field>
        {error && <Notice text={error} />}
        <button
          type="submit"
          disabled={busy}
          className="min-h-11 rounded-xl bg-teal px-5 text-sm font-bold text-white transition hover:bg-teal-deep disabled:opacity-60"
        >
          {busy ? 'جارٍ الإضافة…' : 'إضافة الدولة (متوقفة)'}
        </button>
      </form>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-xs font-semibold text-muted">{label}</span>
      {children}
    </label>
  );
}
