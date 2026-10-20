'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { rowsOf, useFetch } from '@/lib/hooks';
import { dateTime, num } from '@/lib/format';
import Notice from '@/components/Notice';
import { Chip, Empty, Skeleton } from '@/components/IntelBits';
import {
  ACTION_LABEL,
  agentName,
  ago,
  decisionsPath,
  RUN_STATUS,
  type AgentRun,
  type DecisionLogEntry,
  type IntelSummary,
} from '@/lib/intelligence';

/** An agent that has not reported for a week is shown as «قديم» (scanners carry the server's own flag). */
const AGENT_STALE_DAYS = 7;
const agentStale = (run: AgentRun | null) =>
  !run || Date.now() - new Date(run.finishedAt ?? run.startedAt).getTime() > AGENT_STALE_DAYS * 86_400_000;

type Row = { key: string; name: string; at: string | null; stale: boolean; run: AgentRun | null; scanner: boolean };

/** Each agent and in-app scanner: when it last ran, how it went, and a warning when it went quiet. */
export function AgentsSection({
  summary,
  loading,
  error,
}: {
  summary: IntelSummary | null;
  loading: boolean;
  error: string | null;
}) {
  const runsByAgent = new Map((summary?.agents ?? []).map((a) => [a.agent, a.lastRun]));
  const rows: Row[] = [
    ...(summary?.agents ?? [])
      .filter((a) => !a.agent.startsWith('scanner:'))
      .map((a) => ({
        key: a.agent,
        name: agentName(a.agent),
        at: a.lastRun ? (a.lastRun.finishedAt ?? a.lastRun.startedAt) : null,
        stale: agentStale(a.lastRun),
        run: a.lastRun,
        scanner: false,
      })),
    ...(summary?.scanners ?? []).map((s) => ({
      key: `scanner:${s.name}`,
      name: agentName(s.name),
      at: s.lastRunAt,
      stale: s.stale,
      // a scanner's last run, when the agents list carries it too
      run: runsByAgent.get(`scanner:${s.name}`) ?? runsByAgent.get(s.name) ?? null,
      scanner: true,
    })),
  ];

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-bold">الوكلاء والفاحصات</h2>
        <p className="text-xs text-muted">
          الفاحصات تعمل داخل التطبيق كل يوم؛ الوكلاء يرسلون تقاريرهم عند تشغيلهم. «قديم» يعني أنه لم يعمل منذ مدة.
        </p>
      </div>
      {error && !summary && <Notice text={error} />}
      {loading && !summary && <Skeleton rows={2} h="h-16" />}
      {summary && rows.length === 0 && <Empty>لم يعمل أي وكيل أو فاحص بعد.</Empty>}
      <ul className="grid gap-2.5 md:grid-cols-2">
        {rows.map((r) => {
          const st = r.run ? (RUN_STATUS[r.run.status] ?? { label: r.run.status, cls: 'bg-ink-400/15 text-muted' }) : null;
          return (
            <li key={r.key} className="surface flex flex-col gap-1.5 rounded-2xl p-3.5 shadow-card">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="me-auto font-bold">{r.name}</span>
                <Chip label={r.scanner ? 'فاحص' : 'وكيل'} cls="surface-2 text-muted" />
                {st && <Chip label={st.label} cls={st.cls} />}
                {r.stale && <Chip label="قديم" cls="bg-warn/12 text-warn" title="لم يعمل منذ مدة" />}
              </div>
              <div className="flex flex-wrap gap-x-3 text-xs text-muted">
                <span title={dateTime(r.at)}>آخر تشغيل: {r.at ? ago(r.at) : 'لم يعمل بعد'}</span>
                {r.run && r.run.discoveries > 0 && <span>{num(r.run.discoveries)} اكتشاف</span>}
                {r.run && (r.run.testsPassed !== null || r.run.testsFailed !== null) && (
                  <span>
                    اختبارات: <b className="text-ok">{r.run.testsPassed ?? 0}</b> نجح ·{' '}
                    <b className={(r.run.testsFailed ?? 0) > 0 ? 'text-bad' : ''}>{r.run.testsFailed ?? 0}</b> فشل
                  </span>
                )}
              </div>
              {r.run?.summary && (
                <p dir="auto" className="line-clamp-3 break-words text-sm">
                  {r.run.summary}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

const TYPE_LABEL: Record<string, string> = {
  discovery: 'اكتشاف',
  method: 'وسيلة دفع',
  'market-method': 'وسيلة دفع',
  market_method: 'وسيلة دفع',
  rule: 'توفّر منتج',
  'market-rule': 'توفّر منتج',
  market_rule: 'توفّر منتج',
};

/** Every decision on discoveries and on market suggestions, newest first. */
export function DecisionLog({ reloadKey, onOpen }: { reloadKey: number; onOpen: (id: string) => void }) {
  const { data, error, loading, reload } = useFetch<DecisionLogEntry[] | { data: DecisionLogEntry[] }>(decisionsPath(30));
  const rows = rowsOf(data);

  useEffect(() => {
    if (reloadKey > 0) reload();
  }, [reloadKey, reload]);

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-bold">سجل القرارات</h2>
        <p className="text-xs text-muted">كل موافقة أو رفض أو تأجيل، على الاكتشافات واقتراحات الأسواق.</p>
      </div>
      {error && <Notice text={error} />}
      {loading && !data && <Skeleton rows={2} h="h-12" />}
      {data && rows.length === 0 && <Empty>لا قرارات بعد.</Empty>}
      {rows.length > 0 && (
        <ol className="surface divide-y divide-[rgb(var(--line))] rounded-2xl shadow-card">
          {rows.map((x, i) => {
            const type = x.type ?? x.subjectType ?? x.subject?.type ?? (x.discoveryId || x.discovery ? 'discovery' : '');
            const title = x.title ?? x.subject?.title ?? x.discovery?.title ?? x.name ?? x.ref ?? '';
            const discoveryId = x.discoveryId ?? x.discovery?.id ?? (type === 'discovery' ? x.subject?.id : undefined);
            const country = x.countryCode ?? x.subject?.countryCode ?? null;
            const at = x.createdAt ?? x.decisionAt ?? x.at ?? null;
            return (
              <li key={x.id ?? i} className="flex flex-col gap-1 px-3.5 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <b>{ACTION_LABEL[x.action] ?? x.action}</b>
                  {TYPE_LABEL[type] && <Chip label={TYPE_LABEL[type]} cls="surface-2 text-muted" />}
                  {country && (
                    <Link href={`/markets/${encodeURIComponent(country)}`} className="text-xs font-bold text-teal hover:underline">
                      {country}
                    </Link>
                  )}
                  <span className="ms-auto text-xs text-muted" title={dateTime(at)}>
                    {ago(at)}
                  </span>
                </div>
                {title &&
                  (discoveryId ? (
                    <button onClick={() => onOpen(discoveryId)} dir="auto" className="text-start font-semibold text-teal hover:underline">
                      {title}
                    </button>
                  ) : (
                    <span dir="auto" className="font-semibold">
                      {title}
                    </span>
                  ))}
                <div className="flex flex-wrap gap-x-2 text-xs text-muted">
                  {x.actorLabel && <span dir="auto">{x.actorLabel}</span>}
                  {x.note && (
                    <span dir="auto" className="break-words">
                      «{x.note}»
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
