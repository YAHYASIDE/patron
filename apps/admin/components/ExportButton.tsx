'use client';

import { useState } from 'react';
import { api, ApiError, NOT_READY } from '@/lib/api';

/** Downloads a staff-only file (CSV, backup) with the bearer token. */
export default function ExportButton({
  path,
  filename,
  label,
  primary,
}: {
  path: string;
  filename: string;
  label: string;
  primary?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await api.download(path, filename);
    } catch (e) {
      setError(
        e instanceof ApiError ? (e.message === NOT_READY ? 'غير متاح بعد' : e.message) : 'تعذّر التنزيل.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-stretch gap-1">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className={
          'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition disabled:opacity-60 ' +
          (primary
            ? 'bg-teal text-white hover:bg-teal-deep'
            : 'border border-[rgb(var(--line))] hover:border-teal')
        }
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
        </svg>
        {busy ? 'جارٍ التنزيل…' : label}
      </button>
      {error && <span className="text-xs font-semibold text-bad">{error}</span>}
    </span>
  );
}
