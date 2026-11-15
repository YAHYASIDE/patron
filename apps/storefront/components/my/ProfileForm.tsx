'use client';

import { useState } from 'react';
import { ApiError, me as meApi } from '@/lib/api';
import type { Me } from '@/lib/types';
import { COUNTRIES } from '@/lib/countries';
import { CURRENCIES, getCurrency, setCurrency, useCurrency } from '@/lib/currency';
import { refreshMe } from '@/lib/session';
import { setCountry as setShopCountry } from '@/lib/regions';
import { LANGS, setLang, useLang, useT, tNow, type Lang } from '@/lib/i18n';
import { CheckIcon } from '@/components/icons';

// The API takes letters and spaces (Arabic or Latin), up to 60.
const CITY = /^[\p{L}\p{M}\s]{1,60}$/u;

const field =
  'surface-2 hairline mt-1.5 w-full min-w-0 rounded-xl border px-3 py-2.5 text-[15px] outline-none focus:border-teal';

/**
 * Where the customer lives and how the shop speaks to them (#9): country and
 * city, language and currency, kept on the account. Language and currency
 * start from what the shop shows now, so saving never surprises.
 */
export default function ProfileForm({ me, onSaved }: { me: Me; onSaved?: () => void }) {
  const t = useT();
  const lang = useLang();
  const shownCurrency = useCurrency();
  const [country, setCountry] = useState(me.country ?? '');
  const [city, setCity] = useState(me.city ?? '');
  const [locale, setLocale] = useState<Lang>(lang);
  const [currency, setCur] = useState(shownCurrency);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const c = city.trim().replace(/\s+/g, ' ');
    if (c && !CITY.test(c)) return setError(tNow('اكتب اسم المدينة بالحروف فقط.'));
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await meApi.updateProfile({
        ...(country && { country }),
        ...(c && { city: c }),
        locale,
        defaultCurrency: currency,
      });
      refreshMe();
      // the shop's prices and payment methods follow the country saved here
      if (country) setShopCountry(country);
      onSaved?.();
      if (currency !== getCurrency()) await setCurrency(currency).catch(() => undefined);
      if (locale !== lang) return setLang(locale); // reloads the page in the new language
      setSaved(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 400
          ? tNow('تعذّر حفظ بياناتك. تحقّق منها وحاول مجددًا.')
          : err instanceof ApiError && err.status === 0
            ? err.message
            : tNow('تعذّر الحفظ الآن. حاول بعد قليل.'),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="surface rounded-2xl p-5 shadow-card">
      <h2 className="text-base font-bold">{t('بياناتي')}</h2>
      <p className="mt-0.5 text-sm text-muted">{t('تساعدنا على عرض وسائل الدفع والأسعار المناسبة لبلدك.')}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block min-w-0">
          <span className="text-sm font-semibold">{t('الدولة')}</span>
          <select value={country} onChange={(e) => setCountry(e.target.value)} className={field}>
            <option value="">{t('اختر دولتك')}</option>
            {COUNTRIES.map((c) => (
              <option key={c.iso} value={c.iso}>
                {c.flag} {c[lang]}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0">
          <span className="text-sm font-semibold">{t('المدينة')}</span>
          <input
            value={city}
            onChange={(e) => setCity(e.target.value.slice(0, 60))}
            placeholder={t('مثال: نواكشوط')}
            autoComplete="address-level2"
            className={field}
          />
        </label>
        <label className="block min-w-0">
          <span className="text-sm font-semibold">{t('اللغة')}</span>
          <select value={locale} onChange={(e) => setLocale(e.target.value as Lang)} className={field}>
            {LANGS.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0">
          <span className="text-sm font-semibold">{t('العملة')}</span>
          <select value={currency} onChange={(e) => setCur(e.target.value)} className={field}>
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {t(c.label) === c.code ? c.code : `${t(c.label)} (${c.code})`}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-bad">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className="btn-brand rounded-xl px-5 py-2.5 text-sm font-bold disabled:opacity-60">
          {busy ? t('جارٍ الحفظ…') : t('حفظ')}
        </button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-sm font-bold text-ok">
            <CheckIcon size={15} /> {t('تم الحفظ')}
          </span>
        )}
      </div>
    </form>
  );
}
