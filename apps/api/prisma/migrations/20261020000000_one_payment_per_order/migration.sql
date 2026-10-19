-- One settled payment per order. The payment service already serialises
-- payments on the order's row lock; this index is the database's own guard,
-- so no future code path can settle the same order twice.
--
-- An order that already holds two settled payments (made before the fix)
-- would make the index fail and stop the deploy, so in that case the index is
-- skipped and the duplicates are left for the owner to refund; the row lock
-- still protects every new payment.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "payments"
    WHERE "status" IN ('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED')
    GROUP BY "orderId" HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "payments_one_settled_per_order"
      ON "payments" ("orderId")
      WHERE "status" IN ('CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED');
  ELSE
    RAISE NOTICE 'payments_one_settled_per_order skipped: an order already has more than one settled payment';
  END IF;
END $$;
