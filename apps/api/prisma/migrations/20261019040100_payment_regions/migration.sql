-- Payment by country, as the owner set it out:
--   Mauritania (MRU): Bankily, Masrvi, Sedad, Klic, BIM Bank, Nita (22227268),
--     Orange Money (74646158), Binance
--   Mali (FCFA or USD): Orange Money, Nita, Moov Money
--   Algeria (dinar or USD): BaridiMob, Baridi Cash, Binance
--   Niger (FCFA or USD): Nita, Orange Money
--   Everywhere else (USD): USDT, Binance, Bankily
-- Methods whose receiving number the owner has not given yet start disabled;
-- they fill it in from the dashboard. "XX" means every other country.

-- Algerian dinar, priced from USD at a rate the owner can change.
INSERT INTO "currencies" ("code", "nameAr", "nameEn", "symbol", "decimals", "isBase", "isActive", "sortOrder", "roundingStep", "updatedAt")
VALUES ('DZD', 'دينار جزائري', 'Algerian Dinar', 'DA', 0, false, true, 5, 10, NOW())
ON CONFLICT ("code") DO NOTHING;

-- (a fresh database has no USD until the seed runs; the seed adds this rate then)
INSERT INTO "fx_rates" ("baseCurrency", "quoteCurrency", "rate", "source")
SELECT 'USD', 'DZD', 133, 'MANUAL'
WHERE EXISTS (SELECT 1 FROM "currencies" WHERE "code" = 'USD')
  AND NOT EXISTS (SELECT 1 FROM "fx_rates" WHERE "baseCurrency" = 'USD' AND "quoteCurrency" = 'DZD' AND "isActive");

-- the owner gave this list explicitly, so it replaces the earlier accounts
INSERT INTO "system_settings" ("key", "value", "group", "isPublic", "description", "updatedAt")
VALUES ('payments.manual_accounts', '[{"id": "bankily", "method": "Bankily", "countries": ["MR", "XX"], "accountName": "", "accountNumber": "22227268", "kind": "mobile", "logo": "bankily", "enabled": true}, {"id": "masrvi", "method": "Masrvi", "countries": ["MR"], "accountName": "", "accountNumber": "22227268", "kind": "mobile", "logo": "masrvi", "enabled": true}, {"id": "sedad", "method": "Sedad", "countries": ["MR"], "accountName": "", "accountNumber": "22227268", "kind": "mobile", "logo": "sedad", "enabled": true}, {"id": "klic", "method": "Klic", "countries": ["MR"], "accountName": "", "accountNumber": "22227268", "kind": "mobile", "logo": "klic", "enabled": true}, {"id": "bimbank", "method": "BIM Bank", "countries": ["MR"], "accountName": "", "accountNumber": "22227268", "kind": "bank", "logo": "bimbank", "enabled": true}, {"id": "nita", "method": "Nita", "countries": ["MR"], "accountName": "", "accountNumber": "22227268", "kind": "mobile", "logo": "nita", "enabled": true}, {"id": "orangemoney", "method": "Orange Money", "countries": ["MR"], "accountName": "", "accountNumber": "74646158", "kind": "mobile", "logo": "orange", "enabled": true}, {"id": "orangemoney-ml", "method": "Orange Money", "countries": ["ML"], "accountName": "", "accountNumber": "", "kind": "mobile", "logo": "orange", "enabled": false}, {"id": "nita-ml", "method": "Nita", "countries": ["ML", "NE"], "accountName": "", "accountNumber": "", "kind": "mobile", "logo": "nita", "enabled": false}, {"id": "moov-ml", "method": "Moov Money", "countries": ["ML"], "accountName": "", "accountNumber": "", "kind": "mobile", "logo": "moov", "enabled": false}, {"id": "baridimob", "method": "BaridiMob", "countries": ["DZ"], "accountName": "", "accountNumber": "", "kind": "bank", "logo": "baridimob", "enabled": false}, {"id": "baridicash", "method": "Baridi Cash", "countries": ["DZ"], "accountName": "", "accountNumber": "", "kind": "bank", "logo": "baridicash", "enabled": false}, {"id": "orangemoney-ne", "method": "Orange Money", "countries": ["NE"], "accountName": "", "accountNumber": "", "kind": "mobile", "logo": "orange", "enabled": false}, {"id": "binance", "method": "Binance Pay", "countries": ["MR", "DZ", "XX"], "accountName": "", "accountNumber": "", "kind": "crypto", "logo": "binance", "enabled": false}, {"id": "usdt", "method": "USDT (TRC20)", "countries": ["XX"], "accountName": "", "accountNumber": "", "kind": "crypto", "logo": "usdt", "enabled": false, "instructions": "أرسل على شبكة TRC20 فقط."}]'::jsonb, 'payments', true, 'Manual transfer accounts shown at checkout', NOW())
ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW();
