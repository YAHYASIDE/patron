-- Research caveats on a market payment method (e.g. "seen in search results only"), so an
-- unconfirmed fact is never shown to the owner as a confirmed one. Additive, nullable.
ALTER TABLE "market_payment_methods" ADD COLUMN "note" TEXT;
