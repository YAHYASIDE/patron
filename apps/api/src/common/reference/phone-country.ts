/**
 * The country a WhatsApp number belongs to, from its dial code. Customers sign
 * in with their number, so this is how the shop knows where they are (the
 * owner's customers-by-country page, broadcasts to one country) without asking.
 * A country the customer picks in their profile always wins over this.
 *
 * Only codes that name a single country; "+1" (US, Canada, the Caribbean) and
 * "+7" (Russia, Kazakhstan) are left out on purpose. The data migration
 * 20261019060000_country_from_phone backfills existing customers from the same list.
 */
export const DIAL_CODES: Record<string, string> = {
  // the shop's own markets first
  '222': 'MR', '223': 'ML', '213': 'DZ', '227': 'NE',
  // West and North Africa
  '221': 'SN', '212': 'MA', '216': 'TN', '218': 'LY', '20': 'EG', '249': 'SD', '235': 'TD',
  '226': 'BF', '225': 'CI', '224': 'GN', '220': 'GM', '245': 'GW', '238': 'CV', '234': 'NG',
  '233': 'GH', '237': 'CM', '229': 'BJ', '228': 'TG', '232': 'SL', '231': 'LR', '236': 'CF',
  '241': 'GA', '242': 'CG', '243': 'CD', '253': 'DJ', '252': 'SO', '269': 'KM',
  // the Gulf and the Levant
  '966': 'SA', '971': 'AE', '974': 'QA', '965': 'KW', '973': 'BH', '968': 'OM', '962': 'JO',
  '961': 'LB', '963': 'SY', '964': 'IQ', '970': 'PS', '967': 'YE',
  // where the diaspora lives
  '33': 'FR', '34': 'ES', '32': 'BE', '49': 'DE', '39': 'IT', '44': 'GB', '31': 'NL',
  '41': 'CH', '351': 'PT', '90': 'TR',
};

/** "+22222123456" → "MR"; null when the code is unknown or shared by several countries. */
export function countryFromPhone(phone: string | null | undefined): string | null {
  if (!phone?.startsWith('+')) return null;
  const digits = phone.slice(1);
  // dial codes are prefix-free, so the first length that matches is the only one
  for (const len of [1, 2, 3]) {
    const country = DIAL_CODES[digits.slice(0, len)];
    if (country) return country;
  }
  return null;
}
