'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthed, me } from '@/lib/api';
import type { AppNotification } from '@/lib/types';
import { useT, useLang, type Lang } from '@/lib/i18n';
import { ChevronIcon } from '@/components/icons';
import { dayTime } from '@/components/my/when';
import { UNREAD_EVENT } from '@/components/NotificationBell';

const LIMIT = 20;

function textOf(n: AppNotification, lang: Lang) {
  if (lang === 'ar') return { title: n.titleAr || n.titleEn, body: n.bodyAr || n.bodyEn };
  if (lang === 'fr' && n.data?.fr) return { title: n.data.fr.title, body: n.data.fr.body };
  return { title: n.titleEn || n.titleAr, body: n.bodyEn || n.bodyAr };
}

/** Where a notification leads: its own link (in-store paths only), else its order, product or ticket. */
function linkOf(n: AppNotification): string | null {
  const d = n.data ?? {};
  if (d.link && d.link.startsWith('/') && !d.link.startsWith('//')) return d.link;
  if (d.orderId) return `/orders/${d.orderId}`;
  if (d.productId) return `/products/${d.productId}`;
  if (d.type === 'support.reply') return '/support';
  return null;
}

const TONE: Record<string, string> = {
  'order.paid': 'bg-ok',
  'order.delivered': 'bg-ok',
  'payment.rejected': 'bg-bad',
  'order.failed': 'bg-bad',
  'order.cancelled': 'bg-bad',
  'refund.processed': 'bg-ok',
  'support.reply': 'bg-teal',
  'watch.price': 'bg-gold',
  'watch.stock': 'bg-gold',
};

/** The notifications centre (#13): newest first, read on open, every one leading to its order or product. */
export default function NotificationsPage() {
  const router = useRouter();
  const t = useT();
  const lang = useLang();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isAuthed()) router.replace('/login?next=/notifications');
  }, [router]);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setError(false);
    try {
      const r = await me.notifications(p, LIMIT);
      setItems((prev) => (p === 1 ? r.data : [...prev, ...r.data.filter((x) => !prev.some((y) => y.id === x.id))]));
      setPage(p);
      setPages(r.meta?.pages ?? 1);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthed()) load(1);
  }, [load]);

  function markLocal(ids?: string[]) {
    setItems((list) => list.map((n) => (!ids || ids.includes(n.id) ? { ...n, isRead: true } : n)));
    // the header bell refreshes its count
    window.dispatchEvent(new Event(UNREAD_EVENT));
  }

  async function open(n: AppNotification) {
    if (!n.isRead) {
      markLocal([n.id]);
      me.markRead([n.id]).catch(() => undefined);
    }
    const to = linkOf(n);
    if (to) router.push(to);
  }

  async function readAll() {
    markLocal();
    await me.markRead().catch(() => undefined);
  }

  const unread = items.some((n) => !n.isRead);

  return (
    <div className="mx-auto max-w-[760px] px-4 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-extrabold">{t('الإشعارات')}</h1>
        {unread && (
          <button onClick={readAll} className="text-sm font-bold text-teal hover:underline">
            {t('تحديد الكل كمقروء')}
          </button>
        )}
      </div>

      {error && (
        <div className="mt-6 rounded-xl border border-bad/30 bg-bad/10 px-4 py-3 text-sm text-bad">
          {t('تعذّر تحميل الإشعارات الآن.')}{' '}
          <button onClick={() => load(page)} className="font-bold underline">
            {t('إعادة المحاولة')}
          </button>
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="mt-8 rounded-2xl border border-[rgb(var(--line))] p-10 text-center text-muted">
          {t('لا توجد إشعارات بعد. سنخبرك هنا بكل جديد عن طلباتك.')}
        </div>
      )}

      <ul className="mt-5 space-y-2.5">
        {items.map((n) => {
          const { title, body } = textOf(n, lang);
          const to = linkOf(n);
          return (
            <li key={n.id}>
              <button
                onClick={() => open(n)}
                className={
                  'surface flex w-full items-start gap-3 rounded-2xl p-4 text-start shadow-card transition hover:shadow-float ' +
                  (n.isRead ? '' : 'border-teal/40 bg-teal/[0.04]')
                }
              >
                <span
                  aria-hidden
                  className={`mt-1.5 h-2.5 w-2.5 flex-none rounded-full ${
                    n.isRead ? 'bg-[rgb(var(--line))]' : (TONE[n.data?.type ?? ''] ?? 'bg-teal')
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className={`block ${n.isRead ? 'font-semibold' : 'font-extrabold'}`}>{title}</span>
                  {body && <span className="mt-0.5 block whitespace-pre-line break-words text-sm text-muted">{body}</span>}
                  <span className="mt-1 block text-xs text-muted">
                    {dayTime(n.createdAt)}
                    {!n.isRead && <span className="sr-only"> · {t('غير مقروء')}</span>}
                  </span>
                </span>
                {to && <ChevronIcon size={16} className="mt-1 flex-none text-muted ltr:rotate-180" />}
              </button>
            </li>
          );
        })}
      </ul>

      {loading && <p className="mt-6 text-center text-sm text-muted">{t('جارٍ التحميل…')}</p>}
      {!loading && page < pages && (
        <button
          onClick={() => load(page + 1)}
          className="mt-4 block w-full rounded-xl border border-[rgb(var(--line))] py-2.5 text-sm font-bold text-muted transition hover:text-[rgb(var(--text))]"
        >
          {t('عرض المزيد')}
        </button>
      )}
    </div>
  );
}
