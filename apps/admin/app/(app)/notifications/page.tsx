'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ApiError, NOT_READY } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { dateTime } from '@/lib/format';
import Notice from '@/components/Notice';
import {
  NOTICE_TYPES,
  PRIORITIES,
  PRIORITY,
  ago,
  getPrefs,
  inboxChanged,
  inboxPath,
  markAllRead,
  markRead,
  priorityOf,
  resolveNotice,
  safeLink,
  setPrefs,
  typeLabel,
  type Inbox,
  type InboxState,
  type StaffNotice,
  type StaffPriority,
} from '@/lib/staff-notifications';

const TABS: { key: InboxState; label: string }[] = [
  { key: 'open', label: 'يحتاج إجراء' },
  { key: 'all', label: 'الكل' },
  { key: 'resolved', label: 'تمّت معالجته' },
];

function friendly(e: unknown): string {
  if (!(e instanceof ApiError)) return 'تعذّر الاتصال بالخادم.';
  if (e.message === NOT_READY) return NOT_READY;
  if (e.status === 403) return 'ليست لديك صلاحية مركز الإشعارات.';
  return e.message;
}

/** The owner's notification center: what needs a person, with filters, read/resolve and per-type muting. */
export default function NotificationsPage() {
  const [tab, setTab] = useState<InboxState>('open');
  const [type, setType] = useState('');
  const [priority, setPriority] = useState<StaffPriority | ''>('');
  const [error, setError] = useState<string | null>(null);
  const list = useFetch<Inbox>(inboxPath(tab, 200));

  const rows = useMemo(
    () =>
      (list.data?.data ?? []).filter(
        (n) => (!type || n.type === type) && (!priority || n.priority === priority),
      ),
    [list.data, type, priority],
  );
  // the types on screen plus the known ones, so the filter never hides a kind that is there
  const types = useMemo(() => {
    const present = new Set((list.data?.data ?? []).map((n) => n.type));
    return [...new Set([...Object.keys(NOTICE_TYPES), ...present])];
  }, [list.data]);

  async function act(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
      list.reload();
      inboxChanged();
    } catch (e) {
      setError(friendly(e));
    }
  }

  const unread = list.data?.unread ?? 0;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">مركز الإشعارات</h1>
          <p className="mt-1 text-sm text-muted">
            كل ما يحتاجك في المتجر: طلبات للتسليم، تحويلات للمراجعة، أعطال واسترجاعات. العاجل يُذكّرك حتى
            تعالجه.
          </p>
        </div>
        {list.data && (
          <div className="flex items-center gap-2 text-xs font-bold">
            <span className="rounded-full bg-teal/12 px-3 py-1.5 text-teal tnum">{list.data.open} مفتوح</span>
            <span className="rounded-full bg-warn/12 px-3 py-1.5 text-warn tnum">{unread} غير مقروء</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={
              'rounded-full px-3.5 py-1.5 text-xs font-bold transition ' +
              (tab === t.key ? 'bg-teal text-white' : 'surface-2 text-muted hover:text-[rgb(var(--text))]')
            }
          >
            {t.label}
          </button>
        ))}
        {unread > 0 && (
          <button
            onClick={() => act(markAllRead)}
            className="ms-auto text-xs font-bold text-teal hover:underline"
          >
            تعليم الكل كمقروء
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          aria-label="النوع"
          className="surface-2 hairline min-w-0 rounded-xl border px-3 py-2 text-sm outline-none focus:border-teal sm:w-60"
        >
          <option value="">كل الأنواع</option>
          {types.map((t) => (
            <option key={t} value={t}>
              {typeLabel(t)}
            </option>
          ))}
        </select>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as StaffPriority | '')}
          aria-label="الأولوية"
          className="surface-2 hairline min-w-0 rounded-xl border px-3 py-2 text-sm outline-none focus:border-teal sm:w-40"
        >
          <option value="">كل الأولويات</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {PRIORITY[p].label}
            </option>
          ))}
        </select>
      </div>

      {list.error && <Notice text={list.error} />}
      {error && <Notice text={error} />}
      {list.loading && !list.data && <p className="text-sm text-muted">جارٍ التحميل…</p>}
      {list.data && rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[rgb(var(--line))] px-5 py-10 text-center text-sm text-muted">
          {tab === 'open' && !type && !priority ? 'لا شيء ينتظرك الآن.' : 'لا إشعارات هنا.'}
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        {rows.map((n) => (
          <NoticeCard
            key={n.id}
            n={n}
            onRead={() => act(() => markRead(n.id))}
            onResolve={() => act(() => resolveNotice(n.id))}
          />
        ))}
      </div>

      <MuteSettings onSaved={list.reload} />
    </div>
  );
}

function NoticeCard({ n, onRead, onResolve }: { n: StaffNotice; onRead: () => void; onResolve: () => void }) {
  const p = priorityOf(n.priority);
  const link = safeLink(n.link);
  return (
    <section
      className={
        'surface relative flex gap-3 overflow-hidden rounded-2xl p-4 shadow-card ' +
        (n.readAt ? '' : 'ring-1 ring-teal/25')
      }
    >
      <span className={`absolute inset-y-0 start-0 w-1 ${p.dot}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${p.chip}`}>{p.label}</span>
          <span className="rounded-full surface-2 px-2 py-0.5 text-[11px] font-semibold text-muted">
            {typeLabel(n.type)}
          </span>
          {n.remindCount > 0 && (
            <span className="rounded-full bg-warn/12 px-2 py-0.5 text-[11px] font-bold text-warn tnum">
              ذُكِّرت {n.remindCount} مرة
            </span>
          )}
          {!n.readAt && <span className="h-2 w-2 rounded-full bg-teal" aria-label="غير مقروء" />}
          <span className="ms-auto text-[11px] text-muted" title={dateTime(n.createdAt)}>
            {ago(n.createdAt)}
          </span>
        </div>
        <h2 className={`mt-1.5 break-words ${n.readAt ? 'font-bold' : 'font-extrabold'}`}>{n.title}</h2>
        <p className="mt-0.5 whitespace-pre-line break-words text-sm text-muted">{n.body}</p>
        {n.resolvedAt && (
          <p className="mt-1 text-xs font-semibold text-ok">عولج · {dateTime(n.resolvedAt)}</p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {link && (
            <Link
              href={link}
              onClick={() => !n.readAt && onRead()}
              className="rounded-xl bg-teal px-4 py-2 text-sm font-bold text-white hover:bg-teal-deep"
            >
              فتح
            </Link>
          )}
          {!n.readAt && (
            <button
              onClick={onRead}
              className="rounded-xl border border-[rgb(var(--line))] px-3.5 py-2 text-sm font-bold text-muted hover:text-[rgb(var(--text))]"
            >
              تعليم كمقروء
            </button>
          )}
          {!n.resolvedAt && (
            <button
              onClick={onResolve}
              className="ms-auto rounded-xl px-3 py-2 text-sm font-bold text-ok hover:bg-ok/10"
            >
              تمّت المعالجة
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/** Which kinds of notices this person does not want to see (the others still do). */
function MuteSettings({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useState<string[] | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);

  useEffect(() => {
    if (!open || muted) return;
    getPrefs()
      .then((p) => {
        setMuted(p.muted);
        setSaved(p.muted);
      })
      .catch((e) => setMsg({ text: friendly(e), tone: 'bad' }));
  }, [open, muted]);

  const types = [...new Set([...Object.keys(NOTICE_TYPES), ...(muted ?? [])])];
  const dirty = muted !== null && [...muted].sort().join() !== [...saved].sort().join();

  async function save() {
    if (!muted) return;
    setBusy(true);
    setMsg(null);
    try {
      const p = await setPrefs(muted);
      setSaved(p.muted);
      setMuted(p.muted);
      setMsg({ text: 'حُفظت الإعدادات.', tone: 'ok' });
      onSaved();
      inboxChanged();
    } catch (e) {
      setMsg({ text: friendly(e), tone: 'bad' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface rounded-2xl shadow-card">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 p-4 text-start"
      >
        <span className="font-bold">كتم أنواع من الإشعارات</span>
        <span className="text-xs text-muted">لك وحدك، لا يؤثر على بقية الفريق</span>
        <svg
          className={`ms-auto transition ${open ? 'rotate-180' : ''}`}
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="flex flex-col gap-3 border-t border-[rgb(var(--line))] p-4">
          {!muted && !msg && <p className="text-sm text-muted">جارٍ التحميل…</p>}
          {muted && (
            <div className="grid gap-2 sm:grid-cols-2">
              {types.map((t) => {
                const on = !muted.includes(t);
                return (
                  <label
                    key={t}
                    className="surface-2 flex cursor-pointer items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => setMuted(on ? [...muted, t] : muted.filter((m) => m !== t))}
                      className="h-4 w-4 accent-[#0d6d64]"
                    />
                    <span className={on ? 'font-semibold' : 'text-muted line-through'}>{typeLabel(t)}</span>
                  </label>
                );
              })}
            </div>
          )}
          {msg && <Notice text={msg.text} tone={msg.tone} />}
          {muted && (
            <button
              disabled={busy || !dirty}
              onClick={save}
              className="self-start rounded-xl bg-teal px-5 py-2 text-sm font-bold text-white hover:bg-teal-deep disabled:opacity-50"
            >
              {busy ? 'جارٍ…' : 'حفظ'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
