-- The shop's WhatsApp number, shown to customers who want to reach the owner
-- (e.g. to hurry a verification code). Public by design; the owner changes it
-- in the dashboard settings. Insert-only: an owner's edit is never overwritten.
INSERT INTO "system_settings" ("key", "value", "group", "isPublic", "description", "updatedAt")
VALUES ('shop.support_whatsapp', '"+22222227268"'::jsonb, 'shop', true, 'The shop''s WhatsApp number for customers', NOW())
ON CONFLICT ("key") DO NOTHING;
