'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Brand } from '@/lib/brands';
import { money } from '@/lib/format';
import { useT } from '@/lib/i18n';
import { report } from '@/lib/events';
import { filterBrands } from './BrandGrid';
import { SearchIcon } from './icons';

const MAX = 6;
/** A search that matches no brand for this long (typing has stopped) is reported to the owner. */
const MISS_AFTER_MS = 1500;

/**
 * A search box that suggests brands while typing (a combobox: arrows move,
 * Enter opens the highlighted brand, Escape closes; a tap opens it too).
 * Enter with nothing highlighted is the box's own search (`onSubmit`).
 * The look of the box is the caller's (`className`, `button`).
 */
export default function SearchSuggest({
  brands,
  value,
  onChange,
  onSubmit,
  placeholder,
  className = '',
  button,
}: {
  brands: Brand[];
  value: string;
  onChange: (v: string) => void;
  onSubmit?: (v: string) => void;
  placeholder: string;
  className?: string;
  button?: React.ReactNode;
}) {
  const t = useT();
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);

  const list = useMemo(() => (value.trim() ? filterBrands(brands, null, value).slice(0, MAX) : []), [brands, value]);
  const shown = open && list.length > 0;

  // nothing in the whole catalog for what the visitor typed: tell the owner (once the catalog is in)
  const typed = value.trim().replace(/\s+/g, ' ').slice(0, 100);
  const miss = brands.length > 0 && typed.length >= 2 && list.length === 0;
  useEffect(() => {
    if (!miss) return;
    const timer = setTimeout(() => report('search_miss', typed), MISS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [miss, typed]);

  function go(b: Brand) {
    setOpen(false);
    router.push(`/brands/${b.key}`);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && list.length) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + 1) % list.length);
    } else if (e.key === 'ArrowUp' && list.length) {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a <= 0 ? list.length - 1 : a - 1));
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActive(-1);
    } else if (e.key === 'Enter' && shown && active >= 0) {
      e.preventDefault();
      go(list[active]);
    }
  }

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        setOpen(false);
        onSubmit?.(value.trim());
        input.current?.blur();
      }}
      className={`relative ${className}`}
    >
      <SearchIcon size={18} className="flex-none text-muted" />
      <input
        ref={input}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={t('بحث')}
        role="combobox"
        aria-expanded={shown}
        aria-controls={`${id}-list`}
        aria-autocomplete="list"
        aria-activedescendant={shown && active >= 0 ? `${id}-${active}` : undefined}
        enterKeyHint="search"
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
      />
      {button}
      {shown && (
        <ul
          id={`${id}-list`}
          role="listbox"
          aria-label={t('اقتراحات')}
          className="surface absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-2xl p-1.5 shadow-float"
        >
          {list.map((b, i) => {
            const from = b.products[0];
            return (
              <li
                key={b.key}
                id={`${id}-${i}`}
                role="option"
                aria-selected={i === active}
                // keep the focus in the box so the tap lands before the list closes
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(b)}
                onMouseEnter={() => setActive(i)}
                className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl px-2 py-1.5 ${
                  i === active ? 'bg-[rgb(var(--surface-2))]' : ''
                }`}
              >
                <span className="h-9 w-9 flex-none overflow-hidden rounded-lg bg-[rgb(var(--surface-2))]">
                  {b.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={b.image} alt="" className="h-full w-full object-cover" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold">{b.title}</span>
                  {from && (
                    <span className="block text-xs text-muted">
                      {t('من')} <span className="tnum font-bold text-teal">{money(from.sellPrice, from.currency)}</span>
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </form>
  );
}
