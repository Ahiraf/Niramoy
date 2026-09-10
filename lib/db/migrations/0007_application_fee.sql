-- Niramoy — 0007: keep the fee and the hours the applicant actually gave
--
-- The doctor application form asks for a consultation fee and marks it
-- required, so every applicant supplies one. Nothing stored it. The column it
-- should have filled — doctors.fee_amount — defaults to 0, and the profile an
-- admin published therefore advertised a free consultation to every patient.
--
-- The doctor had no way to notice: the fee is shown on the PATIENT's view of
-- the profile, not on the form they submitted, and the number they typed
-- disappeared between the two.
--
-- Kept with the rest of the claim rather than written straight onto the
-- profile, because that is what this table is for: an admin compares what was
-- claimed against the register before any of it goes live.

ALTER TABLE "doctor_verifications"
  ADD COLUMN IF NOT EXISTS "claimed_fee" numeric(10, 2);
--> statement-breakpoint

-- The same form asks which days and hours the doctor consults, and sends them.
-- They were discarded too, so an approved doctor was published with no
-- availability rules at all — and a patient opening the profile was told
-- "Fully booked for the next three weeks", which was not true. She had no
-- hours, which is a different thing and needs a different answer.
--
-- Stored as the claim, in local minutes past midnight for the rule's own
-- timezone, which is how doctor_availability holds them.

ALTER TABLE "doctor_verifications"
  ADD COLUMN IF NOT EXISTS "claimed_availability" jsonb NOT NULL DEFAULT '[]'::jsonb;
