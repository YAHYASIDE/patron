import { Prisma } from '@prisma/client';

/** A manual payment still waiting for the owner (INITIATED or AUTHORIZED, last 48 h). */
export interface PaymentCandidate {
  id: string;
  amount: Prisma.Decimal | string;
  currency: string;
  status: string;
  /** What the customer reported with the transfer (payment.rawResponse.transfer). */
  reference?: string | null;
  payerPhone?: string | null;
  createdAt: Date;
}

export interface NoticeFacts {
  amount: string | null;
  currency: string | null;
  reference: string | null;
  sender: string | null;
}

export interface MatchResult {
  paymentId: string;
  score: number;
  reasons: Array<'amount' | 'reference' | 'phone' | 'reported'>;
}

/** Compare references without case, spaces or dashes: "tx-88213" = "TX 88213". */
const refKey = (s: string | null | undefined) => (s ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();
/** Compare phone numbers on their last 8 digits (a Mauritanian number without +222). */
const phoneKey = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '').slice(-8);

/**
 * Suggests which waiting manual payment a bank notice is about: the same
 * amount and currency is required; a matching reference or payer number makes
 * it stronger, and a transfer the customer already reported counts a little
 * more than one only started. When two payments are equally likely nothing is
 * suggested — a wrong suggestion is worse than none. A suggestion is only a
 * pointer for the owner; it never approves anything.
 */
export function matchPayment(notice: NoticeFacts, candidates: PaymentCandidate[]): MatchResult | null {
  if (!notice.amount || !notice.currency) return null;
  const amount = new Prisma.Decimal(notice.amount);
  const ref = refKey(notice.reference);
  const phone = phoneKey(notice.sender);

  const scored = candidates
    .filter((c) => c.currency === notice.currency && new Prisma.Decimal(c.amount).equals(amount))
    .map((c): MatchResult => {
      const reasons: MatchResult['reasons'] = ['amount'];
      let score = 50;
      if (ref.length >= 4 && refKey(c.reference) === ref) {
        score += 30;
        reasons.push('reference');
      }
      if (phone.length === 8 && phoneKey(c.payerPhone) === phone) {
        score += 15;
        reasons.push('phone');
      }
      if (c.status === 'AUTHORIZED') {
        score += 5;
        reasons.push('reported');
      }
      return { paymentId: c.id, score, reasons };
    })
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;
  if (scored.length > 1 && scored[1].score === scored[0].score) return null;
  return scored[0];
}
