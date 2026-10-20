'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCart } from '@/lib/hooks';
import { isAuthed } from '@/lib/api';
import { useT } from '@/lib/i18n';
import { CartIcon, MenuIcon, CloseIcon, UserIcon, HomeIcon, GridIcon } from './icons';
import { BagIcon, BellIcon, ChatIcon, HeartIcon, KeyIcon, WalletIcon } from './my/icons';
import ThemeToggle from './ThemeToggle';
import CurrencySwitch from './CurrencySwitch';
import NotificationBell from './NotificationBell';
import BrandMark from './BrandMark';

type Entry = { href: string; label: string; icon: (p: { size?: number; className?: string }) => React.ReactNode };

const NAV: Entry[] = [
  { href: '/', label: 'الرئيسية', icon: HomeIcon },
  { href: '/products', label: 'كل المنتجات', icon: GridIcon },
  { href: '/orders', label: 'طلباتي', icon: BagIcon },
];

// the customer's own pages
const ACCOUNT: Entry[] = [
  { href: '/account', label: 'حسابي', icon: UserIcon },
  { href: '/codes', label: 'أكوادي', icon: KeyIcon },
  { href: '/favorites', label: 'المفضّلة', icon: HeartIcon },
  { href: '/notifications', label: 'الإشعارات', icon: BellIcon },
  { href: '/wallet', label: 'المحفظة', icon: WalletIcon },
  { href: '/support', label: 'الدعم', icon: ChatIcon },
];
// a guest keeps hearts in this browser, so the favourites page works without an account
const GUEST: Entry[] = [
  { href: '/favorites', label: 'المفضّلة', icon: HeartIcon },
  { href: '/login', label: 'تسجيل الدخول', icon: UserIcon },
];

/** The page a link belongs to: "/orders/123" is still "طلباتي". */
const isHere = (pathname: string, href: string) =>
  href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

// icon buttons shrink a little under 360px so the bar fits a 320px phone
const ICON =
  'grid h-9 w-9 min-[360px]:h-10 min-[360px]:w-10 place-items-center rounded-xl text-muted transition hover:bg-[rgb(var(--surface-2))] hover:text-[rgb(var(--text))]';
const ITEM =
  'flex min-h-11 items-center gap-3 rounded-xl px-2.5 text-[15px] font-semibold text-muted transition hover:bg-[rgb(var(--surface-2))] hover:text-[rgb(var(--text))]';
const HERE = 'bg-teal/10 !text-teal';

/** One menu row: an icon in a soft tile, then the label. */
function MenuLink({ entry, here, role }: { entry: Entry; here: boolean; role?: string }) {
  const t = useT();
  const Icon = entry.icon;
  return (
    <Link href={entry.href} role={role} aria-current={here ? 'page' : undefined} className={`${ITEM} ${here ? HERE : ''}`}>
      <span className="grid h-8 w-8 flex-none place-items-center rounded-lg bg-[rgb(var(--surface-2))]">
        <Icon size={18} />
      </span>
      <span className="min-w-0 truncate">{t(entry.label)}</span>
    </Link>
  );
}

/** Wide screens: the person icon opens the account pages. */
function AccountMenu({ authed }: { authed: boolean }) {
  const t = useT();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => box.current && !box.current.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const links = authed ? ACCOUNT : GUEST;
  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={authed ? t('حسابي') : t('تسجيل الدخول')}
        className={ICON}
      >
        <UserIcon size={20} />
      </button>
      {open && (
        <nav role="menu" className="surface absolute end-0 top-full z-50 mt-2 w-56 rounded-2xl p-1.5 shadow-float">
          {links.map((l) => (
            <MenuLink key={l.href} entry={l} role="menuitem" here={isHere(pathname, l.href)} />
          ))}
        </nav>
      )}
    </div>
  );
}

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
      <div className="mx-auto flex h-16 max-w-page items-center gap-2 px-4 min-[360px]:gap-3">
        <Link href="/" className="flex flex-none items-center gap-2 min-[360px]:gap-2.5">
          <BrandMark id="hdr" className="h-8 w-8 min-[360px]:h-9 min-[360px]:w-9" />
          <span dir="ltr" className="text-lg font-extrabold">
            patron
            <span className="text-gold">.</span>
          </span>
        </Link>

        <nav className="ms-4 hidden items-center gap-1 lg:flex">
          {NAV.map((n) => (
            <Link
              key={n.label}
              href={n.href}
              aria-current={isHere(pathname, n.href) ? 'page' : undefined}
              className={`rounded-lg px-3 py-2 text-[15px] font-semibold transition hover:bg-[rgb(var(--surface-2))] hover:text-[rgb(var(--text))] ${
                isHere(pathname, n.href) ? 'text-teal' : 'text-muted'
              }`}
            >
              {t(n.label)}
            </Link>
          ))}
        </nav>

        <div className="ms-auto flex min-w-0 items-center gap-0.5 min-[360px]:gap-1">
          <CurrencySwitch />
          {/* phones: the theme toggle and the account pages live in the menu, so the bar fits 320px */}
          <div className="hidden sm:block">
            <ThemeToggle />
          </div>
          <NotificationBell className="h-9 w-9 min-[360px]:h-10 min-[360px]:w-10" />
          <div className="hidden sm:block">
            <AccountMenu authed={authed} />
          </div>
          <Link href="/cart" aria-label={t('السلّة')} className={`relative ${ICON}`}>
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
            aria-expanded={open}
            className={`${ICON} lg:hidden`}
          >
            {open ? <CloseIcon size={20} /> : <MenuIcon size={20} />}
          </button>
        </div>
      </div>

      {open && (
        <nav className="max-h-[calc(100dvh-4rem)] overflow-y-auto border-t border-[rgb(var(--line))] bg-[rgb(var(--surface))] px-4 pb-3 pt-2 shadow-float lg:hidden">
          <div className="grid gap-0.5">
            {NAV.map((n) => (
              <MenuLink key={n.label} entry={n} here={isHere(pathname, n.href)} />
            ))}
          </div>
          <div className="my-2 border-t border-[rgb(var(--line))]" />
          <div className="grid grid-cols-2 gap-0.5 gap-x-2">
            {(authed ? ACCOUNT : GUEST).map((n) => (
              <MenuLink key={n.href} entry={n} here={isHere(pathname, n.href)} />
            ))}
          </div>
          <div className="mt-2 flex min-h-11 items-center justify-between border-t border-[rgb(var(--line))] px-2.5 pt-2 sm:hidden">
            <span className="text-[15px] font-semibold text-muted">{t('الوضع الليلي')}</span>
            <ThemeToggle />
          </div>
        </nav>
      )}
    </header>
  );
}
