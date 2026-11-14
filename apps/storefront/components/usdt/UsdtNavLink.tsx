'use client';

import Link from 'next/link';
import { useT } from '@/lib/i18n';
import { useUsdtEnabled } from '@/lib/usdt';

/** The menu entry for buying USDT; nothing at all while the owner keeps the service off. */
export default function UsdtNavLink({ className }: { className: string }) {
  const t = useT();
  if (!useUsdtEnabled()) return null;
  return (
    <Link href="/usdt" className={className}>
      {t('شراء USDT')}
    </Link>
  );
}
