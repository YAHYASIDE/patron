import { Prisma } from '@prisma/client';
import { PaymentCandidate, matchPayment } from '../../src/modules/bank-notices/bank-notice.matcher';

const pay = (id: string, over: Partial<PaymentCandidate> = {}): PaymentCandidate => ({
  id, amount: new Prisma.Decimal('1500'), currency: 'MRU', status: 'AUTHORIZED', reference: null, payerPhone: null,
  createdAt: new Date(), ...over,
});
const notice = { amount: '1500', currency: 'MRU', reference: null as string | null, sender: null as string | null };

describe('matchPayment', () => {
  it('needs an amount and a currency', () => {
    expect(matchPayment({ ...notice, amount: null }, [pay('p1')])).toBeNull();
    expect(matchPayment({ ...notice, currency: null }, [pay('p1')])).toBeNull();
  });

  it('suggests the one waiting payment with the same amount and currency', () => {
    expect(matchPayment(notice, [pay('p1'), pay('p2', { amount: '1600' }), pay('p3', { currency: 'USD' })])).toEqual({
      paymentId: 'p1', score: 55, reasons: ['amount', 'reported'],
    });
  });

  it('compares amounts as decimals, not text', () => {
    expect(matchPayment({ ...notice, amount: '1500' }, [pay('p1', { amount: '1500.0000' })])?.paymentId).toBe('p1');
    expect(matchPayment({ ...notice, amount: '12.5' }, [pay('p1', { amount: '12.50' })])?.paymentId).toBe('p1');
  });

  it('suggests nothing when two payments are equally likely', () => {
    expect(matchPayment(notice, [pay('p1'), pay('p2')])).toBeNull();
  });

  it('a matching reference or payer number decides between them', () => {
    const byRef = matchPayment({ ...notice, reference: 'TX-88213' }, [pay('p1'), pay('p2', { reference: 'tx 88213' })]);
    expect(byRef).toEqual({ paymentId: 'p2', score: 85, reasons: ['amount', 'reference', 'reported'] });

    const byPhone = matchPayment({ ...notice, sender: '22222334455' }, [pay('p1', { payerPhone: '+222 22 33 44 55' }), pay('p2')]);
    expect(byPhone).toMatchObject({ paymentId: 'p1', reasons: ['amount', 'phone', 'reported'] });
  });

  it('a reported transfer counts more than one only started', () => {
    expect(matchPayment(notice, [pay('p1', { status: 'INITIATED' }), pay('p2')])?.paymentId).toBe('p2');
  });

  it('short references and partial phone numbers do not count', () => {
    const r = matchPayment({ ...notice, reference: '12', sender: '4455' }, [pay('p1', { reference: '12', payerPhone: '4455' })]);
    expect(r?.reasons).toEqual(['amount', 'reported']);
  });

  it('no candidates, no suggestion', () => {
    expect(matchPayment(notice, [])).toBeNull();
  });
});
