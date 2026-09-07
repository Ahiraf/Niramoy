-- Niramoy — 0003: where a person wants to be told about their care
--
-- Until now every notification was written with channel = 'in_app' and nothing
-- was ever delivered anywhere else, while the settings screen offered toggles
-- that were local component state and persisted nothing. This column is what
-- makes those toggles mean something.
--
-- `in_app` is deliberately NOT one of the values. The notification row is the
-- record that the patient was told, and the platform needs that record whether
-- or not they ever open the app; it is not a preference. These are the
-- additional channels a copy is sent on.
--
-- Defaulting to '["email"]' preserves what people were shown before: the
-- settings screen had email notifications switched on for everyone.

ALTER TABLE "users"
  ADD COLUMN "notification_channels" jsonb NOT NULL DEFAULT '["email"]'::jsonb;
--> statement-breakpoint

-- Only channels the system knows about. A typo here would otherwise sit in the
-- column until a delivery attempt failed on it. Containment (`<@`) rather than
-- a subquery, which CHECK does not allow.
ALTER TABLE "users"
  ADD CONSTRAINT "ck_users_notification_channels" CHECK (
    jsonb_typeof("notification_channels") = 'array'
    AND "notification_channels" <@ '["email", "sms", "whatsapp"]'::jsonb
  );
