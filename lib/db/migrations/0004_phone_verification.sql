-- Niramoy — 0004: proving the mobile number at sign-up
--
-- An appointment reminder is only worth sending to a number somebody actually
-- holds. Until now `users.phone` was whatever the sign-up form was given: never
-- checked, never normalised, and — because a typo looks exactly like a correct
-- number — trusted anyway. This adds the fact that it was proved.
--
-- `phone_verified_at` is a fact about the number currently in `phone`, so the
-- application clears it whenever the number is edited. The CHECK below stops
-- the one state that could never be true: verified, with no number.
--
-- `attempt_count` exists because a six-digit code is guessable and a 32-byte
-- link token is not. Counting wrong guesses on the token lets a burnt code die
-- by itself, without locking the account whose number is being guessed at —
-- which would hand an attacker a denial-of-service instead of an account.

ALTER TYPE "token_purpose" ADD VALUE IF NOT EXISTS 'phone_verification';
--> statement-breakpoint

ALTER TABLE "users"
  ADD COLUMN "phone_verified_at" timestamptz;
--> statement-breakpoint

ALTER TABLE "users"
  ADD CONSTRAINT "ck_users_phone_verified_has_phone" CHECK (
    "phone_verified_at" IS NULL OR "phone" IS NOT NULL
  );
--> statement-breakpoint

ALTER TABLE "auth_tokens"
  ADD COLUMN "attempt_count" integer NOT NULL DEFAULT 0;
