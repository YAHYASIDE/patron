'use client';

import { useState } from 'react';
import { usePathname } from 'next/navigation';
import { useMe } from '@/lib/session';
import { VerifySheet } from './VerifyPanel';
import { ShieldIcon } from './icons';

/** The "not verified yet" signal: a bar under the header that opens verification. */
export default function VerifyBanner() {
  const { me } = useMe();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  if (!me || pathname === '/login') return null;

  return (
    <>
      {/* the sheet outlives the bar: it shows its "verified" message after the bar is gone */}
      {!me.phoneVerifiedAt && (
        <button
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-center gap-2 border-b border-warn/25 bg-warn/10 px-4 py-2 text-sm font-bold text-warn"
        >
          <ShieldIcon size={16} />
          حسابك غير موثّق
          <span className="underline underline-offset-4">وثّقه الآن</span>
        </button>
      )}
      {open && <VerifySheet onClose={() => setOpen(false)} />}
    </>
  );
}
