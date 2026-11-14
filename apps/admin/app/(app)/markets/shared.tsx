'use client';

import { useState } from 'react';
import Link from 'next/link';
import Notice from '@/components/Notice';
import { ConfirmDialog } from '@/components/IntelBits';
import { friendlyError, type MarketAction, type MarketStatus } from '@/lib/intelligence';

/** Approving is a note to self; customers see a method only once it is linked to a receiving account. */
export function ApprovalExplainer() {
  return (
    <div className="rounded-xl border border-teal/25 bg-teal/5 px-4 py-3 text-sm">
      <p className="font-bold text-teal">الموافقة لا تُظهر الوسيلة للزبائن.</p>
      <p className="mt-1 text-muted">
        تظهر وسيلة الدفع للزبائن فقط بعد ربطها بحساب استقبال مفعّل لهذه الدولة، تضيفه أنت في{' '}
        <Link href="/payment-methods" className="font-bold text-teal hover:underline">
          وسائل الدفع
        </Link>
        . والدولة نفسها لا تظهر في المتجر حتى تفعّلها.
      </p>
    </div>
  );
}

const LABEL: Record<MarketAction, string> = { approve: 'موافقة', reject: 'رفض', defer: 'تأجيل' };
const NOW: Record<MarketAction, MarketStatus> = { approve: 'APPROVED', reject: 'REJECTED', defer: 'DEFERRED' };

/** Approve / reject / defer with an optional note; the action matching the current status is left out. */
export function DecisionBar({
  status,
  what,
  onDecide,
  onDone,
}: {
  status: MarketStatus;
  what: string;
  onDecide: (action: MarketAction, note?: string) => Promise<unknown>;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [busy, setBusy] = useState<MarketAction | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // an active method is live for customers: changing it starts from its account, not from here
  if (status === 'ACTIVE') return null;
  const actions = (['approve', 'defer', 'reject'] as MarketAction[]).filter((a) => NOW[a] !== status);

  async function act(action: MarketAction) {
    setBusy(action);
    setError(null);
    try {
      await onDecide(action, note.trim() || undefined);
      setNote('');
      setShowNote(false);
      setAsking(false);
      onDone();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {showNote && (
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="ملاحظة (اختياري)"
          className="surface-2 hairline min-h-10 w-full rounded-xl border px-3 text-sm outline-none focus:border-teal"
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        {actions.map((a) => (
          <button
            key={a}
            disabled={!!busy}
            onClick={() => (a === 'reject' ? setAsking(true) : act(a))}
            className={
              'min-h-10 flex-1 rounded-xl px-4 text-sm font-bold transition disabled:opacity-50 sm:flex-none ' +
              (a === 'approve'
                ? 'bg-teal text-white hover:bg-teal-deep'
                : a === 'reject'
                  ? 'border border-bad/40 text-bad hover:bg-bad/10'
                  : 'border border-[rgb(var(--line))] hover:border-teal')
            }
          >
            {busy === a ? 'جارٍ…' : LABEL[a]}
          </button>
        ))}
        {!showNote && (
          <button onClick={() => setShowNote(true)} className="min-h-10 px-2 text-xs font-bold text-muted hover:text-[rgb(var(--text))]">
            + ملاحظة
          </button>
        )}
      </div>
      {error && !asking && <Notice text={error} />}
      {asking && (
        <ConfirmDialog
          title={`رفض «${what}»؟`}
          body="تبقى مسجّلة مرفوضة ولا تُقترح عليك مجددًا كأنها جديدة. يمكنك الموافقة عليها لاحقًا."
          confirmLabel="نعم، رفض"
          tone="bad"
          busy={busy === 'reject'}
          error={error}
          onConfirm={() => act('reject')}
          onCancel={() => setAsking(false)}
        />
      )}
    </div>
  );
}
