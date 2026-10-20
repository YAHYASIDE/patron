import {
  MASK, MAX_TEXT, normalizeAmount, parseNotice, sanitizeNotice, toLatinDigits,
} from '../../src/modules/bank-notices/bank-notice.parser';

/**
 * Sample notifications written for these tests in the style of Mauritanian
 * wallet apps and bank SMS (Arabic and French) — invented numbers and names,
 * no real customer data.
 */
describe('sanitizeNotice', () => {
  it.each([
    ['رمز التحقق الخاص بك هو 482913. لا تشاركه مع أحد.', '482913'],
    ['كلمة السر المؤقتة: 7731', '7731'],
    ['الرقم السري الجديد ٤٨٢٩', '٤٨٢٩'],
    ['Votre code de vérification est 123456', '123456'],
    ['Code OTP: 9921 valable 5 minutes', '9921'],
    ['1234 est votre code PIN', '1234'],
    ['Your one-time password is 55667788', '55667788'],
    ['Mot de passe provisoire : 20261', '20261'],
    ['٧٧٣١ هو رمز الدخول', '٧٧٣١'],
  ])('removes the secret from %p', (text, secret) => {
    const clean = sanitizeNotice(text);
    expect(clean).not.toContain(secret);
    expect(clean).toContain(MASK);
  });

  it('keeps transaction codes, amounts and phone numbers', () => {
    const text = 'Vous avez reçu 1500 MRU de 22334455. Code de transaction: 55120098';
    expect(sanitizeNotice(text)).toBe(text);
    const ar = 'تم استلام 1500 أوقية من 22334455. رمز العملية: 88213451';
    expect(sanitizeNotice(ar)).toBe(ar);
  });

  it('only masks the code next to the word, not the amount further on', () => {
    expect(sanitizeNotice('Votre code: 4821. Vous avez reçu 5000 MRU')).toBe(`Votre code: ${MASK}. Vous avez reçu 5000 MRU`);
  });

  it('strips control characters, collapses whitespace and caps the length', () => {
    expect(sanitizeNotice('a\u0000b\n\n  c‏d')).toBe('ab cd');
    expect(sanitizeNotice('x'.repeat(5000))).toHaveLength(MAX_TEXT);
    expect(sanitizeNotice('abcdef', 3)).toBe('abc');
  });
});

describe('normalizeAmount', () => {
  it.each([
    ['1500', '1500'],
    ['1 500', '1500'],
    ['1 500,50', '1500.5'],
    ['1.500', '1500'],
    ['1,500', '1500'],
    ['1,500.75', '1500.75'],
    ['1.500,75', '1500.75'],
    ['12,5', '12.5'],
    ['25.50', '25.5'],
    ['1500.00', '1500'],
    ['1 250 000', '1250000'],
    ['0', null],
    ['007', '7'],
  ])('%p → %p', (raw, expected) => {
    expect(normalizeAmount(raw)).toBe(expected);
  });

  it('turns Arabic-Indic digits and separators into Latin ones', () => {
    expect(toLatinDigits('٢٬٥٠٠٫٥ ۱۲')).toBe('2,500.5 12');
  });
});

describe('parseNotice', () => {
  it('an Arabic wallet credit with balance, reference and sender', () => {
    const p = parseNotice('تم استلام 1500 أوقية جديدة من 22334455 (أحمد). رقم العملية: 88213451. رصيدك الحالي 25300 أوقية.');
    expect(p).toMatchObject({
      amount: '1500', currency: 'MRU', reference: '88213451', sender: '22334455', direction: 'in', parser: 'generic-v1:ar',
    });
    expect(p.confidence).toBe(100);
  });

  it('Arabic-Indic digits and the Arabic thousands separator', () => {
    const p = parseNotice('استلمت مبلغ ٢٬٥٠٠ أوقية من الرقم ٣٦١٢٣٤٥٦. المرجع: TRX٧٧١٢٠٩');
    expect(p).toMatchObject({ amount: '2500', currency: 'MRU', sender: '36123456', reference: 'TRX771209', direction: 'in' });
  });

  it('an outgoing Arabic transfer is recognised as such and scored low', () => {
    const p = parseNotice('تم تحويل 3000 أوقية إلى 44556677. رقم العملية 99100231');
    expect(p).toMatchObject({ amount: '3000', currency: 'MRU', reference: '99100231', direction: 'out' });
    expect(p.confidence).toBeLessThanOrEqual(40);
  });

  it('a French credit with spaces, a decimal comma and a balance after it', () => {
    const p = parseNotice('Vous avez reçu 1 500,00 MRU de 22 33 44 55. Réf: TX-88213. Solde: 12 450,00 MRU');
    expect(p).toMatchObject({
      amount: '1500', currency: 'MRU', reference: 'TX-88213', sender: '22334455', direction: 'in', parser: 'generic-v1:fr',
    });
  });

  it('a French transfer in UM with "de la part de" and a dotted thousands', () => {
    const p = parseNotice('Virement reçu : montant 25.000 UM de la part de MOHAMED (46112233). N° transaction 5512309');
    expect(p).toMatchObject({ amount: '25000', currency: 'MRU', sender: '46112233', reference: '5512309', direction: 'in' });
  });

  it('ouguiya spelled out, and the amount after the currency', () => {
    expect(parseNotice('Paiement reçu: 750 ouguiyas').amount).toBe('750');
    expect(parseNotice('Montant: MRU 1200, réf AB1234')).toMatchObject({ amount: '1200', currency: 'MRU', reference: 'AB1234' });
  });

  it('dollars and CFA francs', () => {
    expect(parseNotice('Paiement de 10 USD reçu. ID transaction: AB12CD34')).toMatchObject({ amount: '10', currency: 'USD', reference: 'AB12CD34' });
    expect(parseNotice('You received $25.50 from 22112233. Transaction ID: TXN9981. Fee: $0.50')).toMatchObject({
      amount: '25.5', currency: 'USD', sender: '22112233', reference: 'TXN9981', parser: 'generic-v1:en',
    });
    expect(parseNotice('Vous avez reçu 5 000 FCFA de +221 77 123 45 67. Ref 7781AB')).toMatchObject({
      amount: '5000', currency: 'XOF', sender: '221771234567', reference: '7781AB',
    });
    expect(parseNotice('وصلك 20 دولار من 33221100')).toMatchObject({ amount: '20', currency: 'USD', direction: 'in' });
  });

  it('short app formats: "تحويل وارد", "du <number>", "ID:"', () => {
    expect(parseNotice('تحويل وارد: 1,250 MRU من 22445566 مرجع 7781')).toMatchObject({
      amount: '1250', currency: 'MRU', sender: '22445566', reference: '7781', direction: 'in',
    });
    expect(parseNotice('Bankily: Vous avez recu 3000 MRU du 22001122 ID: 1234567890')).toMatchObject({
      amount: '3000', sender: '22001122', reference: '1234567890', direction: 'in',
    });
  });

  it('prefers the received amount over a fee or the balance', () => {
    expect(parseNotice('Solde: 90 000 MRU. Vous avez reçu 4 000 MRU, frais 40 MRU').amount).toBe('4000');
    expect(parseNotice('رسوم 50 أوقية. استلمت 6000 أوقية').amount).toBe('6000');
  });

  it('does not take a large amount for a phone number', () => {
    const p = parseNotice('Virement de 12 500 000 MRU reçu');
    expect(p.amount).toBe('12500000');
    expect(p.sender).toBeNull();
  });

  it('a reference without digits is a word, not a reference', () => {
    expect(parseNotice('Réf: paiement reçu 100 MRU').reference).toBeNull();
  });

  it('nothing useful gives zero confidence', () => {
    expect(parseNotice('Bienvenue dans votre application')).toMatchObject({
      amount: null, currency: null, reference: null, sender: null, direction: 'unknown', confidence: 5,
    });
  });

  it('an amount without a currency counts less', () => {
    const p = parseNotice('montant: 1500, reçu');
    expect(p).toMatchObject({ amount: '1500', currency: null });
    expect(p.confidence).toBe(35);
  });
});
