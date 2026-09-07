-- Niramoy — 0006: the admin decides who may register as a doctor
--
-- Until now anybody could create a doctor account and the register was checked
-- afterwards, with the profile held back until it passed. This inverts that:
-- an admin confirms a registration number against the BM&DC register by hand,
-- records it here together with the mobile number that doctor will use, and
-- only that pair can complete a doctor sign-up.
--
-- Two columns, not one, because either alone is weak. The number alone is
-- public information printed on a nameplate, so anyone who can read one could
-- claim it. The mobile alone identifies a handset, not a clinician. Requiring
-- both means the person signing up has to hold the phone the admin was told
-- about AND quote the number the admin already checked.
--
-- The row is spent, not deleted, when it is used: `claimed_by_user_id` is the
-- record of which account an approval produced, which is what makes the chain
-- from "an admin approved A-45312" to "this account treats itself as verified"
-- auditable afterwards.

CREATE TABLE "doctor_approvals" (
  "id"                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Normalised on the way in, so the lookup at sign-up cannot miss on spacing
  -- or a lowercase prefix.
  "registration_number" text NOT NULL,
  "registration_type"   text NOT NULL,
  -- E.164, the same shape sign-up proves by SMS.
  "phone"               text NOT NULL,

  -- What the register said, for the admin's own records. Not shown to the
  -- applicant and never used to fill their profile: a name typed here is one
  -- person's transcription, not the doctor's own claim.
  "register_name"       text,
  "note"                text,

  "status"              text NOT NULL DEFAULT 'open',

  "created_by_user_id"  uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at"          timestamptz NOT NULL DEFAULT now(),

  "claimed_by_user_id"  uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "claimed_at"          timestamptz,

  "revoked_by_user_id"  uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "revoked_at"          timestamptz
);
--> statement-breakpoint

ALTER TABLE "doctor_approvals"
  ADD CONSTRAINT "ck_doctor_approvals_status"
  CHECK ("status" IN ('open', 'claimed', 'revoked'));
--> statement-breakpoint

-- A claimed row must say which account claimed it, and when; a revoked one
-- must say who revoked it. A status with no evidence behind it is not a record
-- of anything, and this table exists to be the record.
ALTER TABLE "doctor_approvals"
  ADD CONSTRAINT "ck_doctor_approvals_claim_evidence" CHECK (
    ("status" <> 'claimed')
      OR ("claimed_by_user_id" IS NOT NULL AND "claimed_at" IS NOT NULL)
  );
--> statement-breakpoint

ALTER TABLE "doctor_approvals"
  ADD CONSTRAINT "ck_doctor_approvals_revoke_evidence" CHECK (
    ("status" <> 'revoked') OR ("revoked_at" IS NOT NULL)
  );
--> statement-breakpoint

-- One live approval per registration number. Revoked and claimed rows stay for
-- the audit trail, so the uniqueness is partial rather than a plain unique
-- constraint: an approval that was revoked by mistake can be issued again.
CREATE UNIQUE INDEX "uq_doctor_approvals_open_number"
  ON "doctor_approvals" ("registration_number")
  WHERE "status" = 'open';
--> statement-breakpoint

-- The sign-up lookup is by both columns together, never by either alone.
CREATE INDEX "idx_doctor_approvals_lookup"
  ON "doctor_approvals" ("registration_number", "phone");
