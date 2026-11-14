/**
 * Reading a payment notification the owner's phone received from a bank app
 * (Bankily, Masrvi, Sedad, a bank SMS…), in Arabic, French or English.
 *
 * Everything here is pure and conservative: the parsed fields only help the
 * owner find the matching order faster. They are evidence, never proof, and
 * nothing approves a payment from them.
 */

/** Stored text is cut to this size: a notification is a few lines, not a document. */
export const MAX_TEXT = 1000;
export const MAX_TITLE = 200;

const D = '0-9٠-٩۰-۹'; // Western, Arabic-Indic and Persian digits
const NOT_LATIN_BEFORE = '(?<![A-Za-zÀ-ſ])';
const NOT_LATIN_AFTER = '(?![A-Za-zÀ-ſ])';

/** Arabic-Indic (and Persian) digits and separators to their Latin form. */
export function toLatinDigits(s: string) {
  return s
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.') // Arabic decimal separator
    .replace(/٬/g, ','); // Arabic thousands separator
}

// ───────────────────────── sanitizing ─────────────────────────

/**
 * Words that announce a secret: a one-time code, a PIN, a password. A
 * "transaction code" (رمز العملية, code de transaction) is a reference, not a
 * secret, and is kept.
 */
const SECRET_WORDS = [
  'otp', 'pin', 'code', 'passcode', 'password', 'mot de passe', 'mdp', 'one[- ]time', 'verification', 'vérification',
  'رمز', 'الرمز', 'كود', 'الكود', 'كلمة السر', 'كلمة المرور', 'كلمة مرور', 'الرقم السري', 'رقم سري', 'الرقم السرّي',
];
const SECRET_KW = `${NOT_LATIN_BEFORE}(?:${SECRET_WORDS.join('|')})${NOT_LATIN_AFTER}`;
const NOT_A_SECRET = String.raw`(?!\s*(?:de\s+|d'|du\s+)?(?:la\s+|l'|l’)?(?:transaction|op[ée]ration|operation|transfert|العملية|المعاملة|التحويل|الحوالة))`;
const SECRET_AFTER_WORD = new RegExp(`(${SECRET_KW})${NOT_A_SECRET}([^${D}]{0,30}?)([${D}]{4,8})(?![${D}])`, 'giu');
const SECRET_BEFORE_WORD = new RegExp(`(?<![${D}])([${D}]{4,8})(?![${D}])(\\s*(?:is your|est votre|est ton|هو|هي)?\\s*(?:${SECRET_KW}))`, 'giu');
export const MASK = '••••';

/**
 * Removes anything that looks like a one-time code or password (a 4–8 digit
 * group next to OTP / code / PIN / رمز / كلمة السر…), strips control
 * characters, collapses whitespace and caps the length. Run before anything is
 * stored or hashed: a secret must never reach the database or the logs.
 */
export function sanitizeNotice(text: string, max = MAX_TEXT) {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩]/g, '')
    .replace(SECRET_AFTER_WORD, (_m, word: string, gap: string) => `${word}${gap}${MASK}`)
    .replace(SECRET_BEFORE_WORD, (_m, _code: string, rest: string) => `${MASK}${rest}`)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

// ───────────────────────── parsing ─────────────────────────

export type Direction = 'in' | 'out' | 'unknown';

export interface ParsedNotice {
  /** Decimal as a string ("1500", "12.5"), or null when no amount was found. */
  amount: string | null;
  /** ISO code: MRU, USD or XOF. */
  currency: string | null;
  reference: string | null;
  /** The payer's number, digits only. */
  sender: string | null;
  direction: Direction;
  /** 0–100: how sure the parser is about amount and reference. */
  confidence: number;
  parser: string;
}

const CURRENCIES: Array<[string, string]> = [
  ['MRU', `${NOT_LATIN_BEFORE}(?:MRU|MRO|UM|ouguiyas?|ougiyas?)${NOT_LATIN_AFTER}|(?:ال)?(?:أوقية|أوقيه|اوقية|اوقيه|أوقيات)(?:\\s*جديدة)?`],
  ['USD', `${NOT_LATIN_BEFORE}(?:USD|US\\$|dollars?)${NOT_LATIN_AFTER}|\\$|(?:ال)?دولار(?:ات)?`],
  ['XOF', `${NOT_LATIN_BEFORE}(?:XOF|F\\s?CFA|CFA)${NOT_LATIN_AFTER}|(?:ال)?فرنك`],
];
const CURRENCY_RE = CURRENCIES.map(([, re]) => `(?:${re})`).join('|');
const NUMBER = String.raw`\d{1,3}(?:[   .,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?`;
const AMOUNT_THEN_CUR = new RegExp(`(?<![\\d.,])(${NUMBER})\\s*(${CURRENCY_RE})`, 'giu');
const CUR_THEN_AMOUNT = new RegExp(`(${CURRENCY_RE})\\s*[:：]?\\s*(${NUMBER})(?![\\d])`, 'giu');
const AMOUNT_WORD_THEN_NUMBER = new RegExp(String.raw`(?:montant|amount|المبلغ|مبلغ|somme)\s*(?:de\s*)?[:：]?\s*(${NUMBER})(?![\d])`, 'giu');

const BALANCE_OR_FEE = /(solde|balance|رصيد|رصيدك|frais|fees?|رسوم|commission|عمولة|disponible)[^\d]{0,25}$/iu;
const PAYMENT_WORD = /(montant|amount|المبلغ|مبلغ|reçu|recu|received|استلمت|استلام|تحويل|transfert|virement|crédit|credit|إيداع|ايداع|dépôt|depot)[^\d]{0,25}$/iu;

function currencyCode(token: string): string | null {
  for (const [code, re] of CURRENCIES) if (new RegExp(`^(?:${re})$`, 'iu').test(token.trim())) return code;
  return null;
}

/** "1 500,50" → "1500.50", "1.500" → "1500", "12,5" → "12.5". */
export function normalizeAmount(raw: string): string | null {
  const s = raw.replace(/[\s  ]/g, '');
  let out: string;
  if (s.includes('.') && s.includes(',')) {
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const thousands = dec === '.' ? ',' : '.';
    out = s.split(thousands).join('').replace(dec, '.');
  } else if (s.includes('.') || s.includes(',')) {
    const sep = s.includes('.') ? '.' : ',';
    const parts = s.split(sep);
    // one separator followed by exactly three digits is a thousands separator
    out = parts.length > 2 || parts[parts.length - 1].length === 3 ? parts.join('') : parts.join('.');
  } else {
    out = s;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(out)) return null;
  const n = Number(out);
  if (!Number.isFinite(n) || n <= 0) return null;
  return out.replace(/^0+(?=\d)/, '').replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

interface AmountHit { amount: string; currency: string | null; index: number; score: number }

function findAmount(text: string): AmountHit | null {
  const hits: AmountHit[] = [];
  const add = (num: string, cur: string | null, index: number) => {
    const amount = normalizeAmount(num);
    if (!amount) return;
    const before = text.slice(Math.max(0, index - 40), index);
    let score = cur ? 10 : 0;
    if (BALANCE_OR_FEE.test(before)) score -= 20;
    if (PAYMENT_WORD.test(before)) score += 5;
    hits.push({ amount, currency: cur, index, score });
  };
  for (const m of text.matchAll(AMOUNT_THEN_CUR)) add(m[1], currencyCode(m[2]), m.index ?? 0);
  for (const m of text.matchAll(CUR_THEN_AMOUNT)) add(m[2], currencyCode(m[1]), m.index ?? 0);
  for (const m of text.matchAll(AMOUNT_WORD_THEN_NUMBER)) add(m[1], null, (m.index ?? 0) + m[0].length - m[1].length);
  if (!hits.length) return null;
  hits.sort((a, b) => b.score - a.score || a.index - b.index);
  const best = hits[0];
  // a bare "montant: 1500" takes the currency written next to the same number elsewhere
  if (!best.currency) best.currency = hits.find((h) => h.amount === best.amount && h.currency)?.currency ?? null;
  return best.score < -5 && !best.currency ? null : best;
}

const REFERENCE = new RegExp(
  String.raw`(?:${NOT_LATIN_BEFORE}(?:r[ée]f[ée]rence|reference|r[ée]f\.?|transaction\s*id|id\s*(?:de\s*)?(?:la\s*)?transaction|txn\s*id|tid|trx|id(?=\s*[:：#])|n[°º]\s*(?:de\s*)?(?:la\s*)?(?:transaction|op[ée]ration)|num[ée]ro\s*(?:de\s*)?(?:la\s*)?(?:transaction|op[ée]ration)|code\s*(?:de\s*)?(?:la\s*)?(?:transaction|op[ée]ration))${NOT_LATIN_AFTER}|رقم\s*(?:ال)?عملية|رقم\s*(?:ال)?معاملة|رمز\s*(?:ال)?عملية|رقم\s*(?:ال)?مرجع|(?:ال)?مرجع|رقم\s*(?:ال)?تحويل|رقم\s*(?:ال)?حوالة)\s*[:：#.\-]?\s*([A-Za-z0-9][A-Za-z0-9\-]{3,29})`,
  'iu',
);

const SENDER = new RegExp(
  String.raw`(?:${NOT_LATIN_BEFORE}(?:from|de\s+la\s+part\s+de|de|du|exp[ée]diteur|sender|par)${NOT_LATIN_AFTER}|من\s*(?:الرقم|رقم)?|المرسل|المرسِل)\s*[:：]?\s*([^\d+]{0,30}?)(\+?\d[\d  ]{6,16}\d)`,
  'giu',
);

const INCOMING = /(reçu|recu|received|incoming|entrant|وارد|واردة|vous a (?:envoyé|transféré)|has sent you|sent you|crédité|credite|credited|sur votre compte|to your account|استلمت|تم استلام|استقبال|وصلك|وصلتك|أرسل لك|ارسل لك|حوّل لك|حول لك|إلى حسابك|الى حسابك|في حسابك|أضيف|اضيف|إيداع|ايداع|dépôt|depot)/iu;
const OUTGOING = /(vous avez (?:envoyé|transféré|payé)|envoyé à|transféré à|débité|debite|debited|you sent|sent to|paid to|retrait|withdraw|أرسلت|ارسلت|حوّلت|حولت|قمت بتحويل|تم تحويل[^.]{0,40}إلى|تم تحويل[^.]{0,40}الى|سحب|خصم)/iu;

function language(text: string) {
  if (/[؀-ۿ]/.test(text)) return 'ar';
  if (/(vous|reçu|montant|virement|réf|solde|de la|avez)/i.test(text)) return 'fr';
  return 'en';
}

/** Parses an already sanitized notification (title and text together). */
export function parseNotice(raw: string): ParsedNotice {
  const text = toLatinDigits(raw);
  const hit = findAmount(text);

  const refMatch = REFERENCE.exec(text);
  const reference = refMatch && /\d/.test(refMatch[1]) ? refMatch[1].toUpperCase() : null;

  let sender: string | null = null;
  for (const m of text.matchAll(SENDER)) {
    const after = text.slice((m.index ?? 0) + m[0].length);
    const digits = m[2].replace(/\D/g, '');
    // "de 12 500 000 MRU" is an amount, not a phone number
    if (digits.length < 8 || digits.length > 15 || new RegExp(`^\\s*(?:${CURRENCY_RE})`, 'iu').test(after)) continue;
    if (reference && digits === reference.replace(/\D/g, '')) continue;
    sender = digits;
    break;
  }

  const direction: Direction = INCOMING.test(text) ? 'in' : OUTGOING.test(text) ? 'out' : 'unknown';

  let confidence = 0;
  if (hit) confidence += hit.currency ? 50 : 20;
  if (reference) confidence += 25;
  if (sender) confidence += 10;
  confidence += direction === 'in' ? 15 : direction === 'unknown' ? 5 : 0;
  if (direction === 'out') confidence = Math.min(confidence, 40);

  return {
    amount: hit?.amount ?? null,
    currency: hit?.currency ?? null,
    reference,
    sender,
    direction,
    confidence: Math.max(0, Math.min(100, confidence)),
    parser: `generic-v1:${language(text)}`,
  };
}
