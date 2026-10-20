/**
 * Discoveries and agent runs are read by every staff member with
 * `intelligence.read` and are written by outside agents and CI, so nothing that
 * identifies a customer or opens a door may be stored in them. Everything an
 * agent or a scanner writes passes through here first:
 *
 * - `key=`, `token=`, `password=`, `secret:`, `Bearer …`: the value is replaced;
 * - emails keep their first letter and domain (`a***@example.com`);
 * - phone numbers (`+` and/or 8–15 digits) keep their last two digits;
 * - long hex strings (32+) and long mixed-case base64-like strings (32+, letters
 *   of both cases and digits) are treated as keys or tokens and replaced.
 *
 * It prefers masking too much over too little: a masked number in a title costs
 * a moment of reading, a leaked one cannot be taken back.
 */

export const REDACTED = '[redacted]';

const SECRET_ASSIGNMENT =
  /\b(api[_-]?key|access[_-]?key|secret[_-]?key|private[_-]?key|key|token|access[_-]?token|refresh[_-]?token|secret|client[_-]?secret|password|passwd|pwd|passphrase|otp|pin|authorization)(\s*=\s*|\s*:\s*(?=\S))("[^"]*"|'[^']*'|[^\s,;&"'<>)}\]]+)/gi;
const BEARER = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const EMAIL = /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)\b/g;
const HEX_TOKEN = /\b[0-9a-fA-F]{32,}\b/g;
const B64_TOKEN = /[A-Za-z0-9_+-]{32,}={0,2}/g;
/** `+` then 8–15 digits (spaces allowed between them), or 8–15 digits in a row. */
const PHONE = /(?<![\w+])(?:\+\d(?: ?\d){7,14}|\d{8,15})(?![\w])/g;

/** `key:` alone is ordinary prose ("key: orange-money-ml"); only `key=` counts for it. */
const COLON_SAFE = new Set(['key']);

function maskPhone(match: string) {
  const digits = match.replace(/\D/g, '');
  return `${match.startsWith('+') ? '+' : ''}${'•'.repeat(Math.max(digits.length - 2, 1))}${digits.slice(-2)}`;
}

function looksLikeToken(s: string) {
  return /[a-z]/.test(s) && /[A-Z]/.test(s) && /\d/.test(s);
}

/** One string, cleaned. */
export function scrubText(input: string): string {
  if (!input) return input;
  return input
    .replace(SECRET_ASSIGNMENT, (whole, name: string, sep: string) =>
      sep.includes(':') && COLON_SAFE.has(name.toLowerCase()) ? whole : `${name}${sep}${REDACTED}`,
    )
    .replace(BEARER, (_m, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(EMAIL, (_m, first: string, domain: string) => `${first}***@${domain}`)
    .replace(HEX_TOKEN, REDACTED)
    .replace(B64_TOKEN, (m) => (looksLikeToken(m) ? REDACTED : m))
    .replace(PHONE, maskPhone);
}

/** Any JSON-like value: every string inside it is scrubbed, keys included. */
export function scrubDeep<T>(value: T): T {
  if (typeof value === 'string') return scrubText(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v)) as unknown as T;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [scrubText(k), scrubDeep(v)]),
    ) as T;
  }
  return value;
}
