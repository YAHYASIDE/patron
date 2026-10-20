'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import { useFetch } from '@/lib/hooks';
import { date, num } from '@/lib/format';
import { flagOf } from '@/lib/countries';
import Notice from '@/components/Notice';
import { Chip, ConfirmDialog, Confidence, Empty, LastVerified, Skeleton, SourceList } from '@/components/IntelBits';
import {
  AVAILABILITY,
  decideMethod,
  decideRule,
  friendlyError,
  isStale,
  linkMethodAccount,
  MARKET_STATUS,
  MARKET_STATUS_ORDER,
  marketPath,
  METHOD_KIND,
  RULE_SCOPE,
  setMarketEnabled,
  useStaffCan,
  type MarketAccount,
  type MarketCountry,
  type MarketDetail,
  type MarketMethod,
  type MarketRule,
  type MarketStatus,
} from '@/lib/intelligence';
import { ApprovalExplainer, DecisionBar } from '../shared';

const GROUP_TITLE: Record<MarketStatus, string> = {
  PENDING_REVIEW: 'بانتظار المراجعة',
  APPROVED: 'موافق عليها — لا تظهر للزبائن بعد',
  ACTIVE: 'ظاهرة للزبائن',
  DEFERRED: 'مؤجلة',
  REJECTED: 'مرفوضة',
};

/** One country: whether customers see it, its researched payment methods and product rules. */
export default function CountryPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const { data, error, loading, reload } = useFetch<MarketDetail>(marketPath(code.toUpperCase()));
  const { can } = useStaffCan();
  const canManage = can('markets.manage');
  const c = data?.country;

  return (
    <div className="flex flex-col gap-5">
      <Link href="/markets" className="text-sm font-bold text-muted hover:text-teal">
        → كل الدول
      </Link>

      {error && <Notice text={error} />}
      {loading && !data && <Skeleton rows={3} h="h-28" />}

      {c && (
        <>
          <Header c={c} canManage={canManage} onChanged={reload} />
          <ApprovalExplainer />
          <Methods
            methods={data?.methods ?? []}
            accounts={data?.accounts ?? []}
            country={c}
            canManage={canManage}
            onChanged={reload}
          />
          <Rules rules={data?.rules ?? []} canManage={canManage} onChanged={reload} />
        </>
      )}
    </div>
  );
}

function Header({ c, canManage, onChanged }: { c: MarketCountry; canManage: boolean; onChanged: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      await setMarketEnabled(c.code, !c.enabled);
      setAsking(false);
      onChanged();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface flex flex-col gap-4 rounded-2xl p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-start gap-3">
        <span className="text-4xl leading-none" aria-hidden>
          {flagOf(c.code)}
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-extrabold">{c.nameAr}</h1>
          <p className="text-xs text-muted" dir="ltr">
            {c.code} · {c.nameFr} · {c.nameEn}
          </p>
        </div>
        <div className="flex w-full items-center justify-between gap-3 sm:w-auto sm:flex-col sm:items-end">
          {c.enabled ? (
            <Chip label="مفعّلة: تظهر في المتجر" cls="bg-ok/12 text-ok" />
          ) : (
            <Chip label="متوقفة: لا تظهر في المتجر" cls="bg-ink-400/15 text-muted" />
          )}
          {canManage && (
            <button
              role="switch"
              aria-checked={c.enabled}
              onClick={() => {
                setError(null);
                setAsking(true);
              }}
              className={
                'min-h-10 rounded-xl px-4 text-sm font-bold transition ' +
                (c.enabled ? 'border border-[rgb(var(--line))] hover:border-bad hover:text-bad' : 'bg-teal text-white hover:bg-teal-deep')
              }
            >
              {c.enabled ? 'إيقاف الدولة' : 'تفعيل الدولة'}
            </button>
          )}
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Fact k="العملة الأساسية" v={c.currency} ltr />
        <Fact k="العملات المقبولة" v={c.currencies?.length ? c.currencies.join(', ') : c.currency} ltr />
        <Fact k="اللغات" v={c.languages?.length ? c.languages.join(', ') : '—'} ltr />
        <Fact k="رمز الاتصال" v={c.dialCode} ltr />
        <Fact k="آخر بحث" v={c.lastResearchedAt ? date(c.lastResearchedAt) : 'لم يُبحث بعد'} />
      </dl>
      {c.notes && (
        <p dir="auto" className="surface-2 whitespace-pre-line rounded-xl px-3 py-2 text-sm">
          {c.notes}
        </p>
      )}

      {asking && (
        <ConfirmDialog
          title={c.enabled ? `إيقاف ${c.nameAr}؟` : `تفعيل ${c.nameAr}؟`}
          body={
            c.enabled ? (
              <>تختفي {c.nameAr} من قائمة الدول في المتجر. الطلبات السابقة لا تتأثر.</>
            ) : (
              <>
                تظهر {c.nameAr} في قائمة الدول في المتجر بعملتها ({c.currency}) ولغاتها. وسائل الدفع لا تظهر إلا
                المربوطة بحساب استقبال.
              </>
            )
          }
          confirmLabel={c.enabled ? 'نعم، إيقاف' : 'نعم، تفعيل'}
          tone={c.enabled ? 'bad' : 'teal'}
          busy={busy}
          error={error}
          onConfirm={toggle}
          onCancel={() => setAsking(false)}
        />
      )}
    </section>
  );
}

function Methods({
  methods,
  accounts,
  country,
  canManage,
  onChanged,
}: {
  methods: MarketMethod[];
  accounts: MarketAccount[];
  country: MarketCountry;
  canManage: boolean;
  onChanged: () => void;
}) {
  const groups = MARKET_STATUS_ORDER.map((s) => ({ s, rows: methods.filter((m) => m.status === s) })).filter((g) => g.rows.length);
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-bold">وسائل الدفع</h2>
        <p className="text-xs text-muted">ما وجده البحث في {country.nameAr}، مع مصادره ودرجة الثقة فيه.</p>
      </div>
      {groups.length === 0 && <Empty>لم يجد البحث وسائل دفع لهذه الدولة بعد.</Empty>}
      {groups.map((g) => (
        <div key={g.s} className="flex flex-col gap-2.5">
          <h3 className="flex items-center gap-2 text-sm font-bold">
            {GROUP_TITLE[g.s]}
            <span className="tnum surface-2 rounded-full px-2 text-xs text-muted">{g.rows.length}</span>
          </h3>
          <ul className="grid gap-3 lg:grid-cols-2">
            {g.rows.map((m) => (
              <li key={m.id}>
                <MethodCard m={m} accounts={accounts} country={country} canManage={canManage} onChanged={onChanged} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function MethodCard({
  m,
  accounts,
  country,
  canManage,
  onChanged,
}: {
  m: MarketMethod;
  accounts: MarketAccount[];
  country: MarketCountry;
  canManage: boolean;
  onChanged: () => void;
}) {
  const st = MARKET_STATUS[m.status] ?? { label: m.status, cls: 'bg-ink-400/15 text-muted' };
  const linked = m.accountId ? accounts.find((a) => a.id === m.accountId) : undefined;
  return (
    <article className={`surface flex h-full flex-col gap-3 rounded-2xl p-4 shadow-card ${isStale(m.lastVerifiedAt) ? 'border-warn/40' : ''}`}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div dir="auto" className="font-bold">
            {m.name}
          </div>
          <div className="text-xs text-muted">
            {METHOD_KIND[m.kind] ?? m.kind}
            {m.provider && (
              <>
                {' · '}
                <span dir="auto">{m.provider}</span>
              </>
            )}
          </div>
        </div>
        <Chip label={st.label} cls={st.cls} />
      </div>

      <dl className="grid grid-cols-2 gap-3 text-sm">
        <Fact k="العملة" v={m.currency ?? '—'} ltr />
        <div className="min-w-0">
          <dt className="text-[11px] text-muted">الثقة</dt>
          <dd>
            <Confidence value={m.confidence} />
          </dd>
        </div>
        <div className="col-span-2 min-w-0">
          <dt className="text-[11px] text-muted">الرسوم (كما يذكرها المصدر)</dt>
          <dd dir="auto" className="break-words font-semibold">
            {m.fees || 'غير مذكورة'}
          </dd>
        </div>
      </dl>

      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] text-muted">المصادر</span>
        <SourceList sources={m.sources} />
      </div>

      <LastVerified at={m.lastVerifiedAt} by={m.verifiedBy} />

      {m.decisionNote && (
        <p dir="auto" className="text-xs text-muted">
          ملاحظة القرار: {m.decisionNote}
        </p>
      )}

      {m.status === 'APPROVED' && <p className="text-xs font-semibold text-teal">{MARKET_STATUS.APPROVED.hint}</p>}
      {m.status === 'ACTIVE' && (
        <p className="rounded-xl bg-ok/10 px-3 py-2 text-xs font-semibold text-ok">
          مربوطة بحساب الاستقبال «{linked?.method ?? 'حساب'}»
          {linked && !linked.usable && ' — تنبيه: هذا الحساب لم يعد صالحًا (متوقف أو بلا رقم).'}
        </p>
      )}

      {canManage && (
        <div className="mt-auto flex flex-col gap-3 border-t border-[rgb(var(--line))] pt-3">
          {m.status === 'APPROVED' && <LinkAccount m={m} accounts={accounts} country={country} onChanged={onChanged} />}
          <DecisionBar status={m.status} what={m.name} onDecide={(a, note) => decideMethod(m.id, a, note)} onDone={onChanged} />
        </div>
      )}
    </article>
  );
}

/** «ربط بحساب استقبال»: only the owner's usable accounts that already serve this country. */
function LinkAccount({
  m,
  accounts,
  country,
  onChanged,
}: {
  m: MarketMethod;
  accounts: MarketAccount[];
  country: MarketCountry;
  onChanged: () => void;
}) {
  const usable = accounts.filter((a) => a.usable);
  // one choice: preselect it
  const [accountId, setAccountId] = useState(usable.length === 1 ? usable[0].id : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (usable.length === 0) {
    const unusable = accounts.length > 0;
    return (
      <div className="rounded-xl border border-warn/30 bg-warn/10 px-3 py-2.5 text-xs text-warn">
        <p className="font-bold">لا يوجد حساب استقبال صالح يخدم {country.nameAr}.</p>
        <p className="mt-1">
          {unusable
            ? 'توجد حسابات لهذه الدولة لكنها متوقفة أو بلا رقم. '
            : `لكي تظهر «${m.name}» للزبائن، أضف أولًا حساب استقبال لـ${country.nameAr} برقمك وفعّله. `}
          <Link href="/payment-methods" className="font-bold underline">
            افتح وسائل الدفع
          </Link>
          ، ثم ارجع هنا واربطها.
        </p>
      </div>
    );
  }

  async function link() {
    if (!accountId) return;
    setBusy(true);
    setError(null);
    try {
      await linkMethodAccount(m.id, accountId);
      onChanged();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="text-xs font-bold" htmlFor={`link-${m.id}`}>
        ربط بحساب استقبال
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <select
          id={`link-${m.id}`}
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          className="surface-2 hairline min-h-10 min-w-0 flex-1 rounded-xl border px-3 text-sm outline-none focus:border-teal"
        >
          <option value="">اختر حسابًا…</option>
          {usable.map((a) => (
            <option key={a.id} value={a.id}>
              {a.method}
            </option>
          ))}
        </select>
        <button
          onClick={link}
          disabled={busy || !accountId}
          className="min-h-10 rounded-xl bg-ok px-4 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'جارٍ…' : 'ربط وإظهارها للزبائن'}
        </button>
      </div>
      <p className="text-[11px] text-muted">الربط لا يعدّل الحساب نفسه؛ يجعل هذه الوسيلة ظاهرة لزبائن هذه الدولة.</p>
      {error && <Notice text={error} />}
    </div>
  );
}

function Rules({ rules, canManage, onChanged }: { rules: MarketRule[]; canManage: boolean; onChanged: () => void }) {
  const sorted = [...rules].sort(
    (a, b) => MARKET_STATUS_ORDER.indexOf(a.status) - MARKET_STATUS_ORDER.indexOf(b.status) || a.ref.localeCompare(b.ref),
  );
  const pending = rules.filter((r) => r.status === 'PENDING_REVIEW').length;
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-bold">توفّر المنتجات</h2>
        <p className="text-xs text-muted">
          هل يعمل منتج أو لعبة أو تصنيف في هذه الدولة (مثل بطاقات مقفلة على منطقة). بعد الموافقة يرى الزبون تنبيهًا في
          المتجر.
          {pending > 0 && <b className="text-warn"> {num(pending)} بانتظار المراجعة.</b>}
        </p>
      </div>
      {sorted.length === 0 && <Empty>لا قواعد توفّر لهذه الدولة بعد.</Empty>}
      <ul className="grid gap-3 lg:grid-cols-2">
        {sorted.map((r) => {
          const st = MARKET_STATUS[r.status] ?? { label: r.status, cls: 'bg-ink-400/15 text-muted' };
          const av = AVAILABILITY[r.availability] ?? AVAILABILITY.UNKNOWN;
          return (
            <li key={r.id}>
              <article className="surface flex h-full flex-col gap-3 rounded-2xl p-4 shadow-card">
                <div className="flex flex-wrap items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-muted">{RULE_SCOPE[r.scope] ?? r.scope}</div>
                    <code dir="ltr" className="break-all text-sm font-bold">
                      {r.ref}
                    </code>
                  </div>
                  <Chip label={st.label} cls={st.cls} />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <Chip label={av.label} cls={av.cls} />
                  <Confidence value={r.confidence} />
                </div>
                {r.note && (
                  <p dir="auto" className="break-words text-sm">
                    {r.note}
                  </p>
                )}
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11px] text-muted">المصادر</span>
                  <SourceList sources={r.sources} />
                </div>
                <LastVerified at={r.lastVerifiedAt} by={r.verifiedBy} />
                {canManage && (
                  <div className="mt-auto border-t border-[rgb(var(--line))] pt-3">
                    <DecisionBar status={r.status} what={r.ref} onDecide={(a, note) => decideRule(r.id, a, note)} onDone={onChanged} />
                  </div>
                )}
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Fact({ k, v, ltr }: { k: string; v: string; ltr?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] text-muted">{k}</dt>
      <dd className="truncate font-semibold">{ltr ? <span dir="ltr">{v}</span> : v}</dd>
    </div>
  );
}
