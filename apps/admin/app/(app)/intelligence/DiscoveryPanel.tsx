'use client';

import { useState } from 'react';
import { useFetch } from '@/lib/hooks';
import { date, dateTime, num } from '@/lib/format';
import Notice from '@/components/Notice';
import CopyButton from '@/components/CopyButton';
import { Chip, ConfirmDialog, Confidence, Sheet, Skeleton, VerifiedBadge } from '@/components/IntelBits';
import {
  ACTION_LABEL,
  actionsFor,
  decideDiscovery,
  DISCOVERY_STATUS,
  discoveryPath,
  EVIDENCE_TYPE,
  friendlyError,
  KIND,
  safeUrl,
  SEVERITY,
  type DiscoveryAction,
  type DiscoveryDetail,
} from '@/lib/intelligence';

const DEFER_CHOICES = [7, 14, 30, 90];

const TEST_KEY: Record<string, string> = {
  passed: 'نجح',
  failed: 'فشل',
  skipped: 'تُخطّي',
  total: 'المجموع',
  reappeared: 'عاد للظهور بعد إغلاقه',
  command: 'الأمر',
  suite: 'المجموعة',
};

/** The full story of one discovery and the owner's buttons. */
export default function DiscoveryPanel({
  id,
  canDecide,
  onClose,
  onChanged,
}: {
  id: string;
  canDecide: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { data: d, error, loading, reload } = useFetch<DiscoveryDetail>(discoveryPath(id));
  const sev = d ? (SEVERITY[d.severity] ?? SEVERITY.INFO) : null;
  const st = d ? DISCOVERY_STATUS[d.status] : null;

  return (
    <Sheet
      wide
      onClose={onClose}
      title={d ? <span dir="auto">{d.title}</span> : 'تفاصيل الاكتشاف'}
      subtitle={
        d && (
          <div className="flex flex-wrap items-center gap-1.5">
            {sev && <Chip label={sev.label} cls={sev.cls} />}
            <Chip label={KIND[d.kind] ?? d.kind} cls="surface-2 text-muted" />
            <VerifiedBadge verified={d.verified} />
            {st && <Chip label={st.label} cls={st.cls} />}
          </div>
        )
      }
    >
      {error && <Notice text={error} />}
      {loading && !d && <Skeleton rows={4} h="h-16" />}
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
            <Fact k="الثقة">
              <Confidence value={d.confidence} title="مدى الثقة في الاكتشاف" />
            </Fact>
            <Fact k="رُصد">
              <span className="tnum">{num(d.seenCount)}</span> {d.seenCount === 1 ? 'مرة' : 'مرات'}
            </Fact>
            <Fact k="أول ظهور">{date(d.firstSeenAt)}</Fact>
            <Fact k="آخر ظهور">{dateTime(d.lastSeenAt)}</Fact>
            <Fact k="المصدر">
              <span dir="ltr">{d.source}</span>
            </Fact>
            {d.deferredUntil && <Fact k="مؤجل حتى">{date(d.deferredUntil)}</Fact>}
          </div>

          {!d.verified && (
            <p className="rounded-xl border border-dashed border-warn/50 px-3 py-2 text-xs font-semibold text-warn">
              هذا تقدير لم يُؤكَّد بعد: تحقّق منه قبل أن تبني عليه قرارًا.
            </p>
          )}

          <Block title="الوصف">
            <Text>{d.description}</Text>
          </Block>
          <Block title="الأثر">
            <Text>{d.impact}</Text>
          </Block>
          <Block title="الاقتراح">
            <Text>{d.proposal}</Text>
          </Block>

          <Block title="الأدلة">
            {Array.isArray(d.evidence) && d.evidence.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {d.evidence.map((e, i) => (
                  <li key={i} className="surface-2 flex min-w-0 flex-col gap-1 rounded-xl px-3 py-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Chip label={EVIDENCE_TYPE[e.type] ?? e.type} cls="surface text-muted" />
                      <EvidenceRef type={e.type} value={e.ref} />
                    </div>
                    {e.detail && (
                      <p dir="auto" className="whitespace-pre-line break-words text-xs text-muted">
                        {e.detail}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">لا أدلة مرفقة.</p>
            )}
          </Block>

          <TestResults value={d.testResults} />

          {(d.branch || d.prUrl) && (
            <Block title="التنفيذ">
              <div className="flex flex-col gap-2 text-sm">
                {d.branch && (
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-xs text-muted">الفرع</span>
                    <code dir="ltr" className="surface-2 min-w-0 truncate rounded-lg px-2 py-1 text-xs">
                      {d.branch}
                    </code>
                    <CopyButton text={d.branch} />
                  </div>
                )}
                {safeUrl(d.prUrl) && (
                  <a
                    href={safeUrl(d.prUrl)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold text-teal hover:underline"
                  >
                    فتح طلب الدمج (PR) ↗
                  </a>
                )}
              </div>
            </Block>
          )}

          {canDecide && (
            <Decide
              id={d.id}
              actions={actionsFor(d.status)}
              onDone={() => {
                reload();
                onChanged();
              }}
            />
          )}

          <Block title="سجل القرارات">
            {d.decisions && d.decisions.length > 0 ? (
              <ol className="flex flex-col gap-2">
                {d.decisions.map((x) => (
                  <li key={x.id} className="flex flex-col gap-0.5 border-s-2 border-teal/30 ps-3 text-xs">
                    <div className="flex flex-wrap items-center gap-x-2">
                      <b className="text-sm">{ACTION_LABEL[x.action] ?? x.action}</b>
                      <span className="text-muted" dir="auto">
                        {x.actorLabel}
                      </span>
                      <span className="text-muted">{dateTime(x.createdAt)}</span>
                    </div>
                    {x.note && (
                      <p dir="auto" className="break-words">
                        {x.note}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-xs text-muted">لا قرارات بعد.</p>
            )}
          </Block>
        </>
      )}
    </Sheet>
  );
}

function Decide({ id, actions, onDone }: { id: string; actions: DiscoveryAction[]; onDone: () => void }) {
  const [note, setNote] = useState('');
  const [days, setDays] = useState(14);
  const [busy, setBusy] = useState<DiscoveryAction | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (actions.length === 0) return null;

  async function act(action: DiscoveryAction) {
    setBusy(action);
    setError(null);
    setDone(null);
    try {
      await decideDiscovery(id, action, note.trim() || undefined, days);
      setNote('');
      setAsking(false);
      setDone(`سُجّل: ${ACTION_LABEL[action]}.`);
      onDone();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  const primary = actions[0];
  return (
    <section className="surface-2 flex flex-col gap-3 rounded-2xl p-3.5">
      <h3 className="text-sm font-bold">قرارك</h3>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        maxLength={1000}
        placeholder="ملاحظة (اختياري): لماذا، أو ما المطلوب…"
        className="surface hairline w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-teal"
      />
      {actions.includes('defer') && (
        <label className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted">
          التأجيل لمدة
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="surface hairline min-h-10 rounded-xl border px-2 text-sm text-[rgb(var(--text))]"
          >
            {DEFER_CHOICES.map((n) => (
              <option key={n} value={n}>
                {n} يومًا
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a}
            disabled={!!busy}
            onClick={() => (a === 'reject' ? setAsking(true) : act(a))}
            className={
              'min-h-11 flex-1 rounded-xl px-4 text-sm font-bold transition disabled:opacity-50 sm:flex-none ' +
              (a === primary
                ? 'bg-teal text-white hover:bg-teal-deep'
                : a === 'reject'
                  ? 'border border-bad/40 text-bad hover:bg-bad/10'
                  : 'surface border border-[rgb(var(--line))] hover:border-teal')
            }
          >
            {busy === a ? 'جارٍ…' : a === 'defer' ? `تأجيل ${days} يومًا` : ACTION_LABEL[a]}
          </button>
        ))}
      </div>
      {error && <Notice text={error} />}
      {done && <Notice text={done} tone="ok" />}
      {asking && (
        <ConfirmDialog
          title="رفض هذا الاكتشاف؟"
          body="يُغلق ولا يُعاد فتحه تلقائيًا إن ظهر مرة أخرى؛ يمكنك إعادة فتحه لاحقًا."
          confirmLabel="نعم، رفض"
          tone="bad"
          busy={busy === 'reject'}
          error={error}
          onConfirm={() => act('reject')}
          onCancel={() => setAsking(false)}
        />
      )}
    </section>
  );
}

function TestResults({ value }: { value: unknown }) {
  if (value === null || value === undefined) return null;
  const entries =
    typeof value === 'object' && !Array.isArray(value) ? Object.entries(value as Record<string, unknown>) : null;
  return (
    <Block title="نتائج الاختبار">
      {entries ? (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {entries.map(([k, v]) => (
            <div key={k} className="surface-2 min-w-0 rounded-xl px-3 py-2">
              <dt className="text-[11px] text-muted">{TEST_KEY[k] ?? k}</dt>
              <dd dir="auto" className="break-words text-sm font-semibold">
                {show(v)}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p dir="auto" className="surface-2 break-words rounded-xl px-3 py-2 text-xs">
          {show(value)}
        </p>
      )}
    </Block>
  );
}

/** A JSON value as short text (results are written by agents: keep it readable, never huge). */
function show(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'نعم' : 'لا';
  if (v === null || v === undefined) return '—';
  const s = typeof v === 'string' ? v : typeof v === 'number' ? String(v) : JSON.stringify(v);
  return s.length > 400 ? `${s.slice(0, 400)}…` : s;
}

function EvidenceRef({ type, value }: { type: string; value: string }) {
  const href = type === 'url' ? safeUrl(value) : null;
  if (href)
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" dir="ltr" className="min-w-0 truncate text-xs font-bold text-teal hover:underline">
        {value}
      </a>
    );
  return (
    <code dir="ltr" className="min-w-0 break-all text-xs">
      {value}
    </code>
  );
}

function Fact({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted">{k}</div>
      <div className="truncate font-semibold">{children}</div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="text-xs font-bold text-muted">{title}</h3>
      {children}
    </section>
  );
}

function Text({ children }: { children: string }) {
  return (
    <p dir="auto" className="whitespace-pre-line break-words text-sm leading-relaxed">
      {children || '—'}
    </p>
  );
}
