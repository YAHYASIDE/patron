/**
 * Countries for the WhatsApp-number field: ISO code and dialling code. Names
 * come from the browser in Arabic, French and English (Intl.DisplayNames), so
 * the list stays short and every name is spelled the way the platform does.
 */

// Shown first, in this order: Mauritania, then neighbours and the Arab world.
const PRIORITY =
  'MR222 SN221 ML223 MA212 DZ213 TN216 LY218 EG20 SA966 AE971 QA974 KW965 BH973 OM968 JO962 LB961 SY963 IQ964 PS970 YE967 SD249 FR33 ES34 US1';

const REST =
  // Africa
  'SO252 DJ253 KM269 GM220 GN224 CI225 BF226 NE227 TG228 BJ229 MU230 LR231 SL232 GH233 NG234 TD235 CF236 CM237 CV238 ST239 ' +
  'GQ240 GA241 CG242 CD243 AO244 GW245 SC248 RW250 ET251 KE254 TZ255 UG256 BI257 MZ258 ZM260 MG261 ZW263 NA264 MW265 LS266 ' +
  'BW267 SZ268 ZA27 ER291 SS211 ' +
  // Europe
  'BE32 CH41 IT39 PT351 DE49 NL31 LU352 GB44 IE353 AT43 SE46 NO47 DK45 FI358 PL48 CZ420 SK421 HU36 RO40 BG359 GR30 CY357 ' +
  'MT356 HR385 SI386 RS381 BA387 ME382 MK389 AL355 XK383 UA380 BY375 MD373 LT370 LV371 EE372 IS354 RU7 TR90 GE995 AM374 ' +
  'AZ994 MC377 AD376 LI423 SM378 ' +
  // Americas
  'CA1 MX52 BR55 AR54 CL56 CO57 PE51 VE58 EC593 BO591 PY595 UY598 CU53 DO1 HT509 GT502 HN504 SV503 NI505 CR506 PA507 JM1 TT1 ' +
  // Asia and Oceania
  'CN86 JP81 KR82 IN91 PK92 BD880 LK94 NP977 AF93 IR98 KZ7 UZ998 TM993 KG996 TJ992 MN976 ID62 MY60 SG65 TH66 VN84 PH63 ' +
  'MM95 KH855 LA856 HK852 TW886 MV960 BN673 AU61 NZ64';

export type Country = { iso: string; dial: string; flag: string; ar: string; fr: string; en: string };

const parse = (list: string) =>
  list
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => ({ iso: t.slice(0, 2), dial: t.slice(2) }));

function names(locale: string): (iso: string) => string {
  try {
    const dn = new Intl.DisplayNames([locale], { type: 'region' });
    return (iso) => dn.of(iso) ?? iso;
  } catch {
    return (iso) => iso;
  }
}

/** The regional-indicator pair for an ISO code renders as the country's flag. */
const flagOf = (iso: string) => String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

function build(): Country[] {
  const ar = names('ar');
  const fr = names('fr');
  const en = names('en');
  const make = ({ iso, dial }: { iso: string; dial: string }): Country => ({
    iso,
    dial,
    flag: flagOf(iso),
    ar: ar(iso),
    fr: fr(iso),
    en: en(iso),
  });
  const rest = parse(REST)
    .map(make)
    .sort((a, b) => a.ar.localeCompare(b.ar, 'ar'));
  return [...parse(PRIORITY).map(make), ...rest];
}

export const COUNTRIES: Country[] = build();
export const DEFAULT_COUNTRY = COUNTRIES[0]; // Mauritania

const fold = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[أإآ]/g, 'ا').replace(/ة/g, 'ه');

export function searchCountries(q: string): Country[] {
  const t = fold(q.trim()).replace(/^\+/, '');
  if (!t) return COUNTRIES;
  return COUNTRIES.filter(
    (c) =>
      fold(c.ar).includes(t) ||
      fold(c.fr).includes(t) ||
      fold(c.en).includes(t) ||
      c.dial.startsWith(t) ||
      c.iso.toLowerCase() === t,
  );
}

/** "+222" and "22 12 34 56" (or "0612…") → "+22222123456". */
export function toE164(country: Country, national: string): string {
  const digits = national.replace(/\D/g, '').replace(/^0+/, '');
  return `+${country.dial}${digits}`;
}

/** A light check before the server's: Mauritanian numbers are 8 digits starting 2, 3 or 4. */
export function nationalNumberProblem(country: Country, national: string): string | null {
  const digits = national.replace(/\D/g, '').replace(/^0+/, '');
  if (!digits) return 'اكتب رقم واتساب.';
  if (country.iso === 'MR' && !/^[234]\d{7}$/.test(digits))
    return 'الرقم الموريتاني 8 أرقام ويبدأ بـ 2 أو 3 أو 4.';
  if (digits.length < 6 || digits.length > 14) return 'تحقّق من الرقم.';
  return null;
}
