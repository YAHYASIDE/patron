import { cookies } from 'next/headers';
import { LANG_COOKIE, isLang, type Lang } from './core';

/** The visitor's language in a server component (the cookie the switcher sets). */
export async function serverLang(): Promise<Lang> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return isLang(v) ? v : 'ar';
}
