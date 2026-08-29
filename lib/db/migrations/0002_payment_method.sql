-- Niramoy — 0002: the payment instrument the patient chose
--
-- `provider` already records which gateway ran the transaction. It does not
-- record what the patient picked, and those are different facts: a bKash
-- payment run through the sandbox and one run through a live merchant account
-- are the same instrument on two different gateways, and a consultation settled
-- in cash at the chamber has no gateway at all.
--
-- Defaulting to 'bkash' is safe for the rows already present: every existing
-- payment was created by the mock provider, which stands in for the wallet
-- flow, and none of them represents money that moved.

CREATE TYPE "payment_method" AS ENUM ('bkash', 'cash');
--> statement-breakpoint

ALTER TABLE "payments"
  ADD COLUMN "method" "payment_method" NOT NULL DEFAULT 'bkash';
--> statement-breakpoint

-- A cash consultation is settled in person, so it never has a gateway
-- reference and must never be marked succeeded by a webhook that could not
-- have been issued for it.
ALTER TABLE "payments"
  ADD CONSTRAINT "ck_payments_cash_has_no_provider_ref" CHECK (
    "method" <> 'cash' OR "provider_payment_id" IS NULL
  );
