'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCart } from '@/lib/hooks';
import { isAuthed } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { CartIcon, MenuIcon, CloseIcon, UserIcon } from './icons';
import ThemeToggle from './ThemeToggle';
import CurrencySwitch from './CurrencySwitch';

const NAV = [
  { href: '/', label: 'الرئيسية' },
  { href: '/products', label: 'كل المنتجات' },
  { href: '/orders', label: 'طلباتي' },
];

export default function Header() {
  const t = useT();
  const { count } = useCart();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    setAuthed(isAuthed());
  }, [pathname]);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-[rgb(var(--line))] bg-[rgb(var(--surface))]/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-page items-center gap-3 px-4">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-teal-soft to-teal text-[16px] font-extrabold text-teal-ink">
            P
          </span>
          <span className="text-lg font-extrabold">
            {t('باترون')}<span className="text-gold">.</span>
          </span>
        </Link>

        <nav className="ms-4 hidden items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <Link
              key={n.label}
              href={n.href}
              className="rounded-lg px-3 py-2 text-[15px] font-semibold text-muted transition hover:bg-[rgb(var(--surface-2))] hover:text-[rgb(var(--text))]"
            >
              {t(n.label)}
            </Link>
          ))}
        </nav>

        <div className="ms-auto flex items-center gap-1">
          <CurrencySwitch />
          {/* phones: the theme toggle lives in the menu, so the bar fits 360px */}
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>
          <Link
            href={authed ? '/account' : '/login'}
            aria-label={authed ? t('حسابي') : t('تسجيل الدخول')}
            className="grid h-10 w-10 place-items-center rounded-xl text-muted transition hover:bg-[rgb(var(--surface-2))] hover:text-[rgb(var(--text))]"
          >
            <UserIcon size={20} />
          </Link>
          <Link
            href="/cart"
            aria-label={t('السلّة')}
            className="relative grid h-10 w-10 place-items-center rounded-xl text-muted transition hover:bg-[rgb(var(--surface-2))] hover:text-[rgb(var(--text))]"
          >
            <CartIcon size={20} />
            {count > 0 && (
              <span className="absolute -top-0.5 -end-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-teal px-1 text-[11px] font-bold text-white tnum">
                {count}
              </span>
            )}
          </Link>
          <button
            onClick={() => setOpen((o) => !o)}
            aria-label={t('القائمة')}
            className="grid h-10 w-10 place-items-center rounded-xl text-muted hover:bg-[rgb(var(--surface-2))] lg:hidden"
          >
            {open ? <CloseIcon size={20} /> : <MenuIcon size={20} />}
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-t border-[rgb(var(--line))] bg-[rgb(var(--surface))] px-4 py-2 lg:hidden">
          {NAV.map((n) => (
            <Link
              key={n.label}
              href={n.href}
              className="block rounded-lg px-3 py-2.5 text-[15px] font-semibold text-muted transition hover:bg-[rgb(var(--surface-2))] hover:text-[rgb(var(--text))]"
            >
              {t(n.label)}
            </Link>
          ))}
          <div className="flex items-center justify-between px-3 py-1.5 sm:hidden">
            <span className="text-[15px] font-semibold text-muted">{t('الوضع الليلي')}</span>
            <ThemeToggle />
          </div>
        </nav>
      )}
    </header>
  );
}
