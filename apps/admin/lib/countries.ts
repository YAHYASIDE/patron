/** Country names (Arabic, from the browser) and flags for the customer's ISO country code. */

// the shop's markets first, in the order the owner thinks of them
export const MAIN_COUNTRIES = ['MR', 'SN', 'ML', 'NE', 'DZ', 'MA', 'TN', 'SA', 'AE', 'FR', 'ES', 'US'];

let names: Intl.DisplayNames | null = null;

export function countryName(iso: string | null | undefined): string {
  if (!iso) return 'غير محدد';
  try {
    names ??= new Intl.DisplayNames(['ar'], { type: 'region' });
    return names.of(iso.toUpperCase()) ?? iso;
  } catch {
    return iso;
  }
}

/** The regional-indicator pair for an ISO code renders as the country's flag. */
export function flagOf(iso: string | null | undefined): string {
  if (!iso || !/^[A-Za-z]{2}$/.test(iso)) return '🏳️';
  return String.fromCodePoint(...[...iso.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
