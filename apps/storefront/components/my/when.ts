import { locale } from '@/lib/format';

/** "19 oct. 2026" / "19 أكتوبر 2026", Latin digits in every language. */
export function day(iso?: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

/** The day plus the time, for events (a notification, a wallet entry). */
export function dayTime(iso?: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(locale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Arabic letters folded so "أ/إ/آ" and "ة/ه" match while searching. */
export const fold = (s: string) =>
  s.toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/\s+/g, ' ').trim();
