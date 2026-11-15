// Every string that leaves the CLI goes through scrub(): no phone or account numbers, e-mail
// addresses, tokens or secret values in reports, logs or the ingest payload.

const SECRET_ASSIGN =
  /\b((?:api[_-]?key|access[_-]?key|secret|token|access[_-]?token|refresh[_-]?token|password|passwd|pwd|otp|authorization|auth|signature|sig|key)\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s&,;'"]+)/gi;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g;
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g;
const EMAIL = /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
// a long run of letters and digits mixing both: API keys, session ids, wallet addresses
const LONG_TOKEN = /(?<![A-Za-z0-9_/-])(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g;
// 8+ digits, optionally with +, spaces, dots or dashes between them
const PHONE = /(?<![\w.])\+?\d(?:[\d \-.]{6,}\d)(?![\w])/g;
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}$|^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$|^\d+\.\d+\.\d+$/;

function maskPhone(m) {
  const digits = m.replace(/\D/g, '');
  if (digits.length < 8 || DATE_LIKE.test(m.trim())) return m;
  return `${m.startsWith('+') ? '+' : ''}${'•'.repeat(Math.min(digits.length - 2, 10))}${digits.slice(-2)}`;
}

/** The text with secrets, tokens, e-mails and phone/account numbers masked. */
export function scrubText(text) {
  if (typeof text !== 'string' || !text) return text;
  return text
    .replace(JWT, '[redacted-jwt]')
    .replace(BEARER, '$1 [redacted]')
    .replace(SECRET_ASSIGN, '$1[redacted]')
    .replace(EMAIL, (_, first, domain) => `${first}***@${domain}`)
    .replace(LONG_TOKEN, '[redacted-token]')
    .replace(PHONE, maskPhone);
}

/** A deep copy of `value` with every string scrubbed. */
export function scrub(value) {
  if (typeof value === 'string') return scrubText(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v)]));
  }
  return value;
}
