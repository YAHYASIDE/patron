'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { api, ApiError, NOT_READY } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import { date, dateTime, moneyIn, statusChip } from '@/lib/format';
import Notice from '@/components/Notice';

type Status = 'PENDING' | 'VERIFIED' | 'REJECTED' | 'COMPLETED';
type Order = {
  id: string;
  orderNumber: string;
  status: string;
  total: string;
  currency: string;
  createdAt: string;
  items: { productNameAr: string; quantity: number }[];
};
type Request = {
  id: string;
  contact: string;
  newContact: string | null;
  fullName: string;
  proof: string;
  status: Status;
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewedBy: { id: string; fullName: string } | null;
  createdAt: string;
  destination: { kind: 'phone' | 'email'; masked: string; canSend: boolean } | null;
  user: {
    id: string;
    fullName: string;
    phone: string | null;
    email: string | null;
    phoneVerifiedAt: string | null;
    emailVerifiedAt: string | null;
    createdAt: string;
    lastLoginAt: string | null;
    isBlocked: boolean;
    country: string | null;
    city: string | null;
    _count: { orders: number };
    orders: Order[];
  } | null;
};

const TABS: { key: Status | 'OPEN'; label: string }[] = [
  { key: 'OPEN', label: 'بانتظار المراجعة' },
  { key: 'COMPLETED', label: 'مكتملة' },
  { key: 'REJECTED', label: 'مرفوضة' },
];
const STATUS: Record<Status, { t: string; c: string }> = {
  PENDING: { t: 'جديد', c: 'bg-warn/12 text-warn' },
  VERIFIED: { t: 'أُرسل الرمز للزبون', c: 'bg-teal/12 text-teal' },
  COMPLETED: { t: 'استعاد حسابه', c: 'bg-ok/12 text-ok' },
  REJECTED: { t: 'مرفوض', c: 'bg-ink-400/15 text-muted' },
};

/** Server answers in English with a stable meaning; the owner reads Arabic. */
function friendly(e: unknown): string {
  if (!(e instanceof ApiError)) return 'تعذّر الاتصال بالخادم.';
  if (e.message === NOT_READY) return NOT_READY;
  if (e.status === 403) return 'ليست لديك صلاحية مراجعة طلبات الاستعادة.';
  const m = e.message;
  if (/Email sending is not set up/i.test(m)) return 'إرسال البريد غير مفعّل بعد (RESEND_API_KEY و EMAIL_FROM)، فلا يمكن إرسال الرمز إلى بريد.';
  if (/Automatic SMS is not set up/i.test(m))
    return 'الرسائل التلقائية غير مفعّلة (OTP_PROVIDER=twilio_verify ومفاتيح Twilio). رمز الاستعادة لا يمر عبر صفحة «رموز التحقق» حتى لا يراه أحد من الفريق.';
  if (/No account matches/i.test(m)) return 'لا يوجد حساب بهذه البيانات. ارفض الطلب أو اطلب من الزبون الرقم أو البريد الصحيح.';
  if (/belongs to another account/i.test(m)) return 'الرقم أو البريد الجديد مسجّل لحساب آخر.';
  if (/closed|reviewed meanwhile/i.test(m)) return 'هذا الطلب رُوجع بالفعل. حدّث الصفحة.';
  if (/Wait \d+s/i.test(m)) return 'أُرسل رمز قبل أقل من دقيقة. انتظر قليلًا ثم أعد الإرسال.';
  if (/could not send/i.test(m)) return 'تعذّر إرسال الرمز الآن (مزوّد الرسائل أو البريد). حاول بعد قليل.';
  return m;
}

const isEmail = (v: string) => v.includes('@');

function RecoveryInner() {
  const focus = useSearchParams().get('id');
  const [tab, setTab] = useState<Status | 'OPEN'>('OPEN');
  const list = useFetch<Request[]>(`/admin/recovery${tab === 'OPEN' ? '' : `?status=${tab}`}`);

  // the notification bell links here with ?id=…
  useEffect(() => {
    if (!focus || !list.data) return;
    document.getElementById(`rq-${focus}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focus, list.data]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">استعادة الحسابات</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          زبائن فقدوا رقمهم أو بريدهم أو كلمة المرور. قارن ما كتبوه بطلبات الحساب، ثم «تأكيد الهوية»: يرسل النظام رمزًا
          إلى الرقم أو البريد الذي اختاره الزبون، وهو من يختار كلمة المرور. لا يرى أحد من الفريق الرمز ولا كلمة المرور.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
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
      </div>

      {list.error && <Notice text={list.error} />}
      {list.loading && !list.data && <p className="text-sm text-muted">جارٍ التحميل…</p>}
      {list.data && list.data.length === 0 && (
        <div className="rounded-2xl border border-dashed border-[rgb(var(--line))] px-5 py-10 text-center text-sm text-muted">
          {tab === 'OPEN' ? 'لا طلبات استعادة تنتظر المراجعة.' : 'لا طلبات هنا.'}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {list.data?.map((r) => (
          <RequestCard key={r.id} r={r} highlighted={r.id === focus} onChanged={list.reload} />
        ))}
      </div>
    </div>
  );
}

function RequestCard({ r, highlighted, onChanged }: { r: Request; highlighted: boolean; onChanged: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'verify' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const s = STATUS[r.status];
  const open = r.status === 'PENDING' || r.status === 'VERIFIED';

  async function act(kind: 'verify' | 'reject') {
    if (kind === 'reject' && !confirm('رفض طلب الاستعادة؟ أي رمز أُرسل له يتوقف عن العمل.')) return;
    setBusy(kind);
    setError(null);
    setDone(null);
    try {
      const res = await api.post<{ sentTo?: string }>(`/admin/recovery/${r.id}/${kind}`, note.trim() ? { note: note.trim() } : {});
      setDone(kind === 'verify' ? `أُرسل الرمز إلى ${res.sentTo ?? 'الزبون'}. أخبر الزبون أن يفتح «وصلني رمز الاستعادة» في المتجر.` : 'رُفض الطلب.');
      setNote('');
      onChanged();
    } catch (e) {
      setError(friendly(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      id={`rq-${r.id}`}
      className={'surface flex flex-col gap-4 rounded-2xl p-4 shadow-card sm:p-5 ' + (highlighted ? 'ring-2 ring-teal' : '')}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="break-words text-lg font-bold">{r.fullName}</h2>
          <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
            <span>طُلب {dateTime(r.createdAt)}</span>
            {r.reviewedBy && (
              <span>
                راجعه {r.reviewedBy.fullName} · {dateTime(r.reviewedAt)}
              </span>
            )}
          </div>
        </div>
        <span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${s.c}`}>{s.t}</span>
      </div>

      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <div className="surface-2 rounded-xl p-3">
          <div className="text-xs font-bold text-muted">الحساب المطلوب</div>
          <div dir="ltr" className="mt-1 break-all text-start font-semibold">
            {r.contact}
          </div>
        </div>
        <div className="surface-2 rounded-xl p-3">
          <div className="text-xs font-bold text-muted">يُرسل الرمز إلى</div>
          <div dir="ltr" className="mt-1 break-all text-start font-semibold">
            {r.newContact ?? r.contact}
          </div>
          <div className="mt-1 text-xs text-muted">
            {r.newContact ? 'رقم أو بريد جديد اختاره الزبون' : 'نفس الرقم أو البريد'}
            {' · '}
            {isEmail(r.newContact ?? r.contact) ? 'بالبريد' : 'برسالة'}
          </div>
        </div>
      </div>

      <div>
        <div className="text-xs font-bold text-muted">ما كتبه الزبون إثباتًا</div>
        <p className="surface-2 mt-1 whitespace-pre-wrap break-words rounded-xl p-3 text-sm leading-relaxed">{r.proof}</p>
      </div>

      <AccountPanel r={r} />

      {open && r.destination && !r.destination.canSend && (
        <Notice
          tone="warn"
          text={
            r.destination.kind === 'email'
              ? 'لا يمكن إرسال الرمز الآن: البريد غير مفعّل (RESEND_API_KEY و EMAIL_FROM).'
              : 'لا يمكن إرسال الرمز الآن: الرسائل التلقائية غير مفعّلة (OTP_PROVIDER=twilio_verify ومفاتيح Twilio). اطلب من الزبون بريدًا إن كان البريد مفعّلًا، أو فعّل الرسائل.'
          }
        />
      )}
      {error && <Notice text={error} />}
      {done && <Notice tone="ok" text={done} />}

      {open && (
        <div className="flex flex-col gap-3 border-t border-[rgb(var(--line))] pt-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-bold text-muted">ملاحظة للسجل (اختياري)</span>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="مثال: طابق آخر طلبين والمبلغ"
              className="surface-2 hairline w-full rounded-xl border px-3 py-2.5 text-sm outline-none focus:border-teal"
            />
          </label>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              onClick={() => act('verify')}
              disabled={!!busy || !r.user || r.destination?.canSend === false}
              className="flex-1 rounded-xl bg-teal py-3 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {busy === 'verify'
                ? 'جارٍ الإرسال…'
                : r.status === 'VERIFIED'
                  ? 'إعادة إرسال الرمز للزبون'
                  : 'تأكيد الهوية وإرسال الرمز'}
            </button>
            <button
              onClick={() => act('reject')}
              disabled={!!busy}
              className="rounded-xl border border-[rgb(var(--line))] px-5 py-3 text-sm font-bold text-muted transition hover:border-bad hover:text-bad disabled:opacity-50"
            >
              {busy === 'reject' ? 'جارٍ الرفض…' : 'رفض'}
            </button>
          </div>
          <p className="text-xs text-muted">
            لا تطلب من الزبون الرمز ولا كلمة المرور، ولا ترسلهما بنفسك. النظام يرسل الرمز مباشرة إلى الزبون.
          </p>
        </div>
      )}
      {!open && r.reviewNote && <p className="text-xs text-muted">ملاحظة: {r.reviewNote}</p>}
    </section>
  );
}

function AccountPanel({ r }: { r: Request }) {
  const u = r.user;
  if (!u) {
    return (
      <div className="rounded-xl border border-dashed border-[rgb(var(--line))] px-4 py-4 text-sm text-muted">
        لا يوجد حساب بهذا الرقم أو البريد. قد يكون الزبون كتبه خطأ؛ تواصل معه أو ارفض الطلب.
      </div>
    );
  }
  const verified = (at: string | null) =>
    at ? <span className="text-xs font-bold text-ok">موثّق</span> : <span className="text-xs font-bold text-warn">غير موثّق</span>;

  return (
    <div className="rounded-xl border border-[rgb(var(--line))] p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-bold text-muted">الحساب المطابق — قارن بما كتبه الزبون</div>
        <Link href={`/customers/${u.id}`} className="text-xs font-bold text-teal hover:underline">
          ملف الزبون
        </Link>
      </div>
      <div className="mt-2 grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
        <div>
          <span className="text-muted">الاسم: </span>
          <span className="font-semibold">{u.fullName}</span>
          {u.isBlocked && <span className="ms-2 text-xs font-bold text-bad">محظور</span>}
        </div>
        <div>
          <span className="text-muted">منذ: </span>
          {date(u.createdAt)}
        </div>
        {u.phone && (
          <div className="flex flex-wrap items-center gap-2">
            <span dir="ltr">{u.phone}</span>
            {verified(u.phoneVerifiedAt)}
          </div>
        )}
        {u.email && (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span dir="ltr" className="break-all">
              {u.email}
            </span>
            {verified(u.emailVerifiedAt)}
          </div>
        )}
        <div>
          <span className="text-muted">آخر دخول: </span>
          {u.lastLoginAt ? dateTime(u.lastLoginAt) : '—'}
        </div>
        <div>
          <span className="text-muted">المكان: </span>
          {[u.city, u.country].filter(Boolean).join('، ') || '—'}
        </div>
      </div>

      <div className="mt-3 text-xs font-bold text-muted">آخر الطلبات ({u._count.orders})</div>
      {u.orders.length === 0 ? (
        <p className="mt-1 text-sm text-muted">لا طلبات على هذا الحساب.</p>
      ) : (
        <ul className="mt-1.5 divide-y divide-[rgb(var(--line))]">
          {u.orders.map((o) => {
            const chip = statusChip(o.status);
            return (
              <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <Link href={`/orders/${o.id}`} className="font-mono text-xs font-bold text-teal hover:underline" dir="ltr">
                    {o.orderNumber}
                  </Link>
                  <div className="break-words text-xs text-muted">
                    {o.items.map((i) => `${i.productNameAr}${i.quantity > 1 ? ` ×${i.quantity}` : ''}`).join('، ')}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="tnum font-bold">{moneyIn(o.total, o.currency)}</span>
                  <span className="text-muted">{date(o.createdAt)}</span>
                  <span className={`rounded-full px-2 py-0.5 font-bold ${chip.cls}`}>{chip.label}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Platform V2 — support-assisted account recovery (staff with «recovery.review»). */
export default function RecoveryPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">جارٍ التحميل…</p>}>
      <RecoveryInner />
    </Suspense>
  );
}
