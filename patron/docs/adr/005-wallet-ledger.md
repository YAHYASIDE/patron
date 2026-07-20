# ADR 005 — Wallet as an append-only ledger with row locking

**Status:** Accepted · **Date:** 2026-07-20

## Context

A balance stored as a single mutable number is a lost-update bug waiting to
happen: two concurrent debits both read 100, both write 50, and 50 units are
spent twice. With four currencies, a single `walletBalance` column also cannot
represent a customer holding both EUR and XOF.

## Decision

One `Wallet` row per (user, currency). `wallet_transactions` is append-only and
records `balanceBefore`, `amount` and `balanceAfter`; the wallet's `balance` is
a cached projection of it. Every mutation goes through `WalletService.post()`,
which takes `SELECT ... FOR UPDATE` on the wallet row before reading.

A database CHECK enforces `balanceAfter = balanceBefore + amount`, and another
forbids a negative balance.

## Consequences

- Concurrent debits serialise; over-spending is impossible.
- Every balance change has a row explaining it — support can answer "where did
  my money go" without guesswork.
- A nightly reconciliation job compares the cached balance to the ledger sum.
  Drift means a write bypassed `post()`; the job alerts rather than
  auto-correcting, because silently fixing it destroys the evidence.
- Callers must pass a transaction client, making the debit and the order state
  change commit together or not at all.
