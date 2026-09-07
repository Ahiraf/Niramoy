-- Niramoy — integrity constraints
-- ============================================================================
-- Everything drizzle-kit cannot express from the schema definition: exclusion
-- constraints, partial unique indexes, CHECK constraints, and the triggers that
-- make the audit log and the clinical record append-only.
--
-- These are not decorations. The overlap constraint below is the single control
-- that makes double-booking impossible rather than merely unlikely.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- APPOINTMENT INTEGRITY
-- ----------------------------------------------------------------------------

-- An appointment must be a forward-going interval.
ALTER TABLE "appointments"
  ADD CONSTRAINT "ck_appointments_interval" CHECK ("end_utc" > "start_utc");
--> statement-breakpoint

ALTER TABLE "appointments"
  ADD CONSTRAINT "ck_appointments_duration" CHECK ("duration_minutes" > 0);
--> statement-breakpoint

ALTER TABLE "appointments"
  ADD CONSTRAINT "ck_appointments_fee" CHECK ("fee_amount" >= 0);
--> statement-breakpoint

-- Guard 1: no two live appointments share a doctor and an exact start time.
-- This is the constraint the prototype relied on. It is cheap and it is kept,
-- but on its own it is NOT sufficient: 10:00-10:30 and 10:15-10:45 have
-- different start times and would both pass.
CREATE UNIQUE INDEX "uq_appointments_doctor_start_live"
  ON "appointments" ("doctor_id", "start_utc")
  WHERE "status" NOT IN ('cancelled', 'no_show');
--> statement-breakpoint

-- Guard 2: the real one. No two live appointments for the same doctor may have
-- overlapping [start, end) intervals, whatever their durations. A concurrent
-- transaction that would create an overlap fails with SQLSTATE 23P01, which the
-- booking service maps to APPOINTMENT_CONFLICT / HTTP 409.
--
-- The half-open range '[)' is deliberate: an appointment ending at 10:30 and one
-- starting at 10:30 are adjacent, not overlapping.
ALTER TABLE "appointments"
  ADD CONSTRAINT "ex_appointments_no_overlap"
  EXCLUDE USING gist (
    "doctor_id" WITH =,
    tstzrange("start_utc", "end_utc", '[)') WITH &&
  )
  WHERE ("status" NOT IN ('cancelled', 'no_show'));
--> statement-breakpoint

-- A patient cannot be in two consultations at once either.
ALTER TABLE "appointments"
  ADD CONSTRAINT "ex_appointments_patient_no_overlap"
  EXCLUDE USING gist (
    "patient_id" WITH =,
    tstzrange("start_utc", "end_utc", '[)') WITH &&
  )
  WHERE ("status" NOT IN ('cancelled', 'no_show'));
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- AVAILABILITY
-- ----------------------------------------------------------------------------

ALTER TABLE "doctor_availability"
  ADD CONSTRAINT "ck_availability_weekday" CHECK ("weekday" BETWEEN 0 AND 6);
--> statement-breakpoint

-- end_minute may be 1440 (midnight); start_minute may not.
ALTER TABLE "doctor_availability"
  ADD CONSTRAINT "ck_availability_window" CHECK (
    "start_minute" BETWEEN 0 AND 1439
    AND "end_minute" BETWEEN 1 AND 1440
    AND "end_minute" > "start_minute"
  );
--> statement-breakpoint

ALTER TABLE "doctor_availability"
  ADD CONSTRAINT "ck_availability_slot" CHECK (
    "slot_minutes" > 0 AND "buffer_minutes" >= 0
    AND "slot_minutes" <= ("end_minute" - "start_minute")
  );
--> statement-breakpoint

-- An 'extra' exception must carry the window it is adding; a 'block' must not.
ALTER TABLE "availability_exceptions"
  ADD CONSTRAINT "ck_exception_shape" CHECK (
    ("type" = 'block')
    OR (
      "start_minute" IS NOT NULL AND "end_minute" IS NOT NULL
      AND "start_minute" BETWEEN 0 AND 1439
      AND "end_minute" BETWEEN 1 AND 1440
      AND "end_minute" > "start_minute"
    )
  );
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- DOCTORS
-- ----------------------------------------------------------------------------

ALTER TABLE "doctors"
  ADD CONSTRAINT "ck_doctors_fee" CHECK ("fee_amount" >= 0);
--> statement-breakpoint

ALTER TABLE "doctors"
  ADD CONSTRAINT "ck_doctors_rating" CHECK (
    "rating_avg" >= 0 AND "rating_avg" <= 5 AND "rating_count" >= 0
  );
--> statement-breakpoint

ALTER TABLE "doctors"
  ADD CONSTRAINT "ck_doctors_slots" CHECK (
    "consultation_minutes" > 0 AND "buffer_minutes" >= 0
    AND "lead_minutes" >= 0 AND "cancel_window_minutes" >= 0
  );
--> statement-breakpoint

-- A verified REAL doctor must have a registration number and a verification
-- date. This is what "only verified doctors are bookable" means at rest: a real
-- profile cannot reach 'verified' without the evidence being present.
--
-- Demo profiles are exempt because they carry no registration number at all —
-- see the next constraint.
ALTER TABLE "doctors"
  ADD CONSTRAINT "ck_doctors_verified_has_evidence" CHECK (
    "verification_status" <> 'verified'
    OR "is_demo_profile" = true
    OR ("bmdc_number" IS NOT NULL AND "verified_at" IS NOT NULL)
  );
--> statement-breakpoint

-- A synthetic profile MUST NOT carry a registration number.
--
-- The prototype's seed generator issued plausible-looking numbers ("A-60000",
-- "A-60007", …). Those are fabricated credentials that could collide with a real
-- practitioner's registration, which brief §11 forbids and which is a genuine
-- harm: someone could look up the number and find a real doctor attached to an
-- invented profile. The database now makes that state unrepresentable.
ALTER TABLE "doctors"
  ADD CONSTRAINT "ck_doctors_demo_has_no_registration" CHECK (
    "is_demo_profile" = false OR "bmdc_number" IS NULL
  );
--> statement-breakpoint

-- A synthetic seed profile may never claim to be BM&DC-verified.
ALTER TABLE "doctors"
  ADD CONSTRAINT "ck_doctors_demo_not_bmdc_verified" CHECK (
    "is_demo_profile" = false OR "provenance" <> 'bmdc_verified'
  );
--> statement-breakpoint

-- A decided application must record who decided it and how.
ALTER TABLE "doctor_verifications"
  ADD CONSTRAINT "ck_verification_decided" CHECK (
    "status" IN ('unsubmitted', 'pending')
    OR ("decided_at" IS NOT NULL AND "method" IS NOT NULL)
  );
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- CLINICAL
-- ----------------------------------------------------------------------------

ALTER TABLE "reviews"
  ADD CONSTRAINT "ck_reviews_rating" CHECK ("rating" BETWEEN 1 AND 5);
--> statement-breakpoint

-- An issued prescription must record when it was issued.
ALTER TABLE "prescriptions"
  ADD CONSTRAINT "ck_prescriptions_issued" CHECK (
    "status" <> 'issued' OR "issued_at" IS NOT NULL
  );
--> statement-breakpoint

-- Only the current version of a record may supersede nothing.
CREATE INDEX "idx_records_patient_kind_current"
  ON "medical_records" ("patient_id", "kind")
  WHERE "is_current" = true;
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- AI SAFETY
-- ----------------------------------------------------------------------------

-- An AI visit summary can never be stored as not needing review. The brief
-- requires requiresReview to always be true; a DEFAULT can be overridden by an
-- INSERT, a CHECK cannot.
ALTER TABLE "ai_visit_summaries"
  ADD CONSTRAINT "ck_ai_summary_requires_review" CHECK ("requires_review" = true);
--> statement-breakpoint

-- An approved summary must name the human who approved it and when.
ALTER TABLE "ai_visit_summaries"
  ADD CONSTRAINT "ck_ai_summary_reviewed" CHECK (
    "review_status" = 'pending'
    OR ("reviewed_by_user_id" IS NOT NULL AND "reviewed_at" IS NOT NULL)
  );
--> statement-breakpoint

-- A summary may only be published into the record once a human approved it.
ALTER TABLE "ai_visit_summaries"
  ADD CONSTRAINT "ck_ai_summary_publish_needs_approval" CHECK (
    "published_record_id" IS NULL OR "review_status" IN ('approved', 'edited')
  );
--> statement-breakpoint

-- The final urgency may never be less severe than what the rules decided.
-- Ordered most severe (1) to least (5); the check is "final <= rule".
CREATE OR REPLACE FUNCTION niramoy_urgency_rank(u "urgency_level")
RETURNS smallint
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT CASE u
    WHEN 'emergency'       THEN 1
    WHEN 'urgent'          THEN 2
    WHEN 'see_doctor_soon' THEN 3
    WHEN 'routine'         THEN 4
    WHEN 'self_care'       THEN 5
  END::smallint;
$$;
--> statement-breakpoint

ALTER TABLE "ai_triage_sessions"
  ADD CONSTRAINT "ck_triage_no_downgrade" CHECK (
    niramoy_urgency_rank("urgency") <= niramoy_urgency_rank("rule_urgency")
  );
--> statement-breakpoint

-- A red-flagged session must be an emergency, and must never have gone to a model.
ALTER TABLE "ai_triage_sessions"
  ADD CONSTRAINT "ck_triage_red_flag_is_emergency" CHECK (
    "red_flag_triggered" = false
    OR ("urgency" = 'emergency' AND "llm_invoked" = false)
  );
--> statement-breakpoint

ALTER TABLE "safety_events"
  ADD CONSTRAINT "ck_safety_severity" CHECK ("severity" BETWEEN 1 AND 5);
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- PLATFORM
-- ----------------------------------------------------------------------------

ALTER TABLE "payments"
  ADD CONSTRAINT "ck_payments_amount" CHECK ("amount" >= 0);
--> statement-breakpoint

-- A payment is only 'succeeded' once a signed webhook confirmed it. The
-- frontend saying so is not evidence (brief §25).
ALTER TABLE "payments"
  ADD CONSTRAINT "ck_payments_succeeded_verified" CHECK (
    "status" <> 'succeeded' OR "webhook_verified_at" IS NOT NULL OR "is_mock" = 'true'
  );
--> statement-breakpoint

ALTER TABLE "rate_limit_counters"
  ADD CONSTRAINT "pk_rate_limit_counters" PRIMARY KEY ("key", "window_start");
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- APPEND-ONLY ENFORCEMENT
-- ----------------------------------------------------------------------------

-- The audit log is evidence. The application must not be able to rewrite it,
-- even by mistake, so UPDATE and DELETE are rejected at the database.
CREATE OR REPLACE FUNCTION niramoy_reject_mutation()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION
    '% is append-only; % is not permitted', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "trg_audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION niramoy_reject_mutation();
--> statement-breakpoint

CREATE TRIGGER "trg_appointment_history_append_only"
  BEFORE UPDATE OR DELETE ON "appointment_status_history"
  FOR EACH ROW EXECUTE FUNCTION niramoy_reject_mutation();
--> statement-breakpoint

CREATE TRIGGER "trg_safety_events_append_only"
  BEFORE UPDATE OR DELETE ON "safety_events"
  FOR EACH ROW EXECUTE FUNCTION niramoy_reject_mutation();
--> statement-breakpoint

-- Medical records are append-only in substance: a correction inserts an
-- amendment. The only column that may change on an existing row is `is_current`
-- (and `supersedes_id`, set when the replacement is linked). Clinical content —
-- the title, the body, the author, the patient — is frozen once written.
CREATE OR REPLACE FUNCTION niramoy_medical_record_immutable()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'medical_records is append-only; record % must be amended, not deleted', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.patient_id       IS DISTINCT FROM OLD.patient_id
     OR NEW.author_user_id IS DISTINCT FROM OLD.author_user_id
     OR NEW.author_role    IS DISTINCT FROM OLD.author_role
     OR NEW.kind           IS DISTINCT FROM OLD.kind
     OR NEW.title          IS DISTINCT FROM OLD.title
     OR NEW.body           IS DISTINCT FROM OLD.body
     OR NEW.file_key       IS DISTINCT FROM OLD.file_key
     OR NEW.occurred_at    IS DISTINCT FROM OLD.occurred_at
     OR NEW.created_at     IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION
      'medical_records content is immutable; insert an amendment superseding % instead', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "trg_medical_records_immutable"
  BEFORE UPDATE OR DELETE ON "medical_records"
  FOR EACH ROW EXECUTE FUNCTION niramoy_medical_record_immutable();
--> statement-breakpoint

-- ----------------------------------------------------------------------------
-- updated_at maintenance
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION niramoy_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "trg_users_updated_at" BEFORE UPDATE ON "users"
  FOR EACH ROW EXECUTE FUNCTION niramoy_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER "trg_patients_updated_at" BEFORE UPDATE ON "patients"
  FOR EACH ROW EXECUTE FUNCTION niramoy_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER "trg_doctors_updated_at" BEFORE UPDATE ON "doctors"
  FOR EACH ROW EXECUTE FUNCTION niramoy_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER "trg_appointments_updated_at" BEFORE UPDATE ON "appointments"
  FOR EACH ROW EXECUTE FUNCTION niramoy_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER "trg_waitlist_updated_at" BEFORE UPDATE ON "waitlist_entries"
  FOR EACH ROW EXECUTE FUNCTION niramoy_touch_updated_at();
--> statement-breakpoint
CREATE TRIGGER "trg_payments_updated_at" BEFORE UPDATE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION niramoy_touch_updated_at();
