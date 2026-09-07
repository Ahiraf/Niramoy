CREATE TYPE "public"."ai_review_status" AS ENUM('pending', 'approved', 'edited', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."ai_source" AS ENUM('rules', 'llm');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."appointment_type" AS ENUM('video', 'audio', 'follow_up');--> statement-breakpoint
CREATE TYPE "public"."audit_outcome" AS ENUM('success', 'denied', 'failure');--> statement-breakpoint
CREATE TYPE "public"."document_kind" AS ENUM('bmdc_certificate', 'degree', 'national_id', 'photo', 'other');--> statement-breakpoint
CREATE TYPE "public"."exception_type" AS ENUM('block', 'extra');--> statement-breakpoint
CREATE TYPE "public"."family_access_level" AS ENUM('none', 'appointments_only', 'full');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'email', 'sms');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('pending', 'sent', 'failed', 'suppressed');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('pending', 'authorized', 'succeeded', 'failed', 'refunded', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."prescription_status" AS ENUM('draft', 'issued', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."record_kind" AS ENUM('note', 'lab', 'imaging', 'prescription', 'visit_summary', 'upload', 'amendment');--> statement-breakpoint
CREATE TYPE "public"."record_visibility" AS ENUM('patient_visible', 'clinician_only');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('published', 'pending_moderation', 'removed');--> statement-breakpoint
CREATE TYPE "public"."safety_event_type" AS ENUM('triage_emergency', 'triage_non_emergency', 'rule_engine_activation', 'llm_invocation', 'llm_failure', 'llm_output_rejected', 'llm_downgrade_blocked', 'emergency_advice_shown', 'doctor_override', 'ai_summary_rejected', 'ai_summary_corrected');--> statement-breakpoint
CREATE TYPE "public"."token_purpose" AS ENUM('email_verification', 'password_reset');--> statement-breakpoint
CREATE TYPE "public"."urgency_level" AS ENUM('emergency', 'urgent', 'see_doctor_soon', 'routine', 'self_care');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('patient', 'doctor', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'deactivated');--> statement-breakpoint
CREATE TYPE "public"."verification_method" AS ENUM('manual_admin', 'bmdc_api');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('unsubmitted', 'pending', 'verified', 'rejected', 'suspended', 'expired');--> statement-breakpoint
CREATE TYPE "public"."waitlist_status" AS ENUM('waiting', 'offered', 'claimed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TABLE "auth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" "token_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"requested_ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "family_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "family_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"family_account_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"member_user_id" uuid,
	"name" text NOT NULL,
	"relation" text NOT NULL,
	"date_of_birth" timestamp,
	"gender" text,
	"access_level" text DEFAULT 'appointments_only' NOT NULL,
	"consent_granted_at" timestamp with time zone,
	"consent_revoked_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "patients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"patient_code" text NOT NULL,
	"display_name" text NOT NULL,
	"date_of_birth" timestamp,
	"gender" text,
	"blood_group" text,
	"division_id" text,
	"district_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"csrf_secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"rotated_from" uuid,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"ip_hash" text,
	"user_agent_hash" text
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"role" "user_role" DEFAULT 'patient' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"password_hash" text NOT NULL,
	"password_algo" text DEFAULT 'argon2id' NOT NULL,
	"password_changed_at" timestamp with time zone,
	"email_verified_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "districts" (
	"id" text PRIMARY KEY NOT NULL,
	"division_id" text NOT NULL,
	"name" text NOT NULL,
	"name_bn" text
);
--> statement-breakpoint
CREATE TABLE "divisions" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_bn" text,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctor_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"verification_id" uuid NOT NULL,
	"kind" "document_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"checksum_sha256" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "doctor_locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"facility_id" text,
	"label" text,
	"district_id" text,
	"division_id" text,
	"address_line" text,
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctor_specialties" (
	"doctor_id" uuid NOT NULL,
	"specialty_id" text NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctor_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid,
	"user_id" uuid,
	"registration_number" text NOT NULL,
	"registration_type" text NOT NULL,
	"claimed_name" text NOT NULL,
	"claimed_specialty_id" text,
	"claimed_degrees" text,
	"claimed_facility" text,
	"claimed_district_id" text,
	"claimed_division_id" text,
	"claimed_experience_years" smallint,
	"contact_email" text,
	"contact_phone" text,
	"status" "verification_status" DEFAULT 'pending' NOT NULL,
	"method" "verification_method",
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"register_says_name" text,
	"register_valid_until" timestamp with time zone,
	"notes" text,
	"lookup_payload" jsonb,
	"lookup_source" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"display_name" text NOT NULL,
	"initials" text NOT NULL,
	"avatar" text DEFAULT 'teal' NOT NULL,
	"slug" text NOT NULL,
	"primary_specialty_id" text NOT NULL,
	"degrees" text DEFAULT '' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"experience_years" smallint DEFAULT 0 NOT NULL,
	"languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"facility_id" text,
	"district_id" text,
	"division_id" text,
	"fee_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'BDT' NOT NULL,
	"consultation_minutes" smallint DEFAULT 20 NOT NULL,
	"buffer_minutes" smallint DEFAULT 0 NOT NULL,
	"lead_minutes" integer DEFAULT 60 NOT NULL,
	"cancel_window_minutes" integer DEFAULT 60 NOT NULL,
	"accepts_video" boolean DEFAULT true NOT NULL,
	"accepts_follow_up" boolean DEFAULT true NOT NULL,
	"bmdc_number" text,
	"registration_type" text,
	"verification_status" "verification_status" DEFAULT 'unsubmitted' NOT NULL,
	"verified_at" timestamp with time zone,
	"registration_valid_until" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"suspension_reason" text,
	"is_demo_profile" boolean DEFAULT false NOT NULL,
	"provenance" text DEFAULT 'synthetic_seed' NOT NULL,
	"rating_avg" numeric(3, 2) DEFAULT '0' NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facilities" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text,
	"division_id" text,
	"district_id" text
);
--> statement-breakpoint
CREATE TABLE "specialties" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_bn" text,
	"icon" text,
	"blurb" text,
	"dghs_labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointment_status_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"from_status" "appointment_status",
	"to_status" "appointment_status" NOT NULL,
	"changed_by_user_id" uuid,
	"reason_code" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"doctor_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"booked_by_user_id" uuid,
	"family_member_id" uuid,
	"start_utc" timestamp with time zone NOT NULL,
	"end_utc" timestamp with time zone NOT NULL,
	"duration_minutes" smallint NOT NULL,
	"status" "appointment_status" DEFAULT 'confirmed' NOT NULL,
	"type" "appointment_type" DEFAULT 'video' NOT NULL,
	"reason" text,
	"fee_amount" numeric(10, 2) DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'BDT' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	"cancel_reason" text,
	"rescheduled_from_utc" timestamp with time zone,
	"reschedule_count" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"date" timestamp NOT NULL,
	"type" "exception_type" NOT NULL,
	"start_minute" smallint,
	"end_minute" smallint,
	"slot_minutes" smallint,
	"buffer_minutes" smallint,
	"timezone" text DEFAULT 'Asia/Dhaka' NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "doctor_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"start_minute" smallint NOT NULL,
	"end_minute" smallint NOT NULL,
	"slot_minutes" smallint DEFAULT 20 NOT NULL,
	"buffer_minutes" smallint DEFAULT 0 NOT NULL,
	"timezone" text DEFAULT 'Asia/Dhaka' NOT NULL,
	"valid_from" timestamp,
	"valid_until" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"room_name" text NOT NULL,
	"provider_room_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"recording_enabled" boolean DEFAULT false NOT NULL,
	"doctor_joined_at" timestamp with time zone,
	"patient_joined_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "waitlist_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"doctor_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"requested_by_user_id" uuid,
	"target_date" timestamp NOT NULL,
	"preferred_period" text,
	"status" "waitlist_status" DEFAULT 'waiting' NOT NULL,
	"position" integer,
	"offered_start_utc" timestamp with time zone,
	"offer_expires_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"claimed_appointment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medical_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"patient_id" uuid NOT NULL,
	"appointment_id" uuid,
	"author_user_id" uuid,
	"author_role" "user_role" NOT NULL,
	"author_display_name" text NOT NULL,
	"kind" "record_kind" DEFAULT 'note' NOT NULL,
	"visibility" "record_visibility" DEFAULT 'patient_visible' NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"file_key" text,
	"file_mime_type" text,
	"file_size_bytes" integer,
	"supersedes_id" uuid,
	"is_current" boolean DEFAULT true NOT NULL,
	"amendment_reason" text,
	"occurred_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prescription_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prescription_id" uuid NOT NULL,
	"position" smallint DEFAULT 0 NOT NULL,
	"medicine" text NOT NULL,
	"strength" text,
	"dose" text,
	"route" text,
	"frequency" text,
	"duration" text,
	"quantity" text,
	"instructions" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prescriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prescription_number" text NOT NULL,
	"appointment_id" uuid,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"issued_by_user_id" uuid,
	"diagnosis" text,
	"notes" text,
	"advice" text,
	"follow_up_at" timestamp with time zone,
	"status" "prescription_status" DEFAULT 'draft' NOT NULL,
	"issued_at" timestamp with time zone,
	"supersedes_id" uuid,
	"is_current" boolean DEFAULT true NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"author_user_id" uuid,
	"rating" smallint NOT NULL,
	"comment" text,
	"status" "review_status" DEFAULT 'published' NOT NULL,
	"moderated_by_user_id" uuid,
	"moderated_at" timestamp with time zone,
	"moderation_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_triage_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"patient_id" uuid,
	"urgency" "urgency_level" NOT NULL,
	"rule_urgency" "urgency_level" NOT NULL,
	"suggested_specialty_id" text,
	"red_flag_triggered" boolean DEFAULT false NOT NULL,
	"red_flag_rule_id" text,
	"source" "ai_source" NOT NULL,
	"rule_set_version" text NOT NULL,
	"provider" text,
	"model" text,
	"prompt_version" text,
	"llm_invoked" boolean DEFAULT false NOT NULL,
	"llm_failed" boolean DEFAULT false NOT NULL,
	"llm_output_rejected" boolean DEFAULT false NOT NULL,
	"llm_downgrade_blocked" boolean DEFAULT false NOT NULL,
	"input_sha256" text NOT NULL,
	"input_char_count" integer NOT NULL,
	"input_language" text,
	"input_text_retained" text,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_visit_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"doctor_id" uuid NOT NULL,
	"patient_id" uuid NOT NULL,
	"draft" jsonb NOT NULL,
	"approved_content" jsonb,
	"source" "ai_source" NOT NULL,
	"provider" text,
	"model" text,
	"prompt_version" text NOT NULL,
	"rule_set_version" text,
	"input_provenance" text NOT NULL,
	"requires_review" boolean DEFAULT true NOT NULL,
	"review_status" "ai_review_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"published_record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safety_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "safety_event_type" NOT NULL,
	"severity" smallint DEFAULT 1 NOT NULL,
	"triage_session_id" uuid,
	"summary_id" uuid,
	"appointment_id" uuid,
	"user_id" uuid,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_role" "user_role",
	"actor_ip_hash" text,
	"request_id" text,
	"action" text NOT NULL,
	"resource_type" text,
	"resource_id" text,
	"subject_user_id" uuid,
	"outcome" "audit_outcome" DEFAULT 'success' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_name" text NOT NULL,
	"run_key" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" text,
	"processed_count" integer DEFAULT 0 NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" "notification_channel" DEFAULT 'in_app' NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "notification_status" DEFAULT 'pending' NOT NULL,
	"dedupe_key" text,
	"sent_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"failure_reason" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"payment_id" uuid,
	"signature_verified" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid,
	"patient_id" uuid,
	"payer_user_id" uuid,
	"provider" text NOT NULL,
	"is_mock" text DEFAULT 'true' NOT NULL,
	"provider_payment_id" text,
	"amount" numeric(10, 2) NOT NULL,
	"currency" text DEFAULT 'BDT' NOT NULL,
	"status" "payment_status" DEFAULT 'pending' NOT NULL,
	"idempotency_key" text NOT NULL,
	"webhook_verified_at" timestamp with time zone,
	"provider_status_raw" text,
	"failure_reason" text,
	"refunded_amount" numeric(10, 2),
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_counters" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "auth_tokens" ADD CONSTRAINT "auth_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_accounts" ADD CONSTRAINT "family_accounts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_family_account_id_family_accounts_id_fk" FOREIGN KEY ("family_account_id") REFERENCES "public"."family_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_member_user_id_users_id_fk" FOREIGN KEY ("member_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "patients" ADD CONSTRAINT "patients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "districts" ADD CONSTRAINT "districts_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_documents" ADD CONSTRAINT "doctor_documents_verification_id_doctor_verifications_id_fk" FOREIGN KEY ("verification_id") REFERENCES "public"."doctor_verifications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_documents" ADD CONSTRAINT "doctor_documents_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_locations" ADD CONSTRAINT "doctor_locations_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_locations" ADD CONSTRAINT "doctor_locations_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_locations" ADD CONSTRAINT "doctor_locations_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_locations" ADD CONSTRAINT "doctor_locations_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_specialties" ADD CONSTRAINT "doctor_specialties_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_specialties" ADD CONSTRAINT "doctor_specialties_specialty_id_specialties_id_fk" FOREIGN KEY ("specialty_id") REFERENCES "public"."specialties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_verifications" ADD CONSTRAINT "doctor_verifications_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_verifications" ADD CONSTRAINT "doctor_verifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_verifications" ADD CONSTRAINT "doctor_verifications_claimed_specialty_id_specialties_id_fk" FOREIGN KEY ("claimed_specialty_id") REFERENCES "public"."specialties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_verifications" ADD CONSTRAINT "doctor_verifications_claimed_district_id_districts_id_fk" FOREIGN KEY ("claimed_district_id") REFERENCES "public"."districts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_verifications" ADD CONSTRAINT "doctor_verifications_claimed_division_id_divisions_id_fk" FOREIGN KEY ("claimed_division_id") REFERENCES "public"."divisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_verifications" ADD CONSTRAINT "doctor_verifications_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_primary_specialty_id_specialties_id_fk" FOREIGN KEY ("primary_specialty_id") REFERENCES "public"."specialties"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_district_id_districts_id_fk" FOREIGN KEY ("district_id") REFERENCES "public"."districts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointment_status_history" ADD CONSTRAINT "appointment_status_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_booked_by_user_id_users_id_fk" FOREIGN KEY ("booked_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_family_member_id_family_members_id_fk" FOREIGN KEY ("family_member_id") REFERENCES "public"."family_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "doctor_availability" ADD CONSTRAINT "doctor_availability_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "video_sessions" ADD CONSTRAINT "video_sessions_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_claimed_appointment_id_appointments_id_fk" FOREIGN KEY ("claimed_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_prescription_id_prescriptions_id_fk" FOREIGN KEY ("prescription_id") REFERENCES "public"."prescriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_moderated_by_user_id_users_id_fk" FOREIGN KEY ("moderated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_triage_sessions" ADD CONSTRAINT "ai_triage_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_triage_sessions" ADD CONSTRAINT "ai_triage_sessions_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_triage_sessions" ADD CONSTRAINT "ai_triage_sessions_suggested_specialty_id_specialties_id_fk" FOREIGN KEY ("suggested_specialty_id") REFERENCES "public"."specialties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visit_summaries" ADD CONSTRAINT "ai_visit_summaries_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visit_summaries" ADD CONSTRAINT "ai_visit_summaries_doctor_id_doctors_id_fk" FOREIGN KEY ("doctor_id") REFERENCES "public"."doctors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visit_summaries" ADD CONSTRAINT "ai_visit_summaries_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visit_summaries" ADD CONSTRAINT "ai_visit_summaries_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_visit_summaries" ADD CONSTRAINT "ai_visit_summaries_published_record_id_medical_records_id_fk" FOREIGN KEY ("published_record_id") REFERENCES "public"."medical_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_events" ADD CONSTRAINT "safety_events_triage_session_id_ai_triage_sessions_id_fk" FOREIGN KEY ("triage_session_id") REFERENCES "public"."ai_triage_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_events" ADD CONSTRAINT "safety_events_summary_id_ai_visit_summaries_id_fk" FOREIGN KEY ("summary_id") REFERENCES "public"."ai_visit_summaries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_events" ADD CONSTRAINT "safety_events_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_events" ADD CONSTRAINT "safety_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_webhook_events" ADD CONSTRAINT "payment_webhook_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_patient_id_patients_id_fk" FOREIGN KEY ("patient_id") REFERENCES "public"."patients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_payer_user_id_users_id_fk" FOREIGN KEY ("payer_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_auth_tokens_hash" ON "auth_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_auth_tokens_user_purpose" ON "auth_tokens" USING btree ("user_id","purpose");--> statement-breakpoint
CREATE INDEX "idx_auth_tokens_expires" ON "auth_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_family_accounts_owner" ON "family_accounts" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "idx_family_members_account" ON "family_members" USING btree ("family_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_family_members_patient" ON "family_members" USING btree ("patient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_patients_code" ON "patients" USING btree ("patient_code");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_patients_user" ON "patients" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_patients_district" ON "patients" USING btree ("district_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_sessions_token_hash" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "idx_sessions_user" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_expires" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_users_email" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "idx_users_role_status" ON "users" USING btree ("role","status");--> statement-breakpoint
CREATE INDEX "idx_districts_division" ON "districts" USING btree ("division_id");--> statement-breakpoint
CREATE INDEX "idx_doctor_documents_verification" ON "doctor_documents" USING btree ("verification_id");--> statement-breakpoint
CREATE INDEX "idx_doctor_locations_doctor" ON "doctor_locations" USING btree ("doctor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_doctor_specialty" ON "doctor_specialties" USING btree ("doctor_id","specialty_id");--> statement-breakpoint
CREATE INDEX "idx_doctor_specialties_specialty" ON "doctor_specialties" USING btree ("specialty_id");--> statement-breakpoint
CREATE INDEX "idx_verifications_status" ON "doctor_verifications" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE INDEX "idx_verifications_doctor" ON "doctor_verifications" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "idx_verifications_reg" ON "doctor_verifications" USING btree ("registration_number");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_doctors_slug" ON "doctors" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_doctors_user" ON "doctors" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_doctors_bmdc" ON "doctors" USING btree ("bmdc_number");--> statement-breakpoint
CREATE INDEX "idx_doctors_specialty" ON "doctors" USING btree ("primary_specialty_id");--> statement-breakpoint
CREATE INDEX "idx_doctors_district" ON "doctors" USING btree ("district_id");--> statement-breakpoint
CREATE INDEX "idx_doctors_division" ON "doctors" USING btree ("division_id");--> statement-breakpoint
CREATE INDEX "idx_doctors_bookable" ON "doctors" USING btree ("verification_status","primary_specialty_id","district_id");--> statement-breakpoint
CREATE INDEX "idx_facilities_district" ON "facilities" USING btree ("district_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_specialties_name" ON "specialties" USING btree ("name");--> statement-breakpoint
CREATE INDEX "idx_appt_history_appointment" ON "appointment_status_history" USING btree ("appointment_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_appointments_reference" ON "appointments" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "idx_appointments_doctor_start" ON "appointments" USING btree ("doctor_id","start_utc");--> statement-breakpoint
CREATE INDEX "idx_appointments_patient_start" ON "appointments" USING btree ("patient_id","start_utc");--> statement-breakpoint
CREATE INDEX "idx_appointments_status_start" ON "appointments" USING btree ("status","start_utc");--> statement-breakpoint
CREATE INDEX "idx_exceptions_doctor_date" ON "availability_exceptions" USING btree ("doctor_id","date");--> statement-breakpoint
CREATE INDEX "idx_availability_doctor" ON "doctor_availability" USING btree ("doctor_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_video_sessions_appointment" ON "video_sessions" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "idx_video_sessions_expiry" ON "video_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_waitlist_doctor_date" ON "waitlist_entries" USING btree ("doctor_id","target_date","status");--> statement-breakpoint
CREATE INDEX "idx_waitlist_patient" ON "waitlist_entries" USING btree ("patient_id");--> statement-breakpoint
CREATE INDEX "idx_waitlist_offer_expiry" ON "waitlist_entries" USING btree ("offer_expires_at");--> statement-breakpoint
CREATE INDEX "idx_records_patient_created" ON "medical_records" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_records_appointment" ON "medical_records" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "idx_records_current" ON "medical_records" USING btree ("patient_id","is_current");--> statement-breakpoint
CREATE INDEX "idx_records_supersedes" ON "medical_records" USING btree ("supersedes_id");--> statement-breakpoint
CREATE INDEX "idx_prescription_items_prescription" ON "prescription_items" USING btree ("prescription_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_prescriptions_number" ON "prescriptions" USING btree ("prescription_number");--> statement-breakpoint
CREATE INDEX "idx_prescriptions_patient" ON "prescriptions" USING btree ("patient_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_prescriptions_doctor" ON "prescriptions" USING btree ("doctor_id");--> statement-breakpoint
CREATE INDEX "idx_prescriptions_appointment" ON "prescriptions" USING btree ("appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_reviews_appointment" ON "reviews" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "idx_reviews_doctor" ON "reviews" USING btree ("doctor_id","status");--> statement-breakpoint
CREATE INDEX "idx_triage_user" ON "ai_triage_sessions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_triage_urgency" ON "ai_triage_sessions" USING btree ("urgency","created_at");--> statement-breakpoint
CREATE INDEX "idx_triage_red_flag" ON "ai_triage_sessions" USING btree ("red_flag_triggered","created_at");--> statement-breakpoint
CREATE INDEX "idx_ai_summaries_appointment" ON "ai_visit_summaries" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "idx_ai_summaries_review" ON "ai_visit_summaries" USING btree ("review_status","created_at");--> statement-breakpoint
CREATE INDEX "idx_safety_events_type" ON "safety_events" USING btree ("type","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_safety_events_severity" ON "safety_events" USING btree ("severity","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_audit_occurred" ON "audit_logs" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "idx_audit_actor" ON "audit_logs" USING btree ("actor_user_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_audit_resource" ON "audit_logs" USING btree ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "idx_audit_action" ON "audit_logs" USING btree ("action","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_job_runs_key" ON "job_runs" USING btree ("job_name","run_key");--> statement-breakpoint
CREATE INDEX "idx_job_runs_started" ON "job_runs" USING btree ("job_name","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_notifications_dedupe" ON "notifications" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "idx_notifications_user_created" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_unread" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "idx_notifications_pending" ON "notifications" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_webhook_provider_event" ON "payment_webhook_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payments_idempotency" ON "payments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_payments_provider_ref" ON "payments" USING btree ("provider","provider_payment_id");--> statement-breakpoint
CREATE INDEX "idx_payments_appointment" ON "payments" USING btree ("appointment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_rate_limit_key_window" ON "rate_limit_counters" USING btree ("key","window_start");--> statement-breakpoint
CREATE INDEX "idx_rate_limit_expiry" ON "rate_limit_counters" USING btree ("expires_at");