---
name: patron-usdt
description: >-
  Patron USDT sales section: config (rates, fees, limits, networks), quotes, orders
  with frozen totals, address validation per network (TRC20, BEP20, ERC20, Binance),
  payment proof, staff review, manual sending with TXID, audit trail, expiry. Use for
  "USDT", "بيع USDT", "عنوان المحفظة", "TXID", crypto orders. The service is disabled
  until the owner approves; nothing is ever sent automatically.
---

# Patron USDT

## Model and flow
UsdtOrder (number, amountUsdt, delivery ONCHAIN|BINANCE, network, address/binanceId, frozen rate,
fee, total, currency, status, payment fields, txid UNIQUE, idempotencyKey UNIQUE) + UsdtOrderEvent
(every transition, actor). Statuses: NEW → AWAITING_PAYMENT → UNDER_REVIEW → READY_TO_SEND →
COMPLETED; REJECTED/CANCELLED terminal. Code `apps/api/src/modules/usdt`, store `/usdt`, dashboard
`/usdt`, compliance notes `docs/USDT_COMPLIANCE.md`.

## Rules
- Off by default (`usdt.config.enabled=false`); public routes answer USDT_DISABLED. Turning it on is
  the owner's legal decision (see the compliance doc), never a code default.
- Totals computed on the server with Decimal; the customer sees rate, fee and total before confirming.
- Address must match the network (TRC20 base58check `T…`; EVM `0x` + 40 hex with EIP-55 when mixed
  case); wrong network is refused — USDT sent on the wrong chain is lost.
- Nothing sends USDT automatically: staff approve the payment, send by hand, then enter the TXID
  (format checked per network, unique). Every action is locked, audited and evented.
- Idempotency-Key on order creation; one key → one order.
- No real transfers in development; test addresses are generated, never someone's real wallet.

## Tests
Unit: validators (valid/invalid per network, checksum), quote math, status machine. Integration:
concurrent approve/complete on one order → one wins. E2E: disabled → 4xx; enabled flow end to end.

## Verify this skill worked
On a local stack with the config enabled: quote → order → payment proof → approve → complete with a
fake TXID → the customer's timeline shows each step; with the config disabled the store hides it.
