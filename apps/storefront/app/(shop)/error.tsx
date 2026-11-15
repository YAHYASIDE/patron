'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useT } from '@/lib/i18n';
import { reportError } from '@/components/ErrorReporter';

/** A page that broke while rendering: say so kindly, offer another try, and tell the owner. */
export default function ShopError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();
  useEffect(() => reportError(error), [error]);

  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      <h1 className="text-xl font-extrabold">{t('حدث خطأ غير متوقّع')}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        {t('تعذّر عرض هذه الصفحة. حاول مرة أخرى، وإن تكرّر الأمر فعُد إلى الرئيسية.')}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button onClick={reset} className="btn-brand rounded-xl px-5 py-2.5 text-sm font-bold">
          {t('إعادة المحاولة')}
        </button>
        <Link href="/" className="rounded-xl px-4 py-2.5 text-sm font-bold text-teal hover:underline">
          {t('الرئيسية')}
        </Link>
      </div>
    </div>
  );
}
