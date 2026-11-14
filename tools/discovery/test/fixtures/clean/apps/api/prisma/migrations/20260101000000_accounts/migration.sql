-- Fixture: every account serves its own country only.
INSERT INTO "system_settings" ("key", "value", "group", "isPublic", "description", "updatedAt")
VALUES ('payments.manual_accounts', '[{"id": "bankily", "method": "Bankily", "countries": ["MR"], "accountName": "", "accountNumber": "", "kind": "mobile", "enabled": false}, {"id": "orangemoney-ml", "method": "Orange Money", "countries": ["ML"], "accountName": "", "accountNumber": "", "kind": "mobile", "enabled": false}]'::jsonb, 'payments', true, 'Manual transfer accounts', NOW())
ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value";
