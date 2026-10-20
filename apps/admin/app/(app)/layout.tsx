'use client';

import StaffBell from '@/components/StaffBell';
import { useCallback, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { isAuthed, logout } from '@/lib/api';
import WakeBanner from '@/components/WakeBanner';
import ErrorReporter from '@/components/ErrorReporter';
import { usePulse, beep, soundOn, systemNotify, AlertsButton, Toast, type PulseEvent } from '@/components/Pulse';

type NavItem = { href: string; label: string; icon: string };
type NavGroup = { id: string; label: string | null; items: NavItem[] };

/**
 * The side menu, in labelled sections in the order the owner works: the
 * day's operations first, then money, sales, customers, the shop's own
 * content and the system. Sections fold (remembered on this device); the
 * one holding the current page is always open.
 */
const NAV: NavGroup[] = [
  { id: 'home', label: null, items: [{ href: '/', label: 'لوحة القيادة', icon: 'grid' }] },
  {
    id: 'ops',
    label: 'التشغيل',
    items: [
      { href: '/orders', label: 'الطلبات', icon: 'receipt' },
      { href: '/notifications', label: 'مركز الإشعارات', icon: 'bell' },
      { href: '/verifications', label: 'رموز التحقق', icon: 'key' },
      { href: '/support', label: 'طلبات الدعم', icon: 'chat' },
      { href: '/recovery', label: 'استعادة الحسابات', icon: 'lifebuoy' },
    ],
  },
  {
    id: 'money',
    label: 'المالية',
    items: [
      { href: '/bank-notices', label: 'إشعارات البنك', icon: 'bank' },
      { href: '/usdt', label: 'طلبات USDT', icon: 'coins' },
      { href: '/payment-methods', label: 'وسائل الدفع', icon: 'card' },
      { href: '/currencies', label: 'أسعار الصرف', icon: 'exchange' },
    ],
  },
  {
    id: 'sales',
    label: 'المبيعات',
    items: [
      { href: '/reports', label: 'التقارير', icon: 'chart' },
      { href: '/opportunities', label: 'الفرص', icon: 'bulb' },
      { href: '/coupons', label: 'القسائم', icon: 'ticket' },
    ],
  },
  {
    id: 'people',
    label: 'الزبائن',
    items: [
      { href: '/customers', label: 'الزبائن', icon: 'users' },
      { href: '/agents', label: 'المندوبون', icon: 'badge' },
      { href: '/reviews', label: 'التقييمات', icon: 'star' },
      { href: '/broadcast', label: 'رسالة للزبائن', icon: 'megaphone' },
      { href: '/locations', label: 'مواقع الزبائن', icon: 'pin' },
    ],
  },
  {
    id: 'shop',
    label: 'المتجر',
    items: [
      { href: '/products', label: 'المنتجات', icon: 'box' },
      { href: '/banners', label: 'العروض', icon: 'tag' },
    ],
  },
  {
    id: 'system',
    label: 'النظام',
    items: [
      { href: '/settings', label: 'الإعدادات', icon: 'gear' },
      { href: '/activity', label: 'سجل النشاط', icon: 'history' },
      { href: '/errors', label: 'الأخطاء', icon: 'alert' },
    ],
  },
];

// highlight the section on its sub-pages too (e.g. /products/new)
const isActive = (pathname: string, href: string) =>
  href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

const FOLD_KEY = 'patron.nav.folded';

/** Folded sections, remembered on this device. */
function useFolded(): [Set<string>, (id: string) => void] {
  const [folded, setFolded] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(FOLD_KEY) ?? '[]');
      if (Array.isArray(saved)) setFolded(new Set(saved.filter((x): x is string => typeof x === 'string')));
    } catch {
      // nothing saved, or storage blocked: every section open
    }
  }, []);
  const toggle = useCallback((id: string) => {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(FOLD_KEY, JSON.stringify([...next]));
      } catch {
        // storage blocked: the fold lasts until reload
      }
      return next;
    });
  }, []);
  return [folded, toggle];
}

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
    case 'chart':
      return (
        <svg {...common}>
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        </svg>
      );
    case 'users':
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.5" />
          <path d="M2.5 20c.8-3.5 3.4-5.5 6.5-5.5s5.7 2 6.5 5.5" />
          <path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c1.8.8 3 2.6 3.5 5.2" />
        </svg>
      );
    case 'card':
      return (
        <svg {...common}>
          <rect x="2.5" y="5" width="19" height="14" rx="2.5" />
          <path d="M2.5 10h19M6.5 15h4" />
        </svg>
      );
    case 'tag':
      return (
        <svg {...common}>
          <path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z" />
          <circle cx="8" cy="8" r="1.5" />
        </svg>
      );
    case 'shield':
      return (
        <svg {...common}>
          <path d="M12 3 4 6v6c0 4.4 3.4 8.1 8 9 4.6-.9 8-4.6 8-9V6l-8-3Z" />
          <path d="m9 12 2 2 4-4" />
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
    case 'pin':
      return (
        <svg {...common}>
          <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" />
          <circle cx="12" cy="9.5" r="2.5" />
        </svg>
      );
    case 'chat':
      return (
        <svg {...common}>
          <path d="M20 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10Z" />
          <path d="M8 8h8M8 12h5" />
        </svg>
      );
    case 'star':
      return (
        <svg {...common}>
          <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z" />
        </svg>
      );
    case 'ticket':
      return (
        <svg {...common}>
          <path d="M3 8a2 2 0 0 0 2-2h14a2 2 0 0 0 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 0-2 2H5a2 2 0 0 0-2-2v-2a2 2 0 0 0 0-4V8Z" />
          <path d="M14 6v12" strokeDasharray="2 2.5" />
        </svg>
      );
    case 'megaphone':
      return (
        <svg {...common}>
          <path d="M3 10v4a1 1 0 0 0 1 1h3l9 5V4L7 9H4a1 1 0 0 0-1 1Z" />
          <path d="M19.5 9a4 4 0 0 1 0 6M7 15l1.5 5" />
        </svg>
      );
    case 'history':
      return (
        <svg {...common}>
          <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
          <path d="M3 3v5h5M12 7v5l3 2" />
        </svg>
      );
    case 'bulb':
      return (
        <svg {...common}>
          <path d="M9 18h6M10 21h4" />
          <path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1V16h5v-.1c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3Z" />
        </svg>
      );
    case 'alert':
      return (
        <svg {...common}>
          <path d="M10.3 4 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0Z" />
          <path d="M12 9.5v4M12 17h.01" />
        </svg>
      );
    case 'bell':
      return (
        <svg {...common}>
          <path d="M6 9a6 6 0 1 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9Z" />
          <path d="M10 20a2.2 2.2 0 0 0 4 0" />
        </svg>
      );
    case 'key':
      return (
        <svg {...common}>
          <circle cx="8" cy="15" r="4" />
          <path d="m11 12 9-9M17 6l2.5 2.5M14.5 8.5 16.5 10.5" />
        </svg>
      );
    case 'lifebuoy':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="3.5" />
          <path d="m5.6 5.6 3.9 3.9M14.5 14.5l3.9 3.9M18.4 5.6l-3.9 3.9M9.5 14.5l-3.9 3.9" />
        </svg>
      );
    case 'bank':
      return (
        <svg {...common}>
          <path d="M3 9.5 12 4l9 5.5M4.5 10v8M9.5 10v8M14.5 10v8M19.5 10v8M3 20.5h18" />
        </svg>
      );
    case 'exchange':
      return (
        <svg {...common}>
          <path d="M4 8h14l-3.5-3.5M20 16H6l3.5 3.5" />
        </svg>
      );
    case 'badge':
      return (
        <svg {...common}>
          <rect x="4" y="3" width="16" height="18" rx="2.5" />
          <circle cx="12" cy="10" r="2.8" />
          <path d="M7.5 17.5c.9-2 2.5-3 4.5-3s3.6 1 4.5 3" />
        </svg>
      );
    case 'chevron':
      return (
        <svg {...common} width={16} height={16}>
          <path d="m6 9 6 6 6-6" />
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
  const [folded, toggleFold] = useFolded();
  // the phone drawer closes with Escape, like any dialog
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);
  const [toast, setToast] = useState<PulseEvent | null>(null);
  const closeToast = useCallback(() => setToast(null), []);
  // new order or transfer while the dashboard is open: sound, toast, browser notification
  const pulse = usePulse(ready, (ev) => {
    if (soundOn()) beep();
    setToast(ev);
    systemNotify(ev, (href) => router.push(href));
  });
  const pendingCodes = pulse?.pendingVerifications ?? 0;
  const badges: Record<string, number> = {
    '/orders': pulse?.pendingTransfers ?? 0,
    '/verifications': pendingCodes,
    '/support': pulse?.openTickets ?? 0,
  };

  useEffect(() => {
    if (!isAuthed()) {
      router.replace('/login');
    } else {
      setReady(true);
    }
  }, [router]);

  if (!ready) {
    return <div className="grid min-h-[100dvh] place-items-center text-sm text-muted">جارٍ التحميل…</div>;
  }

  function onLogout() {
    logout();
    router.replace('/login');
  }

  const SidebarInner = (
    <>
      <div className="flex h-16 flex-none items-center gap-3 px-5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-teal-soft to-teal text-[16px] font-extrabold text-teal-ink">
          P
        </span>
        <span dir="ltr" className="text-lg font-extrabold">
          patron<span className="text-gold">.</span>
        </span>
      </div>
      <nav aria-label="القائمة الرئيسية" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-2">
        {NAV.map((group) => {
          const here = group.items.some((it) => isActive(pathname, it.href));
          const shut = !!group.label && folded.has(group.id) && !here;
          // a folded section still shows that something inside waits
          const waiting = group.items.reduce((n, it) => n + (badges[it.href] ?? 0), 0);
          return (
            <div key={group.id} className={group.label ? 'mt-3' : 'mt-1'}>
              {group.label && (
                <button
                  type="button"
                  onClick={() => toggleFold(group.id)}
                  aria-expanded={!shut}
                  aria-controls={`nav-${group.id}`}
                  disabled={here}
                  className="flex min-h-8 w-full items-center gap-2 rounded-lg px-3 text-xs font-bold text-muted transition hover:text-[rgb(var(--text))] disabled:cursor-default disabled:hover:text-muted"
                >
                  <span>{group.label}</span>
                  {shut && waiting > 0 && (
                    <span className="grid h-4 min-w-4 place-items-center rounded-full bg-warn px-1 text-[10px] font-bold text-white tnum">
                      {waiting}
                    </span>
                  )}
                  {!here && (
                    <span className={`ms-auto opacity-60 transition ${shut ? 'ltr:-rotate-90 rtl:rotate-90' : ''}`}>
                      <Icon name="chevron" />
                    </span>
                  )}
                </button>
              )}
              {!shut && (
                <div id={`nav-${group.id}`} className="flex flex-col gap-0.5">
                  {group.items.map((item) => {
                    const active = isActive(pathname, item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setOpen(false)}
                        aria-current={active ? 'page' : undefined}
                        className={
                          'flex min-h-10 flex-none items-center gap-3 rounded-xl px-3 py-1.5 text-[15px] font-semibold transition ' +
                          (active
                            ? 'bg-teal/12 text-teal'
                            : 'text-muted hover:bg-[rgb(var(--surface-2))] hover:text-[rgb(var(--text))]')
                        }
                      >
                        <Icon name={item.icon} />
                        {item.label}
                        {(badges[item.href] ?? 0) > 0 && (
                          <span className="ms-auto grid h-5 min-w-5 place-items-center rounded-full bg-warn px-1.5 text-[11px] font-bold text-white tnum">
                            {badges[item.href]}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <button
        onClick={onLogout}
        className="m-3 flex flex-none items-center justify-center gap-2 rounded-xl border border-[rgb(var(--line))] py-2.5 text-sm font-semibold text-muted transition hover:text-bad"
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
          <aside className="surface absolute inset-y-0 start-0 flex w-72 max-w-[85vw] flex-col shadow-2xl">{SidebarInner}</aside>
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
          <div className="hidden text-sm text-muted sm:block">لوحة تحكم المتجر</div>
          <div className="ms-auto flex min-w-0 items-center gap-2">
            {pendingCodes > 0 && (
              <Link
                href="/verifications"
                className="truncate rounded-full bg-warn/12 px-3 py-1.5 text-xs font-bold text-warn"
              >
                {pendingCodes} رمز بانتظار الإرسال
              </Link>
            )}
            <StaffBell />
            <AlertsButton />
            <span className="grid h-9 w-9 flex-none place-items-center rounded-full bg-teal/15 text-sm font-bold text-teal">
              A
            </span>
          </div>
        </header>
        <main className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
          <WakeBanner />
          <div>{children}</div>
        </main>
        {toast && <Toast ev={toast} onClose={closeToast} />}
      </div>
      <ErrorReporter />
    </div>
  );
}
