'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { money, num } from '@/lib/format';
import Notice from '@/components/Notice';
import { agentError, normalizePhone, parsePositive, ruleText, type AgentRow } from '@/lib/agents';

/** The owner's agents (المندوبون): who brings customers, on what rule, and what is owed. */
export default function AgentsPage() {
  return (
    <Suspense fallback={null}>
      <Agents />
    </Suspense>
  );
}

function Agents() {
  const params = useSearchParams();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<'' | 'true' | 'false'>('');
  const [adding, setAdding] = useState(!!params.get('phone'));

  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 350);
    return () => clearTimeout(t);
  }, [q]);

  const qs = new URLSearchParams();
  if (search) qs.set('search', search);
  if (active) qs.set('active', active);
  const query = qs.toString();
  const list = useFetch<AgentRow[]>(`/admin/agents${query ? `?${query}` : ''}`);
  const rows = list.data ?? [];
  const owed = rows.reduce((a, r) => a + Math.max(0, Number(r.statement.balanceDue)), 0);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">المندوبون</h1>
          <p className="mt-1 text-sm text-muted">
            {list.data
              ? `${num(rows.length)} مندوب · المستحق لهم الآن ${money(owed)}`
              : 'من يجلب لك الزبائن، وبأي عمولة، وكم تدين لهم.'}
          </p>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="min-h-11 rounded-xl bg-teal px-5 text-sm font-bold text-white"
          aria-expanded={adding}
        >
          {adding ? 'إغلاق' : 'إضافة مندوب'}
        </button>
      </div>

      {adding && (
        <CreateAgent
          initialPhone={params.get('phone') ?? ''}
          initialName={params.get('name') ?? ''}
          onCreated={() => {
            setAdding(false);
            list.reload();
          }}
        />
      )}

      <RulesHelp />

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="ابحث بالاسم أو الرقم أو الرمز"
          className="surface hairline min-h-11 flex-1 rounded-xl border px-4 py-2.5 text-[15px] outline-none focus:border-teal"
        />
        <div className="flex gap-2">
          {(
            [
              ['', 'الكل'],
              ['true', 'نشط'],
              ['false', 'موقوف'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v || 'all'}
              onClick={() => setActive(v)}
              aria-pressed={active === v}
              className={
                'min-h-11 flex-1 whitespace-nowrap rounded-xl border px-4 text-sm font-bold sm:flex-none ' +
                (active === v ? 'border-teal bg-teal text-white' : 'border-[rgb(var(--line))] text-muted')
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {list.error && <Notice text={list.error} />}
      {list.loading && !list.data && <p className="text-sm text-muted">جارٍ التحميل…</p>}
      {list.data && rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[rgb(var(--line))] px-5 py-10 text-center text-sm text-muted">
          {search || active ? 'لا مندوب بهذا البحث.' : 'لا مندوبين بعد. أضف أول مندوب من الزر أعلاه.'}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((a) => (
          <Link
            key={a.id}
            href={`/agents/${a.id}`}
            className="surface flex flex-col gap-3 rounded-2xl p-4 shadow-card transition hover:border-teal"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-teal">{a.user.fullName}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${a.isActive ? 'bg-ok/12 text-ok' : 'bg-ink-400/15 text-muted'}`}>
                    {a.isActive ? 'نشط' : 'موقوف'}
                  </span>
                </div>
                {a.user.phone && (
                  <div dir="ltr" className="mt-0.5 text-right text-sm text-muted">
                    {a.user.phone}
                  </div>
                )}
                <div className="mt-1 text-xs text-muted">
                  <span dir="ltr" className="font-mono font-bold text-[rgb(var(--text))]">{a.code}</span> · {ruleText(a, (n) => money(n))}
                </div>
              </div>
              <div className="text-end">
                <div className={`tnum text-lg font-extrabold ${Number(a.statement.balanceDue) < 0 ? 'text-bad' : ''}`}>
                  {money(a.statement.balanceDue)}
                </div>
                <div className="text-xs text-muted">مستحق الآن</div>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 border-t hairline pt-3 text-center text-xs">
              <Mini k="زبائن" v={num(a.referralsCount)} />
              <Mini k="طلبات" v={num(a.ordersCount)} />
              <Mini k="قيد الانتظار" v={money(a.statement.pending.amount)} />
              <Mini k="دُفع" v={money(a.statement.payouts.total)} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Mini({ k, v }: { k: string; v: string }) {
  return (
    <div className="min-w-0">
      <div className="tnum truncate text-sm font-bold">{v}</div>
      <div className="text-muted">{k}</div>
    </div>
  );
}

function RulesHelp() {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-sm">
      <button onClick={() => setOpen((v) => !v)} className="font-semibold text-teal hover:underline" aria-expanded={open}>
        {open ? 'إخفاء' : 'كيف تُحسب العمولة؟'}
      </button>
      {open && (
        <ul className="surface mt-2 list-disc space-y-1.5 rounded-2xl p-4 ps-8 text-muted shadow-card">
          <li>كل زبون يسجّل من رابط المندوب (‎?ref=الرمز) يُنسب إليه عند إنشاء حسابه فقط، ولا يتغيّر بعد ذلك.</li>
          <li>كل طلب يضعه هذا الزبون ما دام المندوب نشطًا يُنسب إلى المندوب.</li>
          <li>العمولة نسبة من صافي الطلب بالدولار (بعد أي استرجاع)، أو مبلغ ثابت عن كل طلب — حسب قاعدة المندوب وقت الطلب.</li>
          <li>عند الدفع تكون «قيد الانتظار»، وتصبح «مستحقة» عند اكتمال الطلب، و«ملغاة» إن أُلغي أو فشل أو استُرجع كاملًا.</li>
          <li>تسجيل دفعة يجعل العمولات المختارة «مدفوعة» مرة واحدة فقط. استرجاعٌ بعد الدفع يظهر «استرجاعًا» ويُخصم من الدفعة القادمة.</li>
          <li>تغيير القاعدة يسري على الطلبات الجديدة فقط.</li>
        </ul>
      )}
    </div>
  );
}

function CreateAgent({ initialPhone, initialName, onCreated }: { initialPhone: string; initialName: string; onCreated: () => void }) {
  const [phone, setPhone] = useState(initialPhone);
  const [fullName, setFullName] = useState(initialName);
  const [code, setCode] = useState('');
  const [type, setType] = useState<'PERCENT' | 'FIXED'>('PERCENT');
  const [value, setValue] = useState('5');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = parsePositive(value);
  const e164 = normalizePhone(phone);
  const codeOk = !code || /^[A-Za-z0-9]{4,12}$/.test(code);
  const ready = /^\+[1-9]\d{7,14}$/.test(e164) && amount !== null && !(type === 'PERCENT' && amount > 100) && codeOk;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!ready || amount === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/admin/agents', {
        phone: e164,
        ...(fullName.trim() && { fullName: fullName.trim() }),
        ...(code && { code: code.toUpperCase() }),
        commissionType: type,
        commissionValue: amount,
        ...(note.trim() && { note: note.trim() }),
      });
      onCreated();
    } catch (err) {
      setError(agentError(err, 'تعذّر إنشاء المندوب.'));
    } finally {
      setBusy(false);
    }
  }

  const input = 'surface-2 hairline min-h-11 w-full min-w-0 rounded-xl border px-3 py-2.5 text-base outline-none focus:border-teal';
  return (
    <form onSubmit={submit} className="surface flex flex-col gap-4 rounded-2xl p-5 shadow-card">
      <h2 className="text-base font-bold">مندوب جديد</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">رقم واتساب (حسابه، أو يُنشأ له حساب)</span>
          <input dir="ltr" inputMode="tel" placeholder="+22222123456" value={phone} onChange={(e) => setPhone(e.target.value)} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">الاسم (لرقم ليس له حساب)</span>
          <input value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={80} className={input} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">رمز الإحالة (اختياري، يُولَّد تلقائيًا)</span>
          <input
            dir="ltr" value={code} maxLength={12} placeholder="SIDI24"
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
            className={`${input} font-mono uppercase`}
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-semibold text-muted">العمولة</span>
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
        </div>
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className="text-xs font-semibold text-muted">ملاحظة (لك وحدك)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={input} />
        </label>
      </div>
      <p className="text-xs text-muted">
        {type === 'PERCENT'
          ? 'نسبة من صافي كل طلب مكتمل بالدولار، بعد أي استرجاع.'
          : 'مبلغ ثابت بالدولار عن كل طلب مكتمل (لا يتجاوز قيمة الطلب).'}{' '}
        يحصل المندوب على صفحة «المندوب» في المتجر برمزه وعمولاته.
      </p>
      {error && <Notice text={error} />}
      <button disabled={!ready || busy} className="min-h-11 rounded-xl bg-teal px-5 text-sm font-bold text-white disabled:opacity-50 sm:self-start">
        {busy ? 'جارٍ الإنشاء…' : 'إنشاء المندوب'}
      </button>
    </form>
  );
}
