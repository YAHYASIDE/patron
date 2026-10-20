/**
 * A short, human label for the session list ("iPhone · Safari") from the
 * User-Agent header. Only the device family and the browser are kept — never
 * the full header, which is a fingerprint.
 */
export function describeDevice(userAgent?: string | null): string | undefined {
  const ua = (userAgent ?? '').slice(0, 512);
  if (!ua) return undefined;

  const device =
    /iPhone/.test(ua) ? 'iPhone'
    : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android' : 'Android tablet')
    : /Windows/.test(ua) ? 'Windows'
    : /Macintosh|Mac OS X/.test(ua) ? 'Mac'
    : /CrOS/.test(ua) ? 'Chromebook'
    : /Linux/.test(ua) ? 'Linux'
    : null;

  const browser =
    /EdgA?\//.test(ua) ? 'Edge'
    : /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
    : /CriOS\/|Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : /Dart|okhttp/i.test(ua) ? 'App'
    : null;

  const label = [device, browser].filter(Boolean).join(' · ');
  return label || undefined;
}
