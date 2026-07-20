-- Post-restore reconciliation.
--
-- Between a backup and a restore, payments may have been captured at the
-- gateway that the restored database has no record of. Those customers have
-- paid and own nothing. Run every query below and settle each row manually
-- before letting traffic back in.

\echo '── 1. Orders paid but never fulfilled ──'
SELECT o."orderNumber", o."userId", o."total", o."currency",
       EXTRACT(EPOCH FROM (NOW() - o."paidAt")) / 60 AS minutes_waiting
FROM "orders" o
WHERE o."status" IN ('PAID', 'PROCESSING')
  AND o."paidAt" < NOW() - INTERVAL '15 minutes'
ORDER BY o."paidAt";

\echo '── 2. Captured payments whose order is not marked paid ──'
SELECT p."gatewayRef", p."amount", p."currency", o."orderNumber", o."status"
FROM "payments" p JOIN "orders" o ON o."id" = p."orderId"
WHERE p."status" = 'CAPTURED' AND o."status" = 'PENDING_PAYMENT';

\echo '── 3. Wallet drift: cached balance vs ledger ──'
SELECT w."id", w."userId", w."currencyCode",
       w."balance" AS cached,
       COALESCE(SUM(t."amount"), 0) AS ledger
FROM "wallets" w
LEFT JOIN "wallet_transactions" t ON t."walletId" = w."id"
GROUP BY w."id"
HAVING w."balance" <> COALESCE(SUM(t."amount"), 0);

\echo '── 4. Delivered items with no stored result (code lost) ──'
SELECT i."id", o."orderNumber", i."productNameEn"
FROM "order_items" i
JOIN "orders" o ON o."id" = i."orderId"
LEFT JOIN "order_results" r ON r."orderItemId" = i."id"
WHERE i."status" = 'DELIVERED' AND r."id" IS NULL;

\echo '── 5. Outbox events stranded or dead ──'
SELECT "status", COUNT(*), MIN("createdAt") AS oldest
FROM "outbox_events" WHERE "status" IN ('PENDING', 'DEAD') GROUP BY "status";

\echo '── 6. Provider calls with no matching order item (paid for nothing) ──'
SELECT c."id", p."code", c."createdAt", c."idempotencyKey"
FROM "provider_calls" c
JOIN "providers" p ON p."id" = c."providerId"
LEFT JOIN "order_items" i ON i."id" = c."orderItemId"
WHERE c."success" AND i."id" IS NULL
ORDER BY c."createdAt" DESC LIMIT 100;

\echo '── 7. FX rate staleness ──'
SELECT DISTINCT ON ("quoteCurrency") "quoteCurrency", "rate",
       EXTRACT(EPOCH FROM (NOW() - "effectiveAt")) / 3600 AS hours_old
FROM "fx_rates" WHERE "isActive" ORDER BY "quoteCurrency", "effectiveAt" DESC;
