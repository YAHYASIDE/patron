'use client';

import { createContext, useCallback, useContext } from 'react';
import { translate, isLang, LANG_COOKIE, type Lang, type Vars } from './core';

export * from './core';

const LangContext = createContext<Lang>('ar');

export function LangProvider({ lang, children }: { lang: Lang; children: React.ReactNode }) {
  return <LangContext.Provider value={lang}>{children}</LangContext.Provider>;
}

export function useLang(): Lang {
  return useContext(LangContext);
}

export function useT() {
  const lang = useLang();
  return useCallback((ar: string, vars?: Vars) => translate(lang, ar, vars), [lang]);
}

/** The page's language outside React (the server sets it on <html lang>). Arabic on the server. */
export function getLang(): Lang {
  if (typeof document === 'undefined') return 'ar';
  const l = document.documentElement.lang;
  return isLang(l) ? l : 'ar';
}

/** Translate outside render (event handlers, error helpers). Never call it while rendering. */
export function tNow(ar: string, vars?: Vars): string {
  return translate(getLang(), ar, vars);
}

export function setLang(lang: Lang) {
  document.cookie = `${LANG_COOKIE}=${lang}; path=/; max-age=31536000; samesite=lax`;
  window.location.reload();
}
