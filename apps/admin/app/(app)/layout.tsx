'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { isAuthed, logout } from '@/lib/api';

const NAV = [
  { href: '/', label: 'لوحة القيادة', icon: 'grid' },
  { href: '/products', label: 'المنتجات', icon: 'box' },
  { href: '/orders', label: 'الطلبات', icon: 'receipt' },
  { href: '/currencies', label: 'العملات', icon: 'coins' },
  { href: '/settings', label: 'الإعدادات', icon: 'gear' },
] as const;

function Icon({ name }: { name: string }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (name) {
    case 'grid':
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
      );
    case 'box':
      return (
        <svg {...common}>
          <path d="M21 8 12 3 3 8l9 5 9-5Z" />
          <path d="M3 8v8l9 5 9-5V8" />
          <path d="M12 13v8" />
        </svg>
      );
    case 'receipt':
      return (
        <svg {...common}>
          <path d="M5 3v18l2-1 2 1 2-1 2 1 2-1 2 1V3l-2 1-2-1-2 1-2-1-2 1-2-1Z" />
          <path d="M9 8h6M9 12h6" />
        </svg>
      );
    case 'coins':
      return (
        <svg {...common}>
          <ellipse cx="8" cy="7" rx="5" ry="3" />
          <path d="M3 7v5c0 1.7 2.2 3 5 3" />
          <ellipse cx="16" cy="14" rx="5" ry="3" />
          <path d="M11 14v4c0 1.7 2.2 3 5 3s5-1.3 5-3v-4" />
        </svg>
      );
    case 'gear':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.3a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0-1.1-2.7H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 2.7 7a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 7 2.7h.1A1.6 1.6 0 0 0 9 1.1V1a2 2 0 1 1 4 0v.1A1.6 1.6 0 0 0 17 2.7a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V7Z" />
        </svg>
      );
    default:
      return <svg {...common} />;
  }
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!isAuthed()) {
      router.replace('/login');
    } else {
      setReady(true);
    }
  }, [router]);

  if (!ready) {
    return (
      <div className="grid min-h-[100dvh] place-items-center text-sm text-muted">
        جارٍ التحميل…
      </div>
    );
  }

  function onLogout() {
    logout();
    router.replace('/login');
  }

  const SidebarInner = (
    <>
      <div className="flex h-16 items-center gap-3 px-5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-teal-soft to-teal text-[16px] font-extrabold text-teal-ink">
          P
        </span>
        <span className="text-lg font-extrabold">
          باترون<span className="text-gold">.</span>
        </span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className={
                'flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-semibold transition ' +
                (active
                  ? 'bg-teal/12 text-teal'
                  : 'text-muted hover:bg-[rgb(var(--surface-2))] hover:text-[rgb(var(--text))]')
              }
            >
              <Icon name={item.icon} />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <button
        onClick={onLogout}
        className="m-3 flex items-center justify-center gap-2 rounded-xl border border-[rgb(var(--line))] py-2.5 text-sm font-semibold text-muted transition hover:text-bad"
      >
        تسجيل الخروج
      </button>
    </>
  );

  return (
    <div className="min-h-[100dvh]">
      {/* desktop sidebar */}
      <aside className="surface fixed inset-y-0 start-0 z-30 hidden w-64 flex-col border-0 border-e border-[rgb(var(--line))] lg:flex">
        {SidebarInner}
      </aside>

      {/* mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} />
          <aside className="surface absolute inset-y-0 start-0 flex w-64 flex-col">
            {SidebarInner}
          </aside>
        </div>
      )}

      <div className="lg:ps-64">
        <header className="surface sticky top-0 z-20 flex h-16 items-center gap-3 border-0 border-b border-[rgb(var(--line))] px-4">
          <button
            className="grid h-10 w-10 place-items-center rounded-lg surface-2 lg:hidden"
            onClick={() => setOpen(true)}
            aria-label="القائمة"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="text-sm text-muted">لوحة تحكم المتجر</div>
          <div className="ms-auto flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-teal/15 text-sm font-bold text-teal">
              A
            </span>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      </div>
    </div>
  );
}
