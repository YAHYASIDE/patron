'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { searchCountries, type Country } from '@/lib/countries';
import { CloseIcon, SearchIcon } from './icons';

/** WhatsApp number: a searchable country (Mauritania first) and the national number. */
export default function PhoneField({
  country,
  onCountry,
  value,
  onChange,
  autoFocus,
}: {
  country: Country;
  onCountry: (c: Country) => void;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold">رقم واتساب</span>
      {/* number first in the reading order of a phone number: country code on the left */}
      <div
        dir="ltr"
        className="surface-2 hairline flex items-stretch overflow-hidden rounded-xl border focus-within:border-teal"
      >
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={`الدولة: ${country.ar}. تغيير الدولة`}
          className="flex flex-none items-center gap-1.5 border-e border-[rgb(var(--line))] px-3 text-[15px] font-bold transition hover:bg-[rgb(var(--line))]/40"
        >
          <span className="text-xl leading-none">{country.flag}</span>
          <span className="tnum">+{country.dial}</span>
          <span aria-hidden className="text-xs text-muted">
            ▾
          </span>
        </button>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          autoFocus={autoFocus}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={country.iso === 'MR' ? '22 12 34 56' : ''}
          aria-label="رقم واتساب"
          className="min-w-0 flex-1 bg-transparent px-3.5 py-3 text-[16px] tracking-wide outline-none"
        />
      </div>
      {open && (
        <CountrySheet
          onClose={() => setOpen(false)}
          onPick={(c) => {
            onCountry(c);
            setOpen(false);
          }}
          current={country}
        />
      )}
    </div>
  );
}

function CountrySheet({
  onClose,
  onPick,
  current,
}: {
  onClose: () => void;
  onPick: (c: Country) => void;
  current: Country;
}) {
  const [q, setQ] = useState('');
  const list = useMemo(() => searchCountries(q), [q]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', esc);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-950/50 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="اختر الدولة"
        onClick={(e) => e.stopPropagation()}
        className="surface flex max-h-[85dvh] w-full flex-col rounded-t-3xl shadow-float sm:max-w-md sm:rounded-3xl"
      >
        <div className="flex items-center justify-between px-5 pt-4">
          <h2 className="text-base font-extrabold">اختر دولتك</h2>
          <button
            onClick={onClose}
            aria-label="إغلاق"
            className="grid h-9 w-9 place-items-center rounded-xl text-muted hover:bg-[rgb(var(--surface-2))]"
          >
            <CloseIcon size={18} />
          </button>
        </div>
        <label className="surface-2 mx-5 mt-3 flex items-center gap-2 rounded-xl px-3.5 py-2.5">
          <SearchIcon size={17} className="text-muted" />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث عن دولتك أو رمزها"
            aria-label="ابحث عن دولتك"
            className="w-full bg-transparent text-[15px] outline-none"
          />
        </label>
        <ul className="mt-2 flex-1 overflow-y-auto px-2 pb-4">
          {list.map((c) => (
            <li key={c.iso}>
              <button
                onClick={() => onPick(c)}
                className={
                  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-start transition hover:bg-[rgb(var(--surface-2))] ' +
                  (c.iso === current.iso ? 'bg-teal/[0.07] font-bold' : '')
                }
              >
                <span className="text-2xl leading-none">{c.flag}</span>
                <span className="flex-1 text-[15px]">{c.ar}</span>
                <span dir="ltr" className="tnum text-sm text-muted">
                  +{c.dial}
                </span>
              </button>
            </li>
          ))}
          {list.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-muted">لا توجد دولة بهذا الاسم.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
