'use client';

import { useState } from 'react';
import Link from 'next/link';
import { auth } from '@/lib/api';
import { agentApi, type AgentCommission } from '@/lib/agent';
import { useFetch } from '@/lib/hooks';
import { locale, money, num } from '@/lib/format';
import { tNow, useT } from '@/lib/i18n';
import { CopyIcon, ShareIcon } from '@/components/discovery-icons';
import { CheckIcon } from '@/components/icons';

const STATUS: Record<AgentCommission['status'], { label: string; cls: string }> = {
  PENDING: { label: 'قيد الانتظار', cls: 'bg-warn/12 text-warn' },
  EARNED: { label: 'مستحقة', cls: 'bg-teal/12 text-teal' },
  PAID: { label: 'مدفوعة', cls: 'bg-ok/12 text-ok' },
  VOID: { label: 'ملغاة', cls: 'bg-[rgb(var(--surface-2))] text-muted' },
};

const REASON: Record<string, string> = {
  order_cancelled: 'أُلغي الطلب',
  order_failed: 'تعذّر تنفيذ الطلب',
  order_refunded: 'استُرجع الطلب',
  partial_refund: 'استرجاع جزئي',
};

const day = (iso: string) => new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });

/** The agent's (مندوب) page: their code to share, the people they brought, and their account. */
export default function AgentPage() {
  const t = useT();
  const me = useFetch(() => auth.me(), []);
  const isAgent = !!me.data?.roles?.includes('agent');

  if (me.loading && !me.data) return <Shell><p className="text-sm text-muted">{t('جارٍ التحميل…')}</p></Shell>;
  if (me.error) return <Shell><ErrorBox text={me.error} /></Shell>;
  if (!isAgent) {
    return (
      <Shell>
        <div className="surface rounded-2xl p-6 text-center shadow-card">
          <p className="font-bold">{t('هذه الصفحة للمندوبين فقط.')}</p>
          <Link href="/" className="mt-4 inline-block rounded-xl bg-teal px-5 py-2.5 text-sm font-bold text-white">
            {t('العودة إلى المتجر')}
          </Link>
        </div>
      </Shell>
    );
  }
  return <AgentDashboard />;
}

function Shell({ children }: { children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="mx-auto max-w-page px-4 py-8">
      <h1 className="text-2xl font-extrabold">{t('صفحة المندوب')}</h1>
      <div className="mt-6">{children}</div>
    </div>
  );
}

function ErrorBox({ text }: { text: string }) {
  return <div className="rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">{text}</div>;
}

function AgentDashboard() {
  const t = useT();
  const me = useFetch(() => agentApi.me(), []);
  const commissions = useFetch(() => agentApi.commissions(), []);
  const referrals = useFetch(() => agentApi.referrals(), []);
  const [tab, setTab] = useState<'commissions' | 'referrals'>('commissions');

  if (me.loading && !me.data) return <Shell><p className="text-sm text-muted">{t('جارٍ التحميل…')}</p></Shell>;
  if (me.error || !me.data) return <Shell><ErrorBox text={me.error ?? t('حدث خطأ غير متوقّع.')} /></Shell>;

  const a = me.data;
  const s = a.statement;
  const cur = s.currency;
  const rule =
    a.rule.type === 'PERCENT'
      ? t('عمولتك {value}% من صافي كل طلب مكتمل', { value: num(a.rule.value, Number(a.rule.value) % 1 ? 2 : 0) })
      : t('عمولتك {amount} عن كل طلب مكتمل', { amount: money(a.rule.value, cur) });
  const due = Number(s.balanceDue);

  return (
    <Shell>
      {!a.isActive && (
        <div className="mb-4 rounded-xl border border-warn/30 bg-warn/10 px-4 py-3 text-sm text-warn">
          {t('حسابك كمندوب موقوف حاليًا: الزبائن الجدد لا يُحسبون لك. تواصل مع المتجر.')}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="surface rounded-2xl p-5 shadow-card lg:col-span-2">
          <h2 className="text-sm font-bold text-muted">{t('رمز الإحالة الخاص بك')}</h2>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
            <span dir="ltr" className="font-mono text-3xl font-extrabold tracking-[0.2em] text-teal">
              {a.code}
            </span>
            <CopyButton value={a.code} label={t('نسخ الرمز')} />
          </div>
          <p className="mt-3 text-sm text-muted">{rule}</p>
          <ShareRow sharePath={a.sharePath} shareLink={a.shareLink} />
        </section>

        <section className="surface rounded-2xl p-5 shadow-card">
          <h2 className="text-sm font-bold text-muted">{t('المستحق لك الآن')}</h2>
          <div className={'tnum mt-2 text-3xl font-extrabold ' + (due < 0 ? 'text-bad' : 'text-teal')}>{money(s.balanceDue, cur)}</div>
          {Number(s.clawback.open) > 0 && (
            <p className="mt-2 text-xs text-bad">
              {t('يشمل خصم {amount} عن طلبات استُرجعت بعد الدفع.', { amount: money(s.clawback.open, cur) })}
            </p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[rgb(var(--line))] pt-4 text-center">
            <Stat label={t('زبائن جلبتهم')} value={num(a.counts.referrals)} />
            <Stat label={t('طلبات مدفوعة')} value={num(a.counts.paidOrders)} />
          </div>
        </section>
      </div>

      <section className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label={t('قيد الانتظار')} hint={t('{n} طلب لم يكتمل بعد', { n: s.pending.count })} value={money(s.pending.amount, cur)} />
        <Tile label={t('مستحقة')} hint={t('{n} طلب مكتمل', { n: s.earned.count })} value={money(s.earned.amount, cur)} />
        <Tile label={t('مدفوعة')} hint={t('{n} دفعة', { n: s.payouts.count })} value={money(s.payouts.total, cur)} />
        <Tile label={t('ملغاة')} hint={t('{n} طلب', { n: s.void.count })} value={num(s.void.count)} />
      </section>

      <div className="mt-6 flex gap-2" role="tablist">
        {(['commissions', 'referrals'] as const).map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={
              'rounded-xl px-4 py-2 text-sm font-bold ' +
              (tab === k ? 'bg-teal text-white' : 'border border-[rgb(var(--line))] text-muted')
            }
          >
            {k === 'commissions' ? t('العمولات') : t('الزبائن')}
          </button>
        ))}
      </div>

      {tab === 'commissions' && (
        <section className="mt-3 space-y-2">
          {commissions.error && <ErrorBox text={commissions.error} />}
          {commissions.data?.length === 0 && <Empty text={t('لا عمولات بعد. شارك رابطك لتبدأ.')} />}
          {commissions.data?.map((c) => (
            <div key={c.id} className="surface flex items-start justify-between gap-3 rounded-2xl p-4 shadow-card">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{c.customer || t('زبون')}</span>
                  <span dir="ltr" className="text-xs text-muted">{c.order}</span>
                </div>
                <div className="mt-1 text-xs text-muted">{day(c.createdAt)}</div>
                {c.status === 'VOID' && c.voidReason && (
                  <div className="mt-1 text-xs text-muted">{t(REASON[c.voidReason] ?? c.voidReason)}</div>
                )}
                {c.clawbackAmount && Number(c.clawbackAmount) > 0 && (
                  <div className="mt-1 text-xs font-bold text-bad">
                    {t('استرجاع بعد الدفع: {amount}', { amount: money(c.clawbackAmount, c.currency) })}
                    {c.clawbackReason ? ` · ${t(REASON[c.clawbackReason] ?? c.clawbackReason)}` : ''}
                  </div>
                )}
              </div>
              <div className="flex-none text-end">
                <div className={'tnum font-extrabold ' + (c.status === 'VOID' ? 'text-muted line-through' : '')}>
                  {money(c.amount, c.currency)}
                </div>
                <span className={'mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ' + STATUS[c.status].cls}>
                  {t(STATUS[c.status].label)}
                </span>
              </div>
            </div>
          ))}
        </section>
      )}

      {tab === 'referrals' && (
        <section className="mt-3 space-y-2">
          {referrals.error && <ErrorBox text={referrals.error} />}
          {referrals.data?.length === 0 && <Empty text={t('لم يسجّل أحد برمزك بعد.')} />}
          {referrals.data?.map((r) => (
            <div key={r.n} className="surface flex items-center justify-between gap-3 rounded-2xl p-4 shadow-card">
              <div className="min-w-0">
                <div className="font-bold">{r.name || t('زبون')}</div>
                {r.phone && (
                  <span dir="ltr" className="inline-block text-xs text-muted">
                    {r.phone}
                  </span>
                )}
              </div>
              <div className="flex-none text-end text-xs text-muted">
                <div>{t('انضمّ {date}', { date: day(r.joinedAt) })}</div>
                <div className="mt-0.5 font-bold">{t('{n} طلب', { n: r.orders })}</div>
              </div>
            </div>
          ))}
        </section>
      )}
    </Shell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="tnum text-xl font-extrabold">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="surface rounded-2xl p-4 shadow-card">
      <div className="text-xs font-bold text-muted">{label}</div>
      <div className="tnum mt-1 text-lg font-extrabold">{value}</div>
      <div className="mt-0.5 text-[11px] text-muted">{hint}</div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-[rgb(var(--line))] px-5 py-8 text-center text-sm text-muted">{text}</div>
  );
}

async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    const el = document.createElement('textarea');
    el.value = value;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    el.remove();
  }
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await copyText(value);
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
      className="inline-flex items-center gap-2 rounded-xl border border-[rgb(var(--line))] px-3 py-2 text-sm font-bold transition hover:border-teal hover:text-teal"
    >
      {done ? <CheckIcon size={16} className="text-teal" /> : <CopyIcon size={16} />}
      {done ? t('نُسخ') : label}
    </button>
  );
}

function ShareRow({ sharePath, shareLink }: { sharePath: string; shareLink: string | null }) {
  const t = useT();
  const link = () => shareLink ?? `${window.location.origin}${sharePath}`;
  const message = () => tNow('تسوّق بطاقات الألعاب والاشتراكات من متجرنا عبر رابطي: {link}', { link: link() });

  async function share() {
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ text: message(), url: link() });
        return;
      } catch (e) {
        if ((e as Error)?.name === 'AbortError') return;
      }
    }
    window.open(`https://wa.me/?text=${encodeURIComponent(message())}`, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="mt-4 flex flex-wrap gap-2 border-t border-[rgb(var(--line))] pt-4">
      <button
        type="button"
        onClick={share}
        className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal px-4 py-2.5 text-sm font-bold text-white sm:flex-none"
      >
        <ShareIcon size={16} />
        {t('مشاركة رابطي')}
      </button>
      <LinkCopy getLink={link} />
    </div>
  );
}

function LinkCopy({ getLink }: { getLink: () => string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await copyText(getLink());
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-[rgb(var(--line))] px-4 py-2.5 text-sm font-bold sm:flex-none"
    >
      {done ? <CheckIcon size={16} className="text-teal" /> : <CopyIcon size={16} />}
      {done ? t('نُسخ الرابط') : t('نسخ الرابط')}
    </button>
  );
}
