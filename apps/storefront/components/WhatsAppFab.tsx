'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useMe } from '@/lib/session';
import { useT } from '@/lib/i18n';
import { WhatsAppMark, supportNumber } from './WhatsAppHelp';

// The sign-in page has its own WhatsApp button.
const HIDDEN = ['/login', '/register'];
// Pages with a buy bar pinned to the bottom on phones: sit above it.
const HAS_BUY_BAR = /^\/(brands|products)\/[^/]+/;

/**
 * A WhatsApp button on every page, so a customer with a question reaches the
 * owner in one tap. The message already says who they are and where they are.
 * Hidden when the owner has not set a number.
 */
export default function WhatsAppFab() {
  const t = useT();
  const pathname = usePathname();
  const { me } = useMe();
  const [number, setNumber] = useState<string | null>(null);
  useEffect(() => {
    supportNumber().then(setNumber);
  }, []);
  if (!number || HIDDEN.includes(pathname)) return null;

  const order = pathname.match(/^\/orders\/([^/]+)/);
  // the owner reads Arabic: the message stays Arabic whatever the page's language
  const lines = [
    'مرحبًا،',
    me ? `أنا ${me.fullName}${me.phone ? ` (${me.phone})` : ''}` : null,
    order ? `عندي سؤال عن طلبي: ${window.location.origin}/orders/${order[1]}` : 'أحتاج مساعدة في متجر patron.',
  ].filter(Boolean);
  const href = `https://wa.me/${number.replace(/\D/g, '')}?text=${encodeURIComponent(lines.join('\n'))}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('راسلنا على واتساب')}
      className={`fixed end-4 z-40 grid h-14 w-14 place-items-center rounded-full bg-[#1FA855] text-white shadow-float transition hover:scale-105 lg:bottom-6 ${
        HAS_BUY_BAR.test(pathname) ? 'bottom-28' : 'bottom-5'
      }`}
    >
      <WhatsAppMark size={28} />
    </a>
  );
}
