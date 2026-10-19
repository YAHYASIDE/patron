'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { isAuthed, me } from '@/lib/api';
import { useFetch } from '@/lib/hooks';
import type { SupportTicket } from '@/lib/types';
import { useT } from '@/lib/i18n';
import TicketForm from '@/components/my/TicketForm';
import { day, dayTime } from '@/components/my/when';

const STATUS: Record<SupportTicket['status'], { t: string; c: string }> = {
  OPEN: { t: 'بانتظار الرد', c: 'bg-warn/12 text-warn' },
  ANSWERED: { t: 'تم الرد', c: 'bg-ok/12 text-ok' },
  CLOSED: { t: 'مغلق', c: 'bg-ink-400/15 text-muted' },
};

/** "طلبات الدعم" (#16): the customer's requests and the shop's replies; a new one from here too. */
export default function SupportPage() {
  const router = useRouter();
  const t = useT();
  useEffect(() => {
    if (!isAuthed()) router.replace('/login?next=/support');
  }, [router]);

  const res = useFetch<SupportTicket[]>(() => me.tickets(), []);
  const [writing, setWriting] = useState(false);

  return (
    <div className="mx-auto max-w-[760px] px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-extrabold">{t('طلبات الدعم')}</h1>
        {!writing && (
          <button onClick={() => setWriting(true)} className="btn-brand rounded-xl px-4 py-2 text-sm font-bold">
            {t('طلب جديد')}
          </button>
        )}
      </div>
      <p className="mt-1 text-sm text-muted">{t('لمشكلة في طلب معيّن، افتح الطلب واضغط «مشكلة في الطلب؟».')}</p>

      {writing && (
        <div className="surface mt-5 rounded-2xl p-4 shadow-card">
          <TicketForm onSent={res.reload} onCancel={() => setWriting(false)} />
        </div>
      )}

      {res.loading && <p className="mt-6 text-sm text-muted">{t('جارٍ التحميل…')}</p>}
      {res.error && (
        <div className="mt-6 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
          {t('تعذّر تحميل طلباتك الآن. حاول بعد قليل.')}
        </div>
      )}
      {!res.loading && !res.error && (res.data?.length ?? 0) === 0 && (
        <div className="mt-8 rounded-2xl border border-[rgb(var(--line))] p-10 text-center text-muted">
          {t('لا توجد طلبات دعم بعد.')}
        </div>
      )}

      <div className="mt-5 space-y-3">
        {res.data?.map((tk) => {
          const s = STATUS[tk.status] ?? { t: tk.status, c: 'bg-ink-400/15 text-muted' };
          return (
            <article key={tk.id} className="surface rounded-2xl p-4 shadow-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-bold">{t(tk.subject)}</h2>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    <span>{day(tk.createdAt)}</span>
                    {tk.orderId && tk.orderNumber && (
                      <>
                        <span aria-hidden>·</span>
                        <Link href={`/orders/${tk.orderId}`} dir="ltr" className="font-semibold hover:text-teal">
                          {tk.orderNumber}
                        </Link>
                      </>
                    )}
                  </div>
                </div>
                <span className={`flex-none rounded-full px-2.5 py-1 text-xs font-bold ${s.c}`}>{t(s.t)}</span>
              </div>
              <p className="mt-3 whitespace-pre-line break-words text-sm">{tk.message}</p>
              {tk.reply ? (
                <div className="mt-3 rounded-xl border-s-4 border-teal bg-teal/[0.06] p-3">
                  <div className="text-xs font-bold text-teal">
                    {t('ردّ المتجر')}
                    {tk.repliedAt && <span className="font-normal text-muted"> · {dayTime(tk.repliedAt)}</span>}
                  </div>
                  <p className="mt-1 whitespace-pre-line break-words text-sm">{tk.reply}</p>
                </div>
              ) : (
                tk.status === 'OPEN' && <p className="mt-3 text-xs text-muted">{t('سنردّ عليك قريبًا.')}</p>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
