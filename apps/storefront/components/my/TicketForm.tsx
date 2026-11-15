'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ApiError, me } from '@/lib/api';
import { useT, tNow } from '@/lib/i18n';
import { CheckIcon } from '@/components/icons';

// The owner reads the subject in the dashboard, so it is sent in Arabic; the customer sees it translated.
const ORDER_SUBJECTS = ['لم يصلني الكود', 'الكود لا يعمل', 'مشكلة في الدفع', 'أخرى'];
const GENERAL_SUBJECTS = ['سؤال عن منتج', 'مشكلة في الدفع', 'مشكلة في حسابي', 'أخرى'];

/**
 * A support request (#16), from an order page ("مشكلة في الطلب؟") or the
 * support page. The reply comes back on /support and as a notification.
 */
export default function TicketForm({
  orderId,
  orderNumber,
  onSent,
  onCancel,
}: {
  orderId?: string;
  orderNumber?: string;
  onSent?: () => void;
  onCancel?: () => void;
}) {
  const t = useT();
  const subjects = orderId ? ORDER_SUBJECTS : GENERAL_SUBJECTS;
  const [subject, setSubject] = useState(subjects[0]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = message.trim();
    if (text.length < 5) return setError(tNow('اكتب ما حدث في جملة على الأقل.'));
    setBusy(true);
    setError(null);
    try {
      // "أخرى" alone tells the owner nothing: name the order instead
      const s = subject === 'أخرى' && orderNumber ? `مشكلة في الطلب ${orderNumber}` : subject;
      await me.openTicket({ orderId, subject: s, message: text });
      setSent(true);
      onSent?.();
    } catch (err) {
      setError(
        err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 404
          ? err.message
          : tNow('تعذّر إرسال طلبك الآن. حاول بعد قليل أو راسلنا على واتساب.'),
      );
    } finally {
      setBusy(false);
    }
  }

  if (sent)
    return (
      <div className="rounded-xl bg-ok/10 p-4 text-sm">
        <div className="flex items-center gap-2 font-bold text-ok">
          <CheckIcon size={16} /> {t('وصلنا طلبك')}
        </div>
        <p className="mt-1 text-muted">{t('سنردّ عليك قريبًا، وسيصلك الرد في الإشعارات وفي صفحة الدعم.')}</p>
        {orderId && (
          <Link href="/support" className="mt-2 inline-block font-bold text-teal hover:underline">
            {t('طلبات الدعم')}
          </Link>
        )}
      </div>
    );

  return (
    <form onSubmit={submit} className="space-y-3">
      <fieldset>
        <legend className="text-sm font-bold">{t('ما المشكلة؟')}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {subjects.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={subject === s}
              onClick={() => setSubject(s)}
              className={
                'rounded-full border px-3 py-1.5 text-sm font-bold transition ' +
                (subject === s ? 'border-teal bg-teal/10 text-teal' : 'border-[rgb(var(--line))] text-muted')
              }
            >
              {t(s)}
            </button>
          ))}
        </div>
      </fieldset>
      <label className="block">
        <span className="text-sm font-bold">{t('اشرح لنا ما حدث')}</span>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, 1000))}
          rows={4}
          placeholder={t('مثال: أدخلت الكود في اللعبة وظهرت رسالة خطأ.')}
          className="surface-2 hairline mt-1.5 w-full rounded-xl border px-3 py-2 text-sm outline-none focus:border-teal"
        />
      </label>
      {error && (
        <p role="alert" className="text-sm text-bad">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className="btn-brand rounded-xl px-5 py-2.5 text-sm font-bold disabled:opacity-60">
          {busy ? t('جارٍ الإرسال…') : t('أرسل')}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-xl px-3 py-2.5 text-sm font-bold text-muted">
            {t('إلغاء')}
          </button>
        )}
      </div>
    </form>
  );
}
