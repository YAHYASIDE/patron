'use client';

import { useEffect, useState } from 'react';
import PhoneField from '@/components/PhoneField';
import { DEFAULT_COUNTRY, nationalNumberProblem, toE164 } from '@/lib/countries';
import { useT } from '@/lib/i18n';

export const authField =
  'surface-2 hairline w-full rounded-xl border px-3.5 py-3 text-[16px] outline-none transition focus:border-teal';

export type ContactValue = { value: string; problem: string | null };

/**
 * A phone number (default: phone-first) or, on request, an email. Reports the
 * E.164 number or the lower-cased email, with a problem to show if it is not
 * usable yet.
 */
export default function ContactField({
  onChange,
  autoFocus,
  initialMode = 'phone',
}: {
  onChange: (v: ContactValue) => void;
  autoFocus?: boolean;
  initialMode?: 'phone' | 'email';
}) {
  const t = useT();
  const [mode, setMode] = useState<'phone' | 'email'>(initialMode);
  const [country, setCountry] = useState(DEFAULT_COUNTRY);
  const [number, setNumber] = useState('');
  const [email, setEmail] = useState('');

  useEffect(() => {
    if (mode === 'phone') {
      onChange({ value: toE164(country, number), problem: nationalNumberProblem(country, number) });
    } else {
      const v = email.trim().toLowerCase();
      onChange({ value: v, problem: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : t('تحقّق من البريد الإلكتروني.') });
    }
    // onChange is a fresh closure each render; the inputs are what matter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, country, number, email]);

  return (
    <div className="flex flex-col gap-1.5">
      {mode === 'phone' ? (
        <PhoneField country={country} onCountry={setCountry} value={number} onChange={setNumber} autoFocus={autoFocus} />
      ) : (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">{t('البريد الإلكتروني')}</span>
          <input
            type="email"
            dir="ltr"
            autoComplete="email"
            autoFocus={autoFocus}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={authField}
          />
        </label>
      )}
      <button
        type="button"
        onClick={() => setMode(mode === 'phone' ? 'email' : 'phone')}
        className="self-start py-1 text-xs font-bold text-teal hover:underline"
      >
        {mode === 'phone' ? t('استخدم البريد الإلكتروني بدلًا من الرقم') : t('استخدم رقم الهاتف بدلًا من البريد')}
      </button>
    </div>
  );
}

/** The red line under a form. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl border border-bad/30 bg-bad/10 px-3.5 py-2.5 text-sm text-bad">
      {message}
    </p>
  );
}

/** A password input with a show/hide toggle (phones make typos easy). */
export function PasswordInput({
  value,
  onChange,
  label,
  autoComplete,
  hint,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
}) {
  const t = useT();
  const [shown, setShown] = useState(false);
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold">{label}</span>
      {/* left-to-right like the password itself, so the toggle sits at its end */}
      <span dir="ltr" className="relative block">
        <input
          type={shown ? 'text' : 'password'}
          dir="ltr"
          required
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={authField + ' pe-16'}
        />
        <button
          type="button"
          onClick={() => setShown(!shown)}
          className="absolute inset-y-0 end-0 px-3 text-xs font-bold text-muted hover:text-[rgb(var(--text))]"
        >
          {shown ? t('إخفاء') : t('إظهار')}
        </button>
      </span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** Six digits, large, auto-filled from an SMS where the phone allows. */
export function CodeInput({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      inputMode="numeric"
      autoComplete="one-time-code"
      dir="ltr"
      placeholder="••••••"
      aria-label={label}
      className={authField + ' text-center text-2xl font-bold tracking-[0.5em]'}
    />
  );
}
