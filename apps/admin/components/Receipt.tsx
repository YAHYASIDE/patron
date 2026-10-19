'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/** The customer's screenshot of their transfer; tap to see it full size. */
export default function Receipt({ paymentId }: { paymentId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [big, setBig] = useState(false);

  useEffect(() => {
    let made: string | null = null;
    api
      .imageUrl(`/admin/payments/${paymentId}/proof`)
      .then((u) => {
        made = u;
        setUrl(u);
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      if (made) URL.revokeObjectURL(made);
    };
  }, [paymentId]);

  if (error) return <p className="text-xs text-muted">صورة التحويل: {error}</p>;
  if (!url) return <p className="text-xs text-muted">جارٍ تحميل صورة التحويل…</p>;

  return (
    <>
      <button onClick={() => setBig(true)} className="flex items-center gap-3 text-start">
        {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL */}
        <img src={url} alt="صورة التحويل" className="h-28 w-24 rounded-xl border border-[rgb(var(--line))] object-cover" />
        <span className="text-sm font-bold text-teal">عرض صورة التحويل</span>
      </button>
      {big && (
        <div
          onClick={() => setBig(false)}
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
          role="dialog"
          aria-label="صورة التحويل"
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL */}
          <img src={url} alt="صورة التحويل" className="max-h-full max-w-full rounded-xl" />
        </div>
      )}
    </>
  );
}
