'use client';

import { useEffect, useState } from 'react';
import { WAKING_EVENT } from '@/lib/api';

/** Shown while the API is waking from a free-tier sleep (see lib/api.ts). */
export default function WakeBanner() {
  const [waking, setWaking] = useState(false);

  useEffect(() => {
    const on = (e: Event) => setWaking(Boolean((e as CustomEvent<boolean>).detail));
    window.addEventListener(WAKING_EVENT, on);
    return () => window.removeEventListener(WAKING_EVENT, on);
  }, []);

  if (!waking) return null;
  return (
    <div role="status" className="flex items-center gap-2.5 rounded-xl border border-teal/25 bg-teal/10 px-4 py-2.5 text-sm font-semibold text-teal">
      <span className="h-4 w-4 flex-none animate-spin rounded-full border-2 border-teal/30 border-t-teal" />
      جارٍ تشغيل الخادم (كان في وضع السكون)، لحظات…
    </div>
  );
}
