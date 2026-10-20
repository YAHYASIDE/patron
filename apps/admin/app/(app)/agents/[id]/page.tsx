'use client';

import { use, useMemo, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { date, dateTime, money, moneyIn, num, statusChip } from '@/lib/format';
import Notice from '@/components/Notice';
import CopyButton from '@/components/CopyButton';
import {
  agentError, COMMISSION_STATUS, parsePositive, ruleText, storeLink, VOID_REASON,
  type AgentDetail, type CommissionStatus, type Statement,
} from '@/lib/agents';

/** One agent: statement, rule, payouts, commissions and the customers they brought. */
export default function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: a, loading, error, reload } = useFetch<AgentDetail>(`/admin/agents/${id}`);

  return (
    <div className="flex flex-col gap-5">
      <Link href="/agents" className="text-sm font-semibold text-muted hover:text-[rgb(var(--text))]">
        ← المندوبون
      </Link>
      {loading && !a && <p className="text-sm text-muted">جارٍ التحميل…</p>}
      {error && <Notice text={error} />}
      {a && <Agent a={a} reload={reload} />}
    </div>
  );
}

function Agent({ a, reload }: { a: AgentDetail; reload: () => void }) {
  const link = storeLink(a.code, a.shareLink);
  const [tab, setTab] = useState<'commissions' | 'referrals' | 'payouts'>('commissions');

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-extrabold">{a.user.fullName}</h1>
            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${a.isActive ? 'bg-ok/12 text-ok' : 'bg-ink-400/15 text-muted'}`}>
              {a.isActive ? 'نشط' : 'موقوف'}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
            {a.user.phone && <span dir="ltr">{a.user.phone}</span>}
            <Link href={`/customers/${a.user.id}`} className="font-semibold text-teal hover:underline">
              ملفّه كزبون
            </Link>
            <span>مندوب منذ {date(a.createdAt)}</span>
          </div>
        </div>
        {a.user.phone && (
          <a
            href={`https://wa.me/${a.user.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`رابطك للمشاركة: ${link}`)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-xl bg-[#1FA855] px-5 py-2.5 text-sm font-bold text-white"
          >
            أرسل له رابطه
          </a>
        )}
      </div>

      <section className="surface flex flex-col gap-3 rounded-2xl p-5 shadow-card sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-xs font-semibold text-muted">رمز الإحالة</div>
          <div dir="ltr" className="mt-1 text-start font-mono text-2xl font-extrabold tracking-[0.15em] text-teal sm:text-end">
            {a.code}
          </div>
          <div dir="ltr" className="mt-1 break-all text-start text-xs text-muted sm:text-end">{link}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <CopyButton text={a.code} label="نسخ الرمز" />
          <CopyButton text={link} label="نسخ الرابط" />
        </div>
      </section>

      <StatementTiles s={a.statement} />

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="flex flex-col gap-5 lg:col-span-2">
          <RuleEditor a={a} onSaved={reload} />
        </div>
        <div className="lg:col-span-3">
          <RecordPayout a={a} onPaid={reload} />
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto" role="tablist">
        {(
          [
            ['commissions', `العمولات (${num(a.commissions.length)})`],
            ['referrals', `الزبائن (${num(a.referralsCount)})`],
            ['payouts', `الدفعات (${num(a.payouts.length)})`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={
              'min-h-10 whitespace-nowrap rounded-xl px-4 text-sm font-bold ' +
              (tab === k ? 'bg-teal text-white' : 'border border-[rgb(var(--line))] text-muted')
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'commissions' && <Commissions a={a} />}
      {tab === 'referrals' && <Referrals a={a} />}
      {tab === 'payouts' && <Payouts a={a} />}
    </>
  );
}

function StatementTiles({ s }: { s: Statement }) {
  const due = Number(s.balanceDue);
  const tiles = [
    { k: 'قيد الانتظار', v: money(s.pending.amount), h: `${num(s.pending.count)} طلب لم يكتمل` },
    { k: 'مستحقة غير مدفوعة', v: money(s.earned.amount), h: `${num(s.earned.count)} عمولة` },
    { k: 'دُفع له', v: money(s.payouts.total), h: `${num(s.payouts.count)} دفعة · ${num(s.paid.count)} عمولة` },
    { k: 'ملغاة', v: num(s.void.count), h: 'طلبات أُلغيت أو فشلت أو استُرجعت' },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      <div className="surface col-span-2 rounded-2xl p-4 shadow-card lg:col-span-1">
        <div className="text-xs font-semibold text-muted">المستحق له الآن</div>
        <div className={`tnum mt-1 text-2xl font-extrabold ${due < 0 ? 'text-bad' : 'text-teal'}`}>{money(s.balanceDue)}</div>
        {Number(s.clawback.open) > 0 && (
          <div className="mt-1 text-xs font-bold text-bad">بعد خصم استرجاع مفتوح {money(s.clawback.open)}</div>
        )}
        {due < 0 && <div className="mt-1 text-xs text-bad">المندوب مدين: يُخصم من دفعاته القادمة.</div>}
      </div>
      {tiles.map((t) => (
        <div key={t.k} className="surface rounded-2xl p-4 shadow-card">
          <div className="text-xs font-semibold text-muted">{t.k}</div>
          <div className="tnum mt-1 text-xl font-extrabold">{t.v}</div>
          <div className="mt-0.5 text-[11px] text-muted">{t.h}</div>
        </div>
      ))}
    </div>
  );
}

function RuleEditor({ a, onSaved }: { a: AgentDetail; onSaved: () => void }) {
  const [type, setType] = useState(a.commissionType);
  const [value, setValue] = useState(String(Number(a.commissionValue)));
  const [note, setNote] = useState(a.note ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const amount = parsePositive(value);
  const changed = type !== a.commissionType || amount !== Number(a.commissionValue) || note.trim() !== (a.note ?? '');

  async function patch(body: Record<string, unknown>, done: string) {
    setBusy(true);
    setMsg(null);
    try {
      await api.patch(`/admin/agents/${a.id}`, body);
      setMsg({ ok: true, text: done });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: agentError(e, 'تعذّر الحفظ.') });
    } finally {
      setBusy(false);
    }
  }

  async function recompute() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await api.post<{ orders: number; created: number; updated: number; clawback: number }>(`/admin/agents/${a.id}/recompute`);
      setMsg({ ok: true, text: `رُوجعت ${num(r.orders)} طلبات: ${num(r.created + r.updated + r.clawback)} تغيير.` });
      onSaved();
    } catch (e) {
      setMsg({ ok: false, text: agentError(e, 'تعذّرت المراجعة.') });
    } finally {
      setBusy(false);
    }
  }

  const input = 'surface-2 hairline min-h-11 w-full min-w-0 rounded-xl border px-3 py-2.5 text-base outline-none focus:border-teal';
  return (
    <section className="surface flex flex-col gap-4 rounded-2xl p-5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold">القاعدة</h2>
        <span className="text-sm text-muted">{ruleText(a, (n) => money(n))}</span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (amount === null) return;
          void patch({ commissionType: type, commissionValue: amount, note: note.trim() || null }, 'حُفظت القاعدة للطلبات الجديدة.');
        }}
        className="flex flex-col gap-3"
      >
        <div className="flex gap-2">
          <div className="grid flex-none grid-cols-2 gap-1 rounded-xl border border-[rgb(var(--line))] p-1">
            {(
              [
                ['PERCENT', '%'],
                ['FIXED', '$ ثابت'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v} type="button" aria-pressed={type === v} onClick={() => setType(v)}
                className={`min-h-9 rounded-lg px-3 text-sm font-bold ${type === v ? 'bg-teal text-white' : 'text-muted'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <input dir="ltr" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} className={input} aria-label="قيمة العمولة" />
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">ملاحظة (لك وحدك)</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className={input} />
        </label>
        <p className="text-xs text-muted">التغيير يسري على الطلبات الجديدة؛ العمولات الحالية تبقى على قاعدتها.</p>
        <button
          disabled={busy || !changed || amount === null || (type === 'PERCENT' && amount > 100)}
          className="min-h-11 rounded-xl bg-teal px-4 text-sm font-bold text-white disabled:opacity-50"
        >
          حفظ القاعدة
        </button>
      </form>
      <div className="flex flex-wrap gap-2 border-t hairline pt-4">
        <button
          disabled={busy}
          onClick={() =>
            (a.isActive ? confirm('إيقاف المندوب؟ لن يُنسب إليه زبائن ولا طلبات جديدة، وتبقى عمولاته الحالية.') : true) &&
            void patch({ isActive: !a.isActive }, a.isActive ? 'أُوقف المندوب.' : 'فُعِّل المندوب.')
          }
          className={`min-h-11 flex-1 rounded-xl border px-4 text-sm font-bold ${a.isActive ? 'border-bad/40 text-bad' : 'border-ok/40 text-ok'}`}
        >
          {a.isActive ? 'إيقاف المندوب' : 'تفعيل المندوب'}
        </button>
        <button
          disabled={busy}
          onClick={() => void recompute()}
          title="يعيد حساب كل عمولة من حالة طلبها الآن، ولا يغيّر عمولة مدفوعة"
          className="min-h-11 flex-1 rounded-xl border border-[rgb(var(--line))] px-4 text-sm font-bold"
        >
          مراجعة العمولات
        </button>
      </div>
      {msg && <Notice text={msg.text} tone={msg.ok ? 'ok' : 'bad'} />}
    </section>
  );
}

function RecordPayout({ a, onPaid }: { a: AgentDetail; onPaid: () => void }) {
  const earned = useMemo(() => a.commissions.filter((c) => c.status === 'EARNED' && !c.payoutId), [a.commissions]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(earned.map((c) => c.id)));
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const gross = earned.filter((c) => picked.has(c.id)).reduce((s, c) => s + Number(c.amount), 0);
  const open = Number(a.statement.clawback.open);
  const deducted = Math.min(gross, open);
  const net = Math.round((gross - deducted) * 100) / 100;

  function toggle(id: string) {
    setConfirming(false);
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function pay() {
    setBusy(true);
    setMsg(null);
    try {
      await api.post(`/admin/agents/${a.id}/payouts`, {
        commissionIds: [...picked].filter((id) => earned.some((c) => c.id === id)),
        ...(reference.trim() && { reference: reference.trim() }),
        ...(note.trim() && { note: note.trim() }),
      });
      setMsg({ ok: true, text: `سُجّلت الدفعة: ${money(net)}.` });
      setReference('');
      setNote('');
      setConfirming(false);
      onPaid();
    } catch (e) {
      setConfirming(false);
      setMsg({ ok: false, text: agentError(e, 'تعذّر تسجيل الدفعة.') });
    } finally {
      setBusy(false);
    }
  }

  const input = 'surface-2 hairline min-h-11 w-full min-w-0 rounded-xl border px-3 py-2.5 text-base outline-none focus:border-teal';
  return (
    <section className="surface flex flex-col gap-4 rounded-2xl p-5 shadow-card">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-bold">تسجيل دفعة</h2>
        {earned.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              setPicked(picked.size === earned.length ? new Set() : new Set(earned.map((c) => c.id)));
            }}
            className="text-sm font-semibold text-teal hover:underline"
          >
            {picked.size === earned.length ? 'إلغاء التحديد' : 'تحديد الكل'}
          </button>
        )}
      </div>
      <p className="text-xs text-muted">
        أرسل المال إلى المندوب أولًا (خارج المتجر)، ثم سجّله هنا. لا تُدفع عمولة مرتين: ما سُجّل مدفوعًا لا يمكن اختياره مجددًا.
      </p>

      {earned.length === 0 ? (
        <p className="text-sm text-muted">لا عمولات مستحقة غير مدفوعة.</p>
      ) : (
        <div className="max-h-72 overflow-y-auto rounded-xl border hairline">
          {earned.map((c) => (
            <label key={c.id} className="flex min-h-11 cursor-pointer items-center gap-3 border-b hairline px-3 py-2 text-sm last:border-b-0">
              <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} className="h-4 w-4 accent-[rgb(15_118_110)]" />
              <span className="min-w-0 flex-1">
                <span dir="ltr" className="block font-semibold">{c.order.orderNumber}</span>
                <span className="block text-xs text-muted">{c.order.user.fullName} · {date(c.earnedAt ?? c.createdAt)}</span>
              </span>
              <span className="tnum font-bold">{money(c.amount)}</span>
            </label>
          ))}
        </div>
      )}

      {earned.length > 0 && (
        <>
          <div className="grid gap-1 rounded-xl bg-[rgb(var(--surface-2))] px-4 py-3 text-sm">
            <div className="flex justify-between"><span className="text-muted">العمولات المختارة ({num(picked.size)})</span><span className="tnum font-bold">{money(gross)}</span></div>
            {deducted > 0 && (
              <div className="flex justify-between text-bad"><span>خصم استرجاع مفتوح</span><span className="tnum font-bold">− {money(deducted)}</span></div>
            )}
            <div className="flex justify-between border-t hairline pt-1"><span className="font-bold">المبلغ الذي ترسله</span><span className="tnum text-lg font-extrabold text-teal">{money(net)}</span></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">رقم التحويل (اختياري)</span>
              <input dir="ltr" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} className={input} />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold text-muted">ملاحظة</span>
              <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={input} />
            </label>
          </div>
          {!confirming ? (
            <button
              disabled={picked.size === 0 || busy}
              onClick={() => setConfirming(true)}
              className="min-h-11 rounded-xl bg-teal px-4 text-sm font-bold text-white disabled:opacity-50"
            >
              تسجيل دفعة {money(net)}
            </button>
          ) : (
            <div className="flex flex-col gap-2 rounded-xl border border-warn/40 bg-warn/10 p-3 text-sm">
              <span className="font-bold">تأكيد: دفعتَ {money(net)} إلى {a.user.fullName} عن {num(picked.size)} عمولة؟</span>
              <div className="flex gap-2">
                <button disabled={busy} onClick={() => void pay()} className="min-h-11 flex-1 rounded-xl bg-teal px-4 font-bold text-white disabled:opacity-50">
                  {busy ? 'جارٍ التسجيل…' : 'نعم، سجّل'}
                </button>
                <button onClick={() => setConfirming(false)} className="min-h-11 flex-1 rounded-xl border border-[rgb(var(--line))] px-4 font-bold">
                  تراجع
                </button>
              </div>
            </div>
          )}
        </>
      )}
      {msg && <Notice text={msg.text} tone={msg.ok ? 'ok' : 'bad'} />}
    </section>
  );
}

function Commissions({ a }: { a: AgentDetail }) {
  const [filter, setFilter] = useState<CommissionStatus | ''>('');
  const rows = filter ? a.commissions.filter((c) => c.status === filter) : a.commissions;
  return (
    <section className="surface overflow-hidden rounded-2xl shadow-card">
      <div className="flex gap-2 overflow-x-auto px-4 py-3">
        {(['', 'PENDING', 'EARNED', 'PAID', 'VOID'] as const).map((s) => (
          <button
            key={s || 'all'}
            onClick={() => setFilter(s)}
            aria-pressed={filter === s}
            className={`whitespace-nowrap rounded-full border px-3 py-1 text-xs font-bold ${filter === s ? 'border-teal bg-teal text-white' : 'border-[rgb(var(--line))] text-muted'}`}
          >
            {s ? COMMISSION_STATUS[s].label : 'الكل'}
          </button>
        ))}
      </div>
      {rows.length === 0 && <p className="px-5 pb-5 text-sm text-muted">لا عمولات.</p>}
      <div className="flex flex-col divide-y divide-[rgb(var(--line))] border-t hairline">
        {rows.map((c) => {
          const st = COMMISSION_STATUS[c.status];
          const order = statusChip(c.order.status);
          return (
            <div key={c.id} className="flex flex-wrap items-start justify-between gap-2 px-5 py-3 text-sm">
              <div className="min-w-0">
                <Link href={`/orders/${c.order.id}`} dir="ltr" className="block font-semibold text-teal hover:underline">
                  {c.order.orderNumber}
                </Link>
                <div className="text-xs text-muted">
                  {c.order.user.fullName} · {date(c.createdAt)} · صافي {money(c.basis)} ·{' '}
                  <span className={`rounded-full px-1.5 py-0.5 font-bold ${order.cls}`}>{order.label}</span>
                </div>
                {c.voidReason && c.status === 'VOID' && <div className="mt-0.5 text-xs text-muted">{VOID_REASON[c.voidReason] ?? c.voidReason}</div>}
                {c.clawbackAmount && Number(c.clawbackAmount) > 0 && (
                  <div className="mt-0.5 text-xs font-bold text-bad">
                    استرجاع بعد الدفع {money(c.clawbackAmount)} ({VOID_REASON[c.clawbackReason ?? ''] ?? c.clawbackReason}
                    {c.clawbackAt ? ` · ${dateTime(c.clawbackAt)}` : ''}) — خُصم منه {money(c.clawbackRecovered ?? 0)}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${st.cls}`}>{st.label}</span>
                <span className={`tnum whitespace-nowrap font-bold ${c.status === 'VOID' ? 'text-muted line-through' : ''}`}>{money(c.amount)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Referrals({ a }: { a: AgentDetail }) {
  return (
    <section className="surface overflow-hidden rounded-2xl shadow-card">
      {a.referrals.length === 0 && <p className="px-5 py-5 text-sm text-muted">لم يسجّل أحد برمزه بعد.</p>}
      <div className="flex flex-col divide-y divide-[rgb(var(--line))]">
        {a.referrals.map((u) => (
          <Link
            key={u.id}
            href={`/customers/${u.id}`}
            className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm hover:bg-[rgb(var(--surface-2))]"
          >
            <span className="min-w-0">
              <span className="block font-semibold">{u.fullName}</span>
              {u.phone && <span dir="ltr" className="block text-right text-xs text-muted">{u.phone}</span>}
            </span>
            <span className="text-end text-xs text-muted">
              <span className="block">انضمّ {date(u.createdAt)}</span>
              <span className="block font-bold text-[rgb(var(--text))]">{num(u.ordersCount)} طلب</span>
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

function Payouts({ a }: { a: AgentDetail }) {
  return (
    <section className="surface overflow-hidden rounded-2xl shadow-card">
      {a.payouts.length === 0 && <p className="px-5 py-5 text-sm text-muted">لا دفعات بعد.</p>}
      <div className="flex flex-col divide-y divide-[rgb(var(--line))]">
        {a.payouts.map((p) => (
          <div key={p.id} className="flex flex-wrap items-start justify-between gap-2 px-5 py-3 text-sm">
            <div className="min-w-0">
              <div className="font-semibold">{dateTime(p.createdAt)}</div>
              <div className="text-xs text-muted">
                {num(p.commissionsCount)} عمولة
                {p.reference && (
                  <>
                    {' · '}رقم التحويل <span dir="ltr">{p.reference}</span>
                  </>
                )}
              </div>
              {p.clawbackDeducted && Number(p.clawbackDeducted) > 0 && (
                <div className="text-xs font-bold text-bad">خُصم استرجاع {money(p.clawbackDeducted)}</div>
              )}
              {p.note && <div className="break-words text-xs text-muted">{p.note}</div>}
            </div>
            <span className="tnum font-extrabold">{moneyIn(p.amount, p.currency)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
