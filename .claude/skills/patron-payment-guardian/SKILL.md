---
name: patron-payment-guardian
description: >-
  Guard every place Patron moves or records money: wallet ledger, payments (manual
  transfer, wallet, Stripe), captures, refunds, order states, coupons, commissions,
  USDT orders. Use whenever a change touches payments, wallet, refunds, orders,
  checkout, prices, agents/commissions or USDT, or when asked about double charges,
  "خصم مكرر", "استرجاع", "رصيد", reconciliation. Load before editing those modules.
---

# Patron payment guardian

## Invariants (must hold after every change)
1. **One charge per order.** Wallet payment = one transaction: lock wallet → lock order
   (`acquireLocks`, apps/api/src/common/locking/lock-order.ts; ADR 010/013 order:
   wallet → order → payment → refund), re-read the order and require PENDING_PAYMENT,
   create the payment, debit, capture. DB guard: unique index
   `payments_one_settled_per_order` (skipped only if old duplicates existed; those show in
   `/admin/orders/attention` → duplicatePayments).
2. **The ledger is the truth.** Wallet balances change only through `WalletService`
   credit/debit with a WalletTransaction (`balanceAfter`); `findDriftFull()` must return 0 rows.
3. **Idempotency** on every money-moving POST (`Idempotency-Key` header, ADR 004):
   quotes, orders, payments, wallet ops, USDT orders.
4. **Server-side totals.** Prices come from the frozen quote (15 min, `QUOTE_EXPIRED`), never
   from the client. Use `Prisma.Decimal`, never JS floats, for money math.
5. **No automatic confirmation from weak evidence.** A manual transfer is AUTHORIZED by the
   customer's report and becomes CAPTURED only when a person approves. Bank notifications
   from the Android admin app are evidence only (BankNotification), never approval.
   USDT is never sent automatically; staff enter the TXID.
6. **Refunds**: cumulative `refundedAmount` ≤ captured amount; a manual refund to the original
   method needs the reference of the transfer the owner sent (`REFUND_REFERENCE_REQUIRED`);
   WALLET payments refund to the wallet; partial refunds can follow one another.
7. **Order state machine** (`orders/order-state.machine.ts`) is the only way to change
   status; `syncStatus` derives it from items and emits `order.<status>` outbox events.
8. **Commissions** (agents): at most one per order (unique `commissions.orderId`), only EARNED
   on completed orders, VOID on cancel/refund/fail, never re-paid; paid history is never
   silently rewritten (clawbacks are visible).
9. **Reports**: net revenue = totalBase − max(refunded, owed lines) (`reports/sales-sql.ts`);
   wallet usage is not cash.

## Checklist for a money change
- Which rows are written? Are they locked in the canonical order inside one transaction?
- What happens if the same request arrives twice at the same time? Write the test:
  `test/integration/*concurrency*.spec.ts` with `Promise.all` on a real Postgres.
- What does the customer see, what does the owner see, and what lands in the backup?
- Is the audit log written for staff actions? Is a staff notice raised/resolved?

## Tests to run
`apps/api`: unit `payments.service.spec`, `refunds.service.spec`, `orders.service.spec`,
`wallet*.spec`; integration `wallet-payment.concurrency.spec`, `report-summary.spec`;
e2e `money-flows.e2e-spec` (parallel wallet pay, partial refunds, QUOTE_EXPIRED).
Live: patron-live-tester money checks.

## Never
Real payments or transfers in development; real customer data in tests; changing payment
rules without a test that shows the old and new behaviour.

## Verify this skill worked
For the change, name each invariant touched and the test that proves it still holds.
