/**
 * Where to go after signing in: only a path inside the shop. Browsers drop
 * tabs and line breaks from URLs, so "/\t/evil.example" becomes
 * "//evil.example" — those characters are removed before the check, and the
 * result must resolve to this very origin.
 */
export function safeNext(asked: string | null): string {
  const clean = (asked ?? '').replace(/[\t\n\r]/g, '');
  if (!/^\/(?![/\\])/.test(clean)) return '/';
  try {
    const url = new URL(clean, 'https://shop.invalid');
    return url.origin === 'https://shop.invalid' ? `${url.pathname}${url.search}${url.hash}` : '/';
  } catch {
    return '/';
  }
}
