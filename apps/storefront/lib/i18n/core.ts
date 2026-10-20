import { EN, FR } from './dict';

/**
 * The store speaks Arabic, French and English. Arabic is the source: every
 * text is written in Arabic in the code and looked up in the French or English
 * dictionary (lib/i18n/dict); a text missing there shows in Arabic rather
 * than breaking.
 *
 * The choice lives in a cookie so the server renders the right language and
 * direction from the first byte; changing it reloads the page.
 *
 *   const t = useT();             // in a component (safe while rendering)
 *   t('سلّة التسوّق')
 *   t('الكمية: {n}', { n: 2 })
 *   tNow('…')                     // outside render: event handlers, helpers
 */
export type Lang = 'ar' | 'fr' | 'en';

export const LANGS: { id: Lang; label: string }[] = [
  { id: 'ar', label: 'العربية' },
  { id: 'fr', label: 'Français' },
  { id: 'en', label: 'English' },
];

export const LANG_COOKIE = 'patron_lang';

export const isLang = (v: unknown): v is Lang => v === 'ar' || v === 'fr' || v === 'en';
export const dirOf = (lang: Lang) => (lang === 'ar' ? 'rtl' : 'ltr');

/** Numbers and dates: Latin digits in every language. */
export const localeOf = (lang: Lang) => (lang === 'fr' ? 'fr-FR' : lang === 'en' ? 'en-GB' : 'ar-EG-u-nu-latn');

export type Vars = Record<string, string | number>;

export function translate(lang: Lang, ar: string, vars?: Vars): string {
  const text = lang === 'fr' ? (FR[ar] ?? ar) : lang === 'en' ? (EN[ar] ?? ar) : ar;
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m)) : text;
}
