'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isAuthed } from '@/lib/api';

// Pages a visitor can open before signing in.
const OPEN = ['/login', '/register'];

/**
 * The owner wants every visitor to sign in first (WhatsApp number + name, no
 * password), so any other page sends them to /login and back afterwards.
 */
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const open = OPEN.includes(pathname);
  const [allowed, setAllowed] = useState(open);

  useEffect(() => {
    if (open || isAuthed()) return setAllowed(true);
    setAllowed(false);
    const next = window.location.pathname + window.location.search;
    router.replace(next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`);
  }, [open, pathname, router]);

  return allowed ? <>{children}</> : null;
}
