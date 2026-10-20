'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ApiError, NOT_READY } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { dateTime, moneyIn, paymentChip } from '@/lib/format';
import Notice from '@/components/Notice';
import { inboxChanged } from '@/lib/staff-notifications';
import {
  APP_ID,
  BANK_STATUS,
  bankNoticesPath,
  confirmNotice,
  getBankConfig,
  ignoreNotice,
  setBankConfig,
  type BankNotice,
  type BankStatus,
  type PaymentBrief,
} from '@/lib/bank-notices';

type PendingTransfer = {
  id: string;
  amount: string;
  currency: string;
  rawResponse: { transfer?: { method?: string; reference?: string; payerPhone?: string } } | null;
  order: { id: string; orderNumber: string; user: { fullName: string } };
};

const TABS: { key: BankStatus | ''; label: string }[] = [
  { key: '', label: 'للمراجعة أولًا' },
  { key: 'SUGGESTED', label: 'مطابقة مقترحة' },
  { key: 'NEW', label: 'بلا طلب' },
  { key: 'DUPLICATE', label: 'مكررة' },
  { key: 'CONFIRMED', label: 'مربوطة' },
  { key: 'IGNORED', label: 'متجاهَلة' },
];

// the API's messages (codes BANK_NOTICE_REVIEWED, _DUPLICATE, _PAYMENT_TAKEN, _PAYMENT_INVALID) in Arabic
const ERRORS: Record<string, string> = {
  'This notice was already reviewed': 'رُوجع هذا الإشعار من قبل.',
  'This notice repeats another one; confirm the first one':
    'هذا الإشعار يكرر إشعارًا سابقًا؛ اربط الأول أو تجاهل هذا.',
  'Another bank notice is already linked to this payment': 'هذه الدفعة مربوطة بإشعار آخر.',
  'Pick a manual transfer payment': 'اختر دفعة تحويل يدوي.',
  'This app is not in the list of allowed bank apps': 'هذا التطبيق ليس في قائمة تطبيقات البنك المسموح بها.',
};

function friendly(e: unknown): string {
  if (!(e instanceof ApiError)) return 'تعذّر الاتصال بالخادم.';
  if (e.message === NOT_READY) return NOT_READY;
  if (e.status === 403) return 'ليست لديك صلاحية لهذا الإجراء.';
  return ERRORS[e.message] ?? e.message;
}

/**
 * Payment notifications the owner's Android phone read from the chosen bank
 * apps, to find a transfer faster. Evidence only: approving a payment stays on
 * the order page, after the owner checked the money arrived.
 */
export default function BankNoticesPage() {
  const [status, setStatus] = useState<BankStatus | ''>('');
  const list = useFetch<{ data: BankNotice[] }>(bankNoticesPath(status));
  const rows = list.data?.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">إشعارات البنك</h1>
        <p className="mt-1 text-sm text-muted">
          إشعارات الدفع التي قرأها هاتفك من تطبيقات البنك المختارة، مع المبلغ والمرجع والطلب الذي قد تخصه.
        </p>
      </div>

      <div className="rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm font-semibold text-warn">
        الإشعار دليل يساعدك وليس إثباتًا للدفع: لا يُعتمد أي دفع من هنا. تأكّد بنفسك من وصول المبلغ ثم وافق
        على الدفع من صفحة الطلب.
      </div>

      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
        {TABS.map((t) => (
          <button
            key={t.key || 'review'}
            onClick={() => setStatus(t.key)}
            className={
              'flex-none rounded-full px-3.5 py-1.5 text-xs font-bold transition ' +
              (status === t.key ? 'bg-teal text-white' : 'surface-2 text-muted hover:text-[rgb(var(--text))]')
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {list.error && <Notice text={list.error} />}
      {list.loading && !list.data && <p className="text-sm text-muted">جارٍ التحميل…</p>}
      {list.data && rows.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[rgb(var(--line))] px-5 py-10 text-center text-sm text-muted">
          لا إشعارات هنا. يرسلها تطبيق الإدارة على هاتفك عندما تفعّل قراءة إشعارات البنك.
        </div>
      )}

      <div className="flex flex-col gap-3">
        {rows.map((n) => (
          <NoticeCard key={n.id} n={n} onChanged={list.reload} />
        ))}
      </div>

      <AllowedApps />
    </div>
  );
}

function Confidence({ value }: { value: number }) {
  const color = value >= 70 ? 'bg-ok' : value >= 40 ? 'bg-warn' : 'bg-bad';
  return (
    <div className="flex items-center gap-2" title="مدى ثقة القراءة الآلية في المبلغ والمرجع">
      <div className="surface-2 h-1.5 w-20 overflow-hidden rounded-full" aria-hidden>
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(4, value)}%` }} />
      </div>
      <span className="text-xs font-bold text-muted tnum">{value}%</span>
    </div>
  );
}

function PaymentLine({ p, label }: { p: PaymentBrief; label: string }) {
  const chip = paymentChip(p.status);
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl border border-teal/25 bg-teal/5 px-3.5 py-2.5 text-sm">
      <span className="text-xs font-bold text-teal">{label}</span>
      <Link href={`/orders/${p.orderId}`} className="font-bold text-teal hover:underline" dir="ltr">
        {p.orderNumber}
      </Link>
      <span className="tnum">{moneyIn(p.amount, p.currency)}</span>
      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${chip.cls}`}>{chip.label}</span>
    </div>
  );
}

function Field({ k, v, ltr }: { k: string; v: string | null; ltr?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted">{k}</div>
      <div className="truncate text-sm font-semibold" dir={ltr ? 'ltr' : undefined}>
        {v ?? '—'}
      </div>
    </div>
  );
}

function NoticeCard({ n, onChanged }: { n: BankNotice; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ignoring, setIgnoring] = useState(false);
  const [note, setNote] = useState('');
  const [linking, setLinking] = useState(false);
  const s = BANK_STATUS[n.status] ?? BANK_STATUS.NEW;
  const open = n.status === 'NEW' || n.status === 'SUGGESTED';
  const reviewable = open || n.status === 'DUPLICATE';

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
      inboxChanged();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface flex flex-col gap-3 rounded-2xl p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-xl font-extrabold tnum">
            {n.amount ? (
              moneyIn(n.amount, n.currency ?? '')
            ) : (
              <span className="text-muted">مبلغ غير مقروء</span>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted">
            <span dir="ltr">{n.sourceApp}</span>
            <span>{dateTime(n.postedAt)}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {n.duplicate && (
            <span className="rounded-full bg-bad/12 px-2.5 py-1 text-xs font-bold text-bad">مكرر</span>
          )}
          {!n.duplicate && (
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${s.cls}`}>{s.label}</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field k="المرجع" v={n.reference} ltr />
        <Field k="المرسل" v={n.sender} ltr />
        <div className="min-w-0">
          <div className="text-[11px] text-muted">الثقة</div>
          <Confidence value={n.confidence} />
        </div>
        <Field k="وصل" v={dateTime(n.receivedAt)} />
      </div>

      <p dir="auto" className="surface-2 whitespace-pre-line break-words rounded-xl px-3.5 py-2.5 text-sm">
        {n.title && <span className="font-bold">{n.title} · </span>}
        {n.text}
      </p>

      {n.suggestedPayment && n.status !== 'CONFIRMED' && (
        <PaymentLine p={n.suggestedPayment} label="قد يخص الطلب" />
      )}
      {n.matchedPayment && <PaymentLine p={n.matchedPayment} label="مربوط بالطلب" />}
      {n.duplicate && n.duplicateOfId && (
        <p className="text-xs text-muted">نفس المرجع وصل في إشعار سابق؛ احتفظنا بالاثنين.</p>
      )}
      {n.reviewNote && <p className="text-xs text-muted">ملاحظة: {n.reviewNote}</p>}

      {reviewable && (
        <div className="flex flex-wrap items-center gap-2">
          {n.status === 'SUGGESTED' && n.suggestedPaymentId && (
            <button
              disabled={busy}
              onClick={() => run(() => confirmNotice(n.id, n.suggestedPaymentId!))}
              className="rounded-xl bg-teal px-4 py-2 text-sm font-bold text-white hover:bg-teal-deep disabled:opacity-50"
            >
              {busy ? 'جارٍ…' : 'تأكيد أنه نفس التحويل'}
            </button>
          )}
          {open && (
            <button
              disabled={busy}
              onClick={() => setLinking((v) => !v)}
              className="rounded-xl border border-[rgb(var(--line))] px-3.5 py-2 text-sm font-bold text-muted hover:text-[rgb(var(--text))]"
            >
              {n.status === 'SUGGESTED' ? 'ربط بدفعة أخرى' : 'ربط بدفعة'}
            </button>
          )}
          <button
            disabled={busy}
            onClick={() => setIgnoring((v) => !v)}
            className="ms-auto px-2 text-sm font-bold text-muted hover:text-[rgb(var(--text))] disabled:opacity-50"
          >
            تجاهل
          </button>
        </div>
      )}

      {linking && open && (
        <LinkPayment
          notice={n}
          busy={busy}
          onPick={(paymentId) => run(() => confirmNotice(n.id, paymentId))}
        />
      )}

      {ignoring && reviewable && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
            placeholder="سبب (اختياري): تحويل شخصي، إشعار قديم…"
            className="surface-2 hairline min-w-0 flex-1 rounded-xl border px-3.5 py-2 text-sm outline-none focus:border-teal"
          />
          <button
            disabled={busy}
            onClick={() => run(() => ignoreNotice(n.id, note.trim() || undefined))}
            className="rounded-xl border border-[rgb(var(--line))] px-4 py-2 text-sm font-bold disabled:opacity-50"
          >
            تأكيد التجاهل
          </button>
        </div>
      )}

      {error && <Notice text={error} />}
    </section>
  );
}

/** Transfers customers reported and the owner has not reviewed: the ones with the same amount first. */
function LinkPayment({
  notice,
  busy,
  onPick,
}: {
  notice: BankNotice;
  busy: boolean;
  onPick: (id: string) => void;
}) {
  const pending = useFetch<PendingTransfer[]>('/admin/payments/manual/pending');
  const same = (p: PendingTransfer) => notice.amount !== null && Number(p.amount) === Number(notice.amount);
  const rows = (pending.data ?? [])
    .filter((p) => !notice.currency || p.currency === notice.currency)
    .sort((a, b) => Number(same(b)) - Number(same(a)));

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[rgb(var(--line))] p-3">
      <div className="text-xs font-bold text-muted">
        اختر التحويل الذي يخصه هذا الإشعار. الربط يسجّل الدليل فقط؛ الموافقة على الدفع تبقى في صفحة الطلب.
      </div>
      {pending.error && <Notice text={pending.error} />}
      {pending.loading && !pending.data && <p className="text-sm text-muted">جارٍ التحميل…</p>}
      {pending.data && rows.length === 0 && (
        <p className="text-sm text-muted">لا تحويلات تنتظر المراجعة بهذه العملة.</p>
      )}
      {rows.map((p) => (
        <button
          key={p.id}
          disabled={busy}
          onClick={() => onPick(p.id)}
          className={
            'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl px-3 py-2 text-start text-sm transition hover:bg-teal/10 disabled:opacity-50 ' +
            (same(p) ? 'bg-teal/5 ring-1 ring-teal/30' : 'surface-2')
          }
        >
          <span className="font-bold" dir="ltr">
            {p.order.orderNumber}
          </span>
          <span className="tnum">{moneyIn(p.amount, p.currency)}</span>
          <span className="text-xs text-muted">{p.order.user.fullName}</span>
          {p.rawResponse?.transfer?.reference && (
            <span className="text-xs text-muted" dir="ltr">
              {p.rawResponse.transfer.reference}
            </span>
          )}
          {same(p) && <span className="ms-auto text-[11px] font-bold text-teal">نفس المبلغ</span>}
        </button>
      ))}
    </div>
  );
}

/** Which bank apps the phone may forward. Empty: the phone forwards nothing. */
function AllowedApps() {
  const [apps, setApps] = useState<string[] | null>(null);
  const [saved, setSaved] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'bad' } | null>(null);

  useEffect(() => {
    getBankConfig()
      .then((c) => {
        setApps(c.allowedApps);
        setSaved(c.allowedApps);
      })
      .catch((e) => setMsg({ text: friendly(e), tone: 'bad' }));
  }, []);

  function add() {
    const id = draft.trim();
    if (!apps || !id) return;
    if (!APP_ID.test(id)) {
      setMsg({ text: 'اكتب اسم الحزمة كما في أندرويد، مثل mr.bankily.app', tone: 'bad' });
      return;
    }
    setMsg(null);
    if (!apps.includes(id)) setApps([...apps, id]);
    setDraft('');
  }

  async function save() {
    if (!apps) return;
    setBusy(true);
    setMsg(null);
    try {
      const c = await setBankConfig(apps);
      setApps(c.allowedApps);
      setSaved(c.allowedApps);
      setMsg({ text: 'حُفظت القائمة.', tone: 'ok' });
    } catch (e) {
      setMsg({
        text:
          e instanceof ApiError && e.status === 403 ? 'تغيير القائمة يحتاج صلاحية الإعدادات.' : friendly(e),
        tone: 'bad',
      });
    } finally {
      setBusy(false);
    }
  }

  const dirty = apps !== null && [...apps].sort().join() !== [...saved].sort().join();

  return (
    <section className="surface flex flex-col gap-3 rounded-2xl p-4 shadow-card sm:p-5">
      <div>
        <h2 className="font-bold">تطبيقات البنك المسموح بها</h2>
        <p className="mt-0.5 text-xs text-muted">
          لا يُقبل إلا ما يأتي من هذه التطبيقات. القائمة فارغة في البداية، فلا يُرسل الهاتف شيئًا حتى تضيف
          تطبيقًا.
        </p>
      </div>
      {apps && apps.length === 0 && <p className="text-sm text-muted">لا تطبيقات بعد.</p>}
      {apps && apps.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {apps.map((a) => (
            <span
              key={a}
              className="surface-2 flex items-center gap-1.5 rounded-full py-1 pe-1.5 ps-3 text-sm"
              dir="ltr"
            >
              {a}
              <button
                onClick={() => setApps(apps.filter((x) => x !== a))}
                aria-label={`إزالة ${a}`}
                className="grid h-6 w-6 place-items-center rounded-full text-muted hover:bg-bad/10 hover:text-bad"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      {apps && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && add()}
            placeholder="mr.bankily.app"
            dir="ltr"
            className="surface-2 hairline min-w-0 flex-1 rounded-xl border px-3.5 py-2 text-sm outline-none focus:border-teal"
          />
          <div className="flex gap-2">
            <button
              onClick={add}
              disabled={!draft.trim()}
              className="flex-1 rounded-xl border border-[rgb(var(--line))] px-4 py-2 text-sm font-bold disabled:opacity-50 sm:flex-none"
            >
              إضافة
            </button>
            <button
              onClick={save}
              disabled={busy || !dirty}
              className="flex-1 rounded-xl bg-teal px-5 py-2 text-sm font-bold text-white hover:bg-teal-deep disabled:opacity-50 sm:flex-none"
            >
              {busy ? 'جارٍ…' : 'حفظ'}
            </button>
          </div>
        </div>
      )}
      {msg && <Notice text={msg.text} tone={msg.tone} />}
    </section>
  );
}
