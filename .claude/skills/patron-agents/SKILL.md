---
name: patron-agents
description: >-
  Patron referral agents (المندوبون) and commissions: agent accounts and codes,
  referral capture, order attribution, commission rules (percent or fixed), the
  commission lifecycle (pending, earned, paid, void, clawback), payouts and agent
  statements, plus customer segments. Use for "مندوب", "عمولة", "إحالة", "agents",
  "commissions", "payouts", customer segmentation.
---

# Patron agents

## Model
Agent (userId unique, code unique, commissionType PERCENT|FIXED, commissionValue, isActive),
User.referredByAgentId (set once at account creation), Order.agentId (set at order creation from
the customer's active referrer), Commission (orderId UNIQUE, basis, amount, rule snapshot, status
PENDING→EARNED→PAID or VOID, payoutId), AgentPayout. Role `agent` with `agents.self`; staff
`agents.manage`. Code: `apps/api/src/modules/agents`; dashboard `/agents`; store `/agent`.

## Invariants (see patron-payment-guardian)
- One commission per order (DB unique) — concurrent events cannot create two.
- Commission is earned only for COMPLETED orders, on the net value after refunds; cancelled,
  failed or fully refunded orders → VOID with reason.
- Paid history is never rewritten; a refund after payout appears as a visible clawback.
- A payout marks only EARNED commissions PAID, in one locked transaction.
- Referral codes cannot be self-applied and cannot change after signup.
- An agent sees only their own referrals (masked phones) and commissions.

## Tests
Unit: rules, recompute on partial refund, void paths, payout totals. Integration: concurrent
order events → one commission; payout twice → second refused. E2E: agent cannot read others.

## Verify this skill worked
Create agent → sign up with ?ref → order → complete → EARNED with the right amount → payout →
PAID → refund → clawback visible; all on a local stack, matching the statement totals.
