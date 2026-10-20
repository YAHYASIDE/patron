'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isAuthed } from '@/lib/api';
import { isGuest } from '@/lib/guest';

// Pages a visitor can open before signing in.
// (forgot password and support recovery are for people who cannot sign in)
const OPEN = ['/login', '/register', '/help', '/terms', '/reset-password', '/recover'];

/**
 * The owner wants every visitor to meet the sign-in page first (WhatsApp
 * number + name, no password), so any other page sends them to /login and back
 * afterwards, unless they chose "skip for now" there and browse as a guest.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const open = OPEN.includes(pathname);
  const [allowed, setAllowed] = useState(open);

  useEffect(() => {
    if (open || isAuthed() || isGuest()) return setAllowed(true);
    setAllowed(false);
    const next = window.location.pathname + window.location.search;
    router.replace(next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`);
  }, [open, pathname, router]);

  return allowed ? <>{children}</> : null;
}
