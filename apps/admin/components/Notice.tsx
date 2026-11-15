import { NOT_READY } from '@/lib/api';

/**
 * One-line message box. An error that only means "this server does not have the
 * feature yet" is shown calmly (muted), not as a red failure.
 */
export default function Notice({
  text,
  tone = 'bad',
}: {
  text: string;
  tone?: 'bad' | 'ok' | 'warn' | 'muted';
}) {
  const t = text === NOT_READY ? 'muted' : tone;
  const cls = {
    bad: 'border-bad/30 bg-bad/10 text-bad',
    ok: 'border-ok/30 bg-ok/10 text-ok',
    warn: 'border-warn/30 bg-warn/10 text-warn',
    muted: 'border-[rgb(var(--line))] surface-2 text-muted',
  }[t];
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm font-semibold ${cls}`}>
      {text === NOT_READY ? 'غير متاح بعد: هذه الميزة لم تُفعَّل على الخادم حتى الآن.' : text}
    </div>
  );
}
