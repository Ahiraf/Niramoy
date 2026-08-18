-- Niramoy — PostgreSQL schema (Vercel Postgres / Neon)
-- All timestamps are stored in UTC. Render local in the UI.

-- ----------------------------------------------------------------------------
-- Users & roles
-- ----------------------------------------------------------------------------
CREATE TYPE user_role AS ENUM ('patient', 'doctor', 'admin');

CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  role          user_role   NOT NULL DEFAULT 'patient',
  name          TEXT        NOT NULL,
  email         TEXT        NOT NULL UNIQUE,
  password_hash TEXT        NOT NULL,
  phone         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE doctor_profiles (
  user_id     BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  specialty   TEXT        NOT NULL,
  license_no  TEXT        NOT NULL,
  fee         NUMERIC(10,2) NOT NULL DEFAULT 0,
  bio         TEXT,
  verified    BOOLEAN     NOT NULL DEFAULT FALSE,
  rating_avg  NUMERIC(3,2) NOT NULL DEFAULT 0,   -- maintained from reviews
  rating_count INT        NOT NULL DEFAULT 0
);

-- ----------------------------------------------------------------------------
-- Availability (recurring rules + one-off exceptions)
-- ----------------------------------------------------------------------------
CREATE TABLE availability_rules (
  id            BIGSERIAL PRIMARY KEY,
  doctor_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday       SMALLINT NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0=Sun
  start_min     SMALLINT NOT NULL CHECK (start_min BETWEEN 0 AND 1439),
  end_min       SMALLINT NOT NULL CHECK (end_min   BETWEEN 1 AND 1440),
  slot_minutes  SMALLINT NOT NULL CHECK (slot_minutes > 0),
  buffer_minutes SMALLINT NOT NULL DEFAULT 0,
  CHECK (end_min > start_min)
);

CREATE TYPE exception_type AS ENUM ('block', 'extra');

CREATE TABLE availability_exceptions (
  id            BIGSERIAL PRIMARY KEY,
  doctor_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  type          exception_type NOT NULL,
  start_min     SMALLINT,       -- required for 'extra'
  end_min       SMALLINT,
  slot_minutes  SMALLINT,
  buffer_minutes SMALLINT
);

-- ----------------------------------------------------------------------------
-- Appointments  (double-booking is impossible at the DB level)
-- ----------------------------------------------------------------------------
CREATE TYPE appointment_status AS ENUM
  ('pending', 'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show');

CREATE TABLE appointments (
  id            BIGSERIAL PRIMARY KEY,
  doctor_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  patient_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_utc     TIMESTAMPTZ NOT NULL,
  status        appointment_status NOT NULL DEFAULT 'pending',
  video_room_id TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- THE KEY CONSTRAINT: one slot per doctor can exist only once.
  CONSTRAINT uq_doctor_slot UNIQUE (doctor_id, start_utc)
);

-- ----------------------------------------------------------------------------
-- Prescriptions & medical history
-- ----------------------------------------------------------------------------
CREATE TABLE prescriptions (
  id             BIGSERIAL PRIMARY KEY,
  appointment_id BIGINT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  diagnosis      TEXT,
  notes          TEXT,
  ai_summary     TEXT,             -- AI-generated visit summary (doctor-reviewed)
  pdf_url        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE prescription_items (
  id              BIGSERIAL PRIMARY KEY,
  prescription_id BIGINT NOT NULL REFERENCES prescriptions(id) ON DELETE CASCADE,
  drug            TEXT NOT NULL,
  dose            TEXT,
  frequency       TEXT,
  duration        TEXT
);

CREATE TABLE medical_records (
  id                 BIGSERIAL PRIMARY KEY,
  patient_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_url           TEXT,
  note               TEXT,
  shared_with_doctor_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- Reviews & notifications
-- ----------------------------------------------------------------------------
CREATE TABLE reviews (
  id             BIGSERIAL PRIMARY KEY,
  appointment_id BIGINT NOT NULL UNIQUE REFERENCES appointments(id) ON DELETE CASCADE,
  patient_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating         SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment        TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  payload    JSONB,
  sent_at    TIMESTAMPTZ
);

-- Helpful indexes
CREATE INDEX idx_appts_doctor_start ON appointments (doctor_id, start_utc);
CREATE INDEX idx_appts_patient      ON appointments (patient_id);
CREATE INDEX idx_rules_doctor       ON availability_rules (doctor_id);
