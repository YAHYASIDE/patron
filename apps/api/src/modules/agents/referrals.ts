import { Prisma } from '@prisma/client';

import { normalizeCode } from './commission-rules';

type Tx = Prisma.TransactionClient;

/**
 * Credit a brand-new account to the agent whose code brought it. Called inside
 * the transaction that creates the user, and only there: a referral is fixed at
 * sign-up and never changed afterwards. An unknown, inactive or self-owned code
 * is ignored silently — a bad link must never stop someone from signing up.
 */
export async function applyReferral(tx: Tx, userId: string, rawCode: string | null | undefined): Promise<string | null> {
  const code = normalizeCode(rawCode);
  if (!code) return null;
  const agent = await tx.agent.findUnique({ where: { code }, select: { id: true, userId: true, isActive: true } });
  if (!agent || !agent.isActive || agent.userId === userId) return null;
  // only while still unset: the first referrer keeps the customer
  const { count } = await tx.user.updateMany({
    where: { id: userId, referredByAgentId: null },
    data: { referredByAgentId: agent.id },
  });
  return count ? agent.id : null;
}

/**
 * The agent an order is credited to: the customer's referrer, when that agent
 * is still active and is not the customer themself. Read once, at order creation.
 */
export async function agentForOrder(tx: Tx, userId: string): Promise<string | null> {
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { referredByAgent: { select: { id: true, userId: true, isActive: true } } },
  });
  const agent = user?.referredByAgent;
  return agent && agent.isActive && agent.userId !== userId ? agent.id : null;
}
