'use client';

import { useEffect, useState } from 'react';
import { shop } from '@/lib/api';
import { useT } from '@/lib/i18n';

let cached: Promise<string | null> | null = null;
export function supportNumber(): Promise<string | null> {
  if (!cached) {
    cached = shop
      .info()
      .then((i) => i.supportWhatsapp)
      .catch(() => null);
    cached.then((n) => n === null && (cached = null));
  }
  return cached;
}

/**
 * "In a hurry? Message us": opens the shop's WhatsApp with a message that
 * already says who the customer is and what they need, so the owner can send
 * the code straight away. Hidden when the owner has not set a number.
 */
export default function WhatsAppHelp({
  name,
  phone,
  need,
  onOpen,
}: {
  name?: string | null;
  phone?: string | null;
  need: 'verify' | 'login';
  /** Runs in the same click (e.g. to request the code), before WhatsApp opens. */
  onOpen?: () => void;
}) {
  const t = useT();
  const [number, setNumber] = useState<string | null>(null);
  useEffect(() => {
    supportNumber().then(setNumber);
  }, []);
  if (!number) return null;

  // the owner reads Arabic: the message stays Arabic whatever the page's language

  const lines = [
    'مرحبًا،',
    name ? `أنا ${name}` : null,
    phone ? `رقمي: ${phone}` : null,
    need === 'verify' ? 'حالة حسابي: غير موثّق' : 'حالة حسابي: مسجّل، أحتاج رمز الدخول',
    need === 'verify' ? 'أريد توثيق حسابي في متجر patron.' : 'أريد رمز الدخول إلى حسابي في متجر patron.',
  ].filter(Boolean);
  const href = `https://wa.me/${number.replace(/\D/g, '')}?text=${encodeURIComponent(lines.join('\n'))}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={onOpen}
      className="flex items-center justify-center gap-2 rounded-xl border border-[#1FA855]/40 bg-[#1FA855]/10 py-3 text-[15px] font-bold text-[#178a45] transition hover:bg-[#1FA855]/15 dark:text-[#3ddc84]"
    >
      <WhatsAppMark size={18} />
      {t('مستعجل؟ راسلنا على واتساب')}
    </a>
  );
}

/** The WhatsApp mark (Simple Icons, CC0). */
export function WhatsAppMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}
