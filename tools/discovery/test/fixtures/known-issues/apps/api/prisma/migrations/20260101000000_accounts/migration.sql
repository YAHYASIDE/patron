-- Fixture: a Mauritanian method offered in Mali and an account with no countries.
INSERT INTO "system_settings" ("key", "value", "group", "isPublic", "description", "updatedAt")
VALUES ('payments.manual_accounts', '[{"id": "bankily", "method": "Bankily", "countries": ["MR", "ML"], "accountName": "", "accountNumber": "", "kind": "mobile", "enabled": false}, {"id": "anywhere", "method": "Some Bank", "countries": [], "accountName": "", "accountNumber": "", "kind": "bank", "enabled": false}, {"id": "orangemoney-ml", "method": "Orange Money", "countries": ["ML"], "accountName": "", "accountNumber": "", "kind": "mobile", "enabled": false}]'::jsonb, 'payments', true, 'Manual transfer accounts', NOW())
ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value";

INSERT INTO "market_payment_methods" ("id", "countryCode", "key", "name", "kind", "lastVerifiedAt", "verifiedBy", "updatedAt") VALUES
  (gen_random_uuid(), 'NE', 'masrvi-ne', 'Masrvi', 'mobile_money', NOW(), 'fixture', NOW());
