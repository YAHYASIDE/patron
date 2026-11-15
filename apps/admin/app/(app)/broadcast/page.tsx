'use client';

import { useState } from 'react';
import { api, ApiError, NOT_READY } from '@/lib/api';
import { num } from '@/lib/format';
import { MAIN_COUNTRIES, countryName, flagOf } from '@/lib/countries';
import Notice from '@/components/Notice';

type Lang = 'ar' | 'fr' | 'en';
type Texts = Record<Lang, { title: string; body: string }>;

const LANGS: { id: Lang; label: string; dir: 'rtl' | 'ltr' }[] = [
  { id: 'ar', label: 'العربية', dir: 'rtl' },
  { id: 'fr', label: 'Français', dir: 'ltr' },
  { id: 'en', label: 'English', dir: 'ltr' },
];
const MAX_TITLE = 80;
const MAX_BODY = 500;

const field =
  'surface-2 hairline w-full min-w-0 rounded-xl border px-3.5 py-2.5 text-[15px] outline-none transition focus:border-teal';

function friendly(e: unknown): string {
  if (!(e instanceof ApiError)) return 'تعذّر الاتصال بالخادم.';
  if (e.message === NOT_READY) return NOT_READY;
  if (e.status === 403) return 'ليست لديك صلاحية إرسال الرسائل.';
  return e.message;
}

/** One in-app message to every active customer (or one country), seen in the store's bell. */
export default function BroadcastPage() {
  const [t, setT] = useState<Texts>({
    ar: { title: '', body: '' },
    fr: { title: '', body: '' },
    en: { title: '', body: '' },
  });
  const [more, setMore] = useState(false);
  const [lang, setLang] = useState<Lang>('ar');
  const [country, setCountry] = useState('');
  const [link, setLink] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const set = (l: Lang, k: 'title' | 'body', v: string) => {
    setT((x) => ({ ...x, [l]: { ...x[l], [k]: v } }));
    setMsg(null);
    setConfirming(false);
  };

  const filled = (l: Lang) => t[l].title.trim() && t[l].body.trim();
  const half = (l: Lang) => !!t[l].title.trim() !== !!t[l].body.trim();

  function check(): string | null {
    if (!filled('ar')) return 'اكتب العنوان والنص بالعربية.';
    if (more && (half('fr') || half('en')))
      return 'أكمل العنوان والنص معًا لكل لغة إضافية، أو اتركهما فارغين.';
    if (link.trim() && !/^(\/|https:\/\/)/.test(link.trim()))
      return 'الرابط يبدأ بـ / لصفحة في المتجر، أو بـ https://';
    return null;
  }

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.post<{ sent: number }>('/admin/notifications/broadcast', {
        titleAr: t.ar.title.trim(),
        bodyAr: t.ar.body.trim(),
        ...(more && filled('fr') && { titleFr: t.fr.title.trim(), bodyFr: t.fr.body.trim() }),
        ...(more && filled('en') && { titleEn: t.en.title.trim(), bodyEn: t.en.body.trim() }),
        ...(link.trim() && { link: link.trim() }),
        ...(country && { country }),
      });
      setMsg({ ok: true, text: `أُرسلت الرسالة إلى ${num(res.sent)} زبون.` });
      setT({ ar: { title: '', body: '' }, fr: { title: '', body: '' }, en: { title: '', body: '' } });
      setLink('');
    } catch (e) {
      setMsg({ ok: false, text: friendly(e) });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const shown = LANGS.find((l) => l.id === lang)!;
  const preview = filled(lang) ? t[lang] : t.ar;
  const audience = country ? `زبائن ${countryName(country)}` : 'كل الزبائن النشطين';

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-extrabold">رسالة للزبائن</h1>
        <p className="mt-1 text-sm text-muted">
          إشعار داخل المتجر (الجرس) لكل الزبائن أو لدولة واحدة: عرض جديد، تغيير في المواعيد، تنبيه مهم.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <section className="surface flex flex-col gap-4 rounded-2xl p-5 shadow-card lg:col-span-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">العنوان</span>
            <input
              value={t.ar.title}
              maxLength={MAX_TITLE}
              onChange={(e) => set('ar', 'title', e.target.value)}
              placeholder="مثال: عروض العيد بدأت"
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="flex items-center justify-between text-sm font-semibold">
              النص
              <span className="tnum text-xs font-normal text-muted">
                {t.ar.body.length}/{MAX_BODY}
              </span>
            </span>
            <textarea
              rows={4}
              value={t.ar.body}
              maxLength={MAX_BODY}
              onChange={(e) => set('ar', 'body', e.target.value)}
              placeholder="خصم على بطاقات آيتونز وشدات ببجي حتى نهاية الأسبوع."
              className={field}
            />
          </label>

          <label className="flex items-center gap-2 text-sm font-semibold">
            <input
              type="checkbox"
              checked={more}
              onChange={(e) => {
                setMore(e.target.checked);
                if (!e.target.checked) setLang('ar');
              }}
              className="h-4 w-4 accent-[#0d6d64]"
            />
            أضف نسخة بالفرنسية والإنجليزية (اختياري)
          </label>
          {more && (
            <div className="flex flex-col gap-4 border-s-2 border-teal/30 ps-4">
              {LANGS.filter((l) => l.id !== 'ar').map((l) => (
                <div key={l.id} className="flex flex-col gap-2" dir={l.dir}>
                  <span className="text-sm font-bold">{l.label}</span>
                  <input
                    value={t[l.id].title}
                    maxLength={MAX_TITLE}
                    onChange={(e) => set(l.id, 'title', e.target.value)}
                    placeholder={l.id === 'fr' ? 'Titre' : 'Title'}
                    className={field}
                  />
                  <textarea
                    rows={3}
                    value={t[l.id].body}
                    maxLength={MAX_BODY}
                    onChange={(e) => set(l.id, 'body', e.target.value)}
                    placeholder={l.id === 'fr' ? 'Message' : 'Message'}
                    className={field}
                  />
                </div>
              ))}
              <p className="text-xs text-muted">من يستخدم المتجر بلغة بلا نسخة يرى النص العربي.</p>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-sm font-semibold">إلى</span>
              <select
                value={country}
                onChange={(e) => {
                  setCountry(e.target.value);
                  setConfirming(false);
                }}
                className={field}
              >
                <option value="">كل الدول</option>
                {MAIN_COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {flagOf(c)} {countryName(c)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-w-0 flex-col gap-1.5">
              <span className="text-sm font-semibold">رابط (اختياري)</span>
              <input
                value={link}
                onChange={(e) => setLink(e.target.value)}
                dir="ltr"
                placeholder="/products?offers=1"
                className={field}
              />
            </label>
          </div>
        </section>

        <section className="flex flex-col gap-3 lg:col-span-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-bold">معاينة</h2>
            {more && (
              <div className="flex gap-1">
                {LANGS.map((l) => (
                  <button
                    key={l.id}
                    onClick={() => setLang(l.id)}
                    className={
                      'rounded-full px-2.5 py-1 text-[11px] font-bold ' +
                      (lang === l.id ? 'bg-teal text-white' : 'surface-2 text-muted')
                    }
                  >
                    {l.id.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div
            className="surface flex gap-3 rounded-2xl p-4 shadow-card"
            dir={filled(lang) ? shown.dir : 'rtl'}
          >
            <span
              className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-teal/12 text-teal"
              aria-hidden
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" />
                <path d="M10 20a2 2 0 0 0 4 0" />
              </svg>
            </span>
            <div className="min-w-0">
              <div className="break-words font-bold">{preview.title || 'العنوان'}</div>
              <p className="mt-0.5 whitespace-pre-line break-words text-sm text-muted">
                {preview.body || 'نص الرسالة…'}
              </p>
            </div>
          </div>
          <p className="text-xs text-muted">هكذا تظهر في قائمة الإشعارات عند الزبون.</p>

          {msg && <Notice text={msg.text} tone={msg.ok ? 'ok' : 'bad'} />}

          {!confirming ? (
            <button
              onClick={() => {
                const err = check();
                if (err) setMsg({ ok: false, text: err });
                else setConfirming(true);
              }}
              className="rounded-xl bg-teal py-3 text-sm font-bold text-white transition hover:bg-teal-deep"
            >
              إرسال…
            </button>
          ) : (
            <div className="flex flex-col gap-3 rounded-2xl border border-warn/40 bg-warn/10 p-4">
              <p className="text-sm font-semibold text-warn">
                سترسل هذه الرسالة إلى {audience}. لا يمكن سحبها بعد الإرسال. متأكد؟
              </p>
              <div className="flex gap-2">
                <button
                  onClick={send}
                  disabled={busy}
                  className="flex-1 rounded-xl bg-teal py-2.5 text-sm font-bold text-white hover:bg-teal-deep disabled:opacity-60"
                >
                  {busy ? 'جارٍ الإرسال…' : 'نعم، أرسل'}
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  disabled={busy}
                  className="hairline rounded-xl border px-5 py-2.5 text-sm font-bold text-muted"
                >
                  تراجع
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
