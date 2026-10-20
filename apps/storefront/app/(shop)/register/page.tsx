'use client';

import { Suspense, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/** Sign-up and sign-in are one step now (WhatsApp number + name). */
function RegisterRedirect() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  useEffect(() => {
    router.replace(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
  }, [router, next]);
  return null;
}

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterRedirect />
    </Suspense>
  );
}
