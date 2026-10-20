'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { captureRef } from '@/lib/ref-store';

/** Keeps the agent's code from a `?ref=CODE` link (see lib/ref-store.ts). Renders nothing. */
export default function RefCapture() {
  const pathname = usePathname();
  useEffect(() => {
    captureRef();
  }, [pathname]);
  return null;
}
