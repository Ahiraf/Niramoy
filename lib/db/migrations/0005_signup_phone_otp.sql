-- Niramoy — 0005: proving the number before the account exists
--
-- Sign-up now begins with the mobile number: a code goes out, and the rest of
-- the form does not appear until it comes back. That is a different shape from
-- 0004, which verified the number of an account that already existed.
--
-- It needs its own table because `auth_tokens.user_id` is NOT NULL, and there
-- is deliberately no user yet. Making that column nullable instead would have
-- weakened a constraint that is load-bearing for password-reset and
-- email-verification tokens, to serve a flow that is not about a user at all.
--
-- The `ticket_hash` column is what stops a verification being ridden by
-- somebody else. The code proves the number; the ticket proves it was THIS
-- browser that proved it, and registration spends the ticket exactly once.
--
-- Rows are disposable — the cron sweep deletes them once they expire. Nothing
-- here is a credential for an existing account, and nothing in it may be used
-- to answer "does this number already have one?".

CREATE TABLE "phone_verifications" (
  "id"                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "phone"             text NOT NULL,
  "code_hash"         text NOT NULL,
  "expires_at"        timestamptz NOT NULL,
  "attempt_count"     integer NOT NULL DEFAULT 0,
  "verified_at"       timestamptz,
  "ticket_hash"       text,
  "consumed_at"       timestamptz,
  "requested_ip_hash" text,
  "created_at"        timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint

-- A ticket exists only after a correct code, and a consumed row must have had
-- one. Both directions, because a row that says "spent" without ever having
-- been verified would mean registration accepted something it should not have.
ALTER TABLE "phone_verifications"
  ADD CONSTRAINT "ck_phone_verifications_ticket_after_verify" CHECK (
    ("ticket_hash" IS NULL) = ("verified_at" IS NULL)
    AND ("consumed_at" IS NULL OR "verified_at" IS NOT NULL)
  );
--> statement-breakpoint

CREATE INDEX "idx_phone_verifications_phone" ON "phone_verifications" ("phone");
--> statement-breakpoint

CREATE INDEX "idx_phone_verifications_expires" ON "phone_verifications" ("expires_at");
