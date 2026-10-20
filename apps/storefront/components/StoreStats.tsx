'use client';

import { useEffect, useState } from 'react';
import { store } from '@/lib/api';
import { num } from '@/lib/format';
import { useT } from '@/lib/i18n';
import type { StoreStats as Stats } from '@/lib/types';
import { CheckIcon, ShieldIcon } from './icons';

/**
 * Trust numbers from real counts (GET /catalog/stats): orders delivered and
 * customers. Hidden until there is at least one delivered order, and when the
 * API does not answer.
 */
export default function StoreStats() {
  const t = useT();
  const [s, setS] = useState<Stats | null>(null);

  useEffect(() => {
    store
      .stats()
      .then((r) => setS(r && typeof r.ordersDelivered === 'number' ? r : null))
      .catch(() => setS(null));
  }, []);

  if (!s || s.ordersDelivered < 1) return null;
  const items = [
    { n: s.ordersDelivered, label: t('طلبات سُلِّمت'), icon: <CheckIcon size={15} /> },
    ...(s.customers > 0 ? [{ n: s.customers, label: t('عملاء يثقون بنا'), icon: <ShieldIcon size={15} /> }] : []),
  ];
  return (
    <ul className="mt-4 flex flex-wrap gap-2" aria-label={t('أرقام المتجر')}>
      {items.map((i) => (
        <li
          key={i.label}
          className="surface-2 inline-flex items-center gap-2 rounded-full py-1.5 pe-3.5 ps-2 text-xs text-muted"
        >
          <span className="grid h-6 w-6 place-items-center rounded-full bg-teal/15 text-teal">{i.icon}</span>
          <span className="tnum text-sm font-extrabold text-[rgb(var(--text))]">{num(i.n)}</span>
          {i.label}
        </li>
      ))}
    </ul>
  );
}
