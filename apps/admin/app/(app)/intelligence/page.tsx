'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useFetch } from '@/lib/hooks';
import { dateTime, num } from '@/lib/format';
import Notice from '@/components/Notice';
import { Chip, Confidence, Empty, Skeleton, VerifiedBadge } from '@/components/IntelBits';
import {
  agentName,
  ago,
  DISCOVERY_STATUS,
  friendlyError,
  getDiscoveries,
  KIND,
  RUN_STATUS,
  scanNow,
  SEVERITY,
  SUMMARY_PATH,
  TABS,
  useStaffCan,
  type Discovery,
  type IntelSummary,
  type Tab,
} from '@/lib/intelligence';
import DiscoveryPanel from './DiscoveryPanel';
import { AgentsSection, DecisionLog } from './sections';

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">جارٍ التحميل…</p>}>
      <IntelligenceCenter />
    </Suspense>
  );
}

const COUNT_CARDS: { key: keyof IntelSummary['counts']; tab: Tab; label: string; tone: string }[] = [
  { key: 'new', tab: 'new', label: 'اكتشافات جديدة', tone: 'text-teal' },
  { key: 'critical', tab: 'critical', label: 'مشكلات حرجة', tone: 'text-bad' },
  { key: 'opportunities', tab: 'opportunities', label: 'فرص', tone: 'text-gold-deep' },
  { key: 'pending', tab: 'pending', label: 'بانتظار المراجعة', tone: 'text-warn' },
  { key: 'done', tab: 'done', label: 'مكتملة', tone: 'text-ok' },
  { key: 'deferred', tab: 'deferred', label: 'مؤجلة', tone: 'text-muted' },
];

const isTab = (v: string | null): v is Tab => !!v && TABS.some((t) => t.key === v);

/**
 * The intelligence and development center: what the scanners, the agents and
 * CI found, sorted into tabs, with the owner's decision on each. Nothing is
 * changed in the shop from here: a decision is a record that people act on.
 */
function IntelligenceCenter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab: Tab = isTab(params.get('tab')) ? (params.get('tab') as Tab) : 'new';
  const openId = params.get('d');

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (value) next.set(key, value);
      else next.delete(key);
      const s = next.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const summary = useFetch<IntelSummary>(SUMMARY_PATH);
  const { can } = useStaffCan();
  const canDecide = can('intelligence.decide');
  const [logKey, setLogKey] = useState(0);
  const [listKey, setListKey] = useState(0);

  const reloadSummary = summary.reload;
  const changed = useCallback(() => {
    reloadSummary();
    setListKey((k) => k + 1);
    setLogKey((k) => k + 1);
  }, [reloadSummary]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold">مركز الذكاء والتطوير</h1>
          <p className="mt-1 text-sm text-muted">
            ما وجده الفحص والوكلاء والاختبارات: أخطاء، مخاطر، منتجات غير جاهزة، وفرص. لا يتغيّر شيء في المتجر دون
            قرارك.
          </p>
        </div>
        {canDecide && <ScanButton onDone={changed} />}
      </div>

      <p className="flex items-center gap-2 text-xs text-muted">
        <span aria-hidden>🔒</span>
        التقارير لا تحتوي أبدًا على مفاتيح أو كلمات مرور أو رموز تحقق أو بيانات الزبائن.
      </p>

      {summary.error && <Notice text={summary.error} />}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {COUNT_CARDS.map((c) => (
          <button
            key={c.key}
            onClick={() => setParam('tab', c.tab)}
            aria-pressed={tab === c.tab}
            className={
              'surface flex min-h-[84px] flex-col items-start justify-between rounded-2xl p-3.5 text-start shadow-card transition hover:border-teal/40 ' +
              (tab === c.tab ? 'ring-2 ring-teal/40' : '')
            }
          >
            <span className="text-xs font-semibold text-muted">{c.label}</span>
            <span className={`tnum text-2xl font-extrabold ${c.tone}`}>
              {summary.data ? num(summary.data.counts?.[c.key] ?? 0) : summary.loading ? '…' : '—'}
            </span>
          </button>
        ))}
      </div>

      <LastTests summary={summary.data} loading={summary.loading} />

      <section className="flex flex-col gap-3">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="tablist" aria-label="الاكتشافات">
          {TABS.map((t) => {
            const n = t.count && summary.data ? summary.data.counts?.[t.count] : undefined;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setParam('tab', t.key)}
                className={
                  'flex min-h-10 flex-none items-center gap-1.5 rounded-full px-3.5 text-xs font-bold transition ' +
                  (tab === t.key ? 'bg-teal text-white' : 'surface-2 text-muted hover:text-[rgb(var(--text))]')
                }
              >
                {t.label}
                {n !== undefined && (
                  <span className={`tnum rounded-full px-1.5 ${tab === t.key ? 'bg-white/20' : 'surface'}`}>{n}</span>
                )}
              </button>
            );
          })}
        </div>
        {tab === 'pending' && (
          <p className="text-xs text-muted">
            اقتراحات وسائل الدفع وتوفّر المنتجات لكل دولة تُراجع في{' '}
            <Link href="/markets" className="font-bold text-teal hover:underline">
              الدول والأسواق
            </Link>
            .
          </p>
        )}
        <DiscoveryList key={`${tab}-${listKey}`} tab={tab} onOpen={(id) => setParam('d', id)} />
      </section>

      <AgentsSection summary={summary.data} loading={summary.loading} error={summary.error} />

      <DecisionLog reloadKey={logKey} onOpen={(id) => setParam('d', id)} />

      {openId && (
        <DiscoveryPanel id={openId} canDecide={canDecide} onClose={() => setParam('d', null)} onChanged={changed} />
      )}
    </div>
  );
}

function ScanButton({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await scanNow();
      setMsg({
        text: `انتهى الفحص: ${num(r.created ?? 0)} جديد، ${num(r.updated ?? 0)} محدَّث.`,
        tone: 'ok',
      });
      onDone();
    } catch (e) {
      setMsg({ text: friendlyError(e), tone: 'bad' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
      <button
        onClick={run}
        disabled={busy}
        className="min-h-11 rounded-xl bg-teal px-5 text-sm font-bold text-white transition hover:bg-teal-deep disabled:opacity-60"
      >
        {busy ? 'جارٍ الفحص…' : 'افحص الآن'}
      </button>
      {msg && <Notice text={msg.text} tone={msg.tone} />}
    </div>
  );
}

function LastTests({ summary, loading }: { summary: IntelSummary | null; loading: boolean }) {
  const run = summary?.tests?.last ?? null;
  const st = run ? (RUN_STATUS[run.status] ?? { label: run.status, cls: 'bg-ink-400/15 text-muted' }) : null;
  const failed = (run?.testsFailed ?? 0) > 0;
  return (
    <section className="surface flex flex-col gap-3 rounded-2xl p-4 shadow-card sm:flex-row sm:items-center sm:p-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-bold">آخر اختبارات</h2>
          {st && <Chip label={st.label} cls={st.cls} />}
        </div>
        {run ? (
          <p className="mt-1 text-xs text-muted">
            {agentName(run.agent)} · {ago(run.finishedAt ?? run.startedAt)}
            {run.branch && (
              <>
                {' · '}
                <span dir="ltr">{run.branch}</span>
              </>
            )}
            {run.commit && (
              <>
                {' · '}
                <span dir="ltr">{run.commit.slice(0, 7)}</span>
              </>
            )}
          </p>
        ) : (
          <p className="mt-1 text-xs text-muted">{loading ? 'جارٍ التحميل…' : 'لم تُسجَّل نتائج اختبارات بعد.'}</p>
        )}
        {run?.summary && (
          <p dir="auto" className="mt-1 line-clamp-2 text-sm">
            {run.summary}
          </p>
        )}
      </div>
      {run && (
        <div className="flex gap-3">
          <div className="surface-2 min-w-[92px] rounded-xl px-3 py-2 text-center">
            <div className="tnum text-xl font-extrabold text-ok">{run.testsPassed ?? '—'}</div>
            <div className="text-[11px] text-muted">نجح</div>
          </div>
          <div className={`min-w-[92px] rounded-xl px-3 py-2 text-center ${failed ? 'bg-bad/10' : 'surface-2'}`}>
            <div className={`tnum text-xl font-extrabold ${failed ? 'text-bad' : 'text-muted'}`}>{run.testsFailed ?? '—'}</div>
            <div className="text-[11px] text-muted">فشل</div>
          </div>
        </div>
      )}
    </section>
  );
}

type ListState = { rows: Discovery[]; cursor: string | null; loading: boolean; error: string | null };

function DiscoveryList({ tab, onOpen }: { tab: Tab; onOpen: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [state, setState] = useState<ListState>({ rows: [], cursor: null, loading: true, error: null });

  // a short pause while typing before asking the server
  useEffect(() => {
    const t = setTimeout(() => setQuery(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(
    (cursor: string | null) => {
      let alive = true;
      setState((s) => ({ ...s, loading: true, error: null }));
      getDiscoveries(tab, query, cursor)
        .then((r) => {
          if (!alive) return;
          const data = Array.isArray(r) ? (r as Discovery[]) : (r?.data ?? []);
          setState((s) => ({
            rows: cursor ? [...s.rows, ...data] : data,
            cursor: Array.isArray(r) ? null : (r?.nextCursor ?? null),
            loading: false,
            error: null,
          }));
        })
        .catch((e) => alive && setState((s) => ({ ...s, loading: false, error: friendlyError(e) })));
      return () => {
        alive = false;
      };
    },
    [tab, query],
  );

  useEffect(() => load(null), [load]);

  return (
    <div className="flex flex-col gap-3">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="ابحث في العناوين والوصف…"
        aria-label="بحث في الاكتشافات"
        className="surface hairline min-h-11 w-full rounded-xl border px-3.5 text-sm outline-none transition focus:border-teal sm:max-w-sm"
      />
      {state.error && <Notice text={state.error} />}
      {state.loading && state.rows.length === 0 && !state.error && <Skeleton rows={3} />}
      {!state.loading && !state.error && state.rows.length === 0 && (
        <Empty>{query ? 'لا نتائج لهذا البحث.' : 'لا شيء هنا الآن.'}</Empty>
      )}
      <ul className="flex flex-col gap-2.5">
        {state.rows.map((d) => (
          <li key={d.id}>
            <DiscoveryRow d={d} onOpen={() => onOpen(d.id)} />
          </li>
        ))}
      </ul>
      {state.cursor && (
        <button
          onClick={() => load(state.cursor)}
          disabled={state.loading}
          className="min-h-11 rounded-xl border border-[rgb(var(--line))] text-sm font-bold text-muted hover:text-[rgb(var(--text))] disabled:opacity-50"
        >
          {state.loading ? 'جارٍ…' : 'عرض المزيد'}
        </button>
      )}
    </div>
  );
}

function DiscoveryRow({ d, onOpen }: { d: Discovery; onOpen: () => void }) {
  const sev = SEVERITY[d.severity] ?? SEVERITY.INFO;
  const st = DISCOVERY_STATUS[d.status];
  return (
    <button
      onClick={onOpen}
      className="surface flex w-full flex-col gap-2 rounded-2xl p-3.5 text-start shadow-card transition hover:border-teal/40 sm:p-4"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <Chip label={sev.label} cls={sev.cls} />
        <Chip label={KIND[d.kind] ?? d.kind} cls="surface-2 text-muted" />
        <VerifiedBadge verified={d.verified} />
        {st && <Chip label={st.label} cls={st.cls} />}
      </div>
      <div dir="auto" className="font-bold leading-snug">
        {d.title}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <Confidence value={d.confidence} title="مدى الثقة في الاكتشاف" />
        <span>
          رُصد <b className="tnum text-[rgb(var(--text))]">{num(d.seenCount)}</b> {d.seenCount === 1 ? 'مرة' : 'مرات'}
        </span>
        <span title={dateTime(d.lastSeenAt)}>آخر ظهور {ago(d.lastSeenAt)}</span>
      </div>
    </button>
  );
}
