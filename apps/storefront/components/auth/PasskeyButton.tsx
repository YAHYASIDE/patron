'use client';

import { useEffect, useState } from 'react';
import { authError, passkeys, passkeysAvailable } from '@/lib/auth2';
import { useT } from '@/lib/i18n';

/** A fingerprint drawn simply, for the passkey buttons. */
export function FingerprintIcon({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className={className} aria-hidden>
      <path d="M12 11c0 3.5-.6 6.4-2 8.6" />
      <path d="M8.5 7.5A5 5 0 0 1 17 11c0 2.3-.3 4.4-.9 6.2" />
      <path d="M5.2 15.5c.5-1.3.8-2.8.8-4.5a6 6 0 0 1 .9-3.2" />
      <path d="M14.5 11c0 3-.4 5.7-1.3 7.9" />
      <path d="M9.5 11a2.5 2.5 0 0 1 5 0" />
      <path d="M19.6 14.5c.3-1.1.4-2.3.4-3.5A8 8 0 0 0 7.8 4.2" />
    </svg>
  );
}

/** Shows nothing until the browser says it can unlock with fingerprint or face. */
export function usePasskeysAvailable() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let alive = true;
    passkeysAvailable().then((v) => alive && setOk(v));
    return () => {
      alive = false;
    };
  }, []);
  return ok;
}

/** «الدخول بالبصمة أو الوجه» on the sign-in page. */
export default function PasskeyButton({ onSignedIn, onError }: { onSignedIn: () => void; onError: (m: string | null) => void }) {
  const t = useT();
  const available = usePasskeysAvailable();
  const [busy, setBusy] = useState(false);
  if (!available) return null;

  async function go() {
    setBusy(true);
    onError(null);
    try {
      await passkeys.signIn();
      onSignedIn();
    } catch (e) {
      onError(authError(e));
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={go}
      disabled={busy}
      className="surface hairline flex w-full items-center justify-center gap-2 rounded-xl border py-3.5 text-[15px] font-bold transition hover:border-teal disabled:opacity-60"
    >
      <FingerprintIcon className="text-teal" />
      {busy ? t('جارٍ التحقق…') : t('الدخول بالبصمة أو الوجه')}
    </button>
  );
}
