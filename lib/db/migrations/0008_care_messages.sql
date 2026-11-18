CREATE TABLE care_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES appointments(id),
  sender_id uuid NOT NULL REFERENCES users(id),
  client_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz
);
--> statement-breakpoint
CREATE INDEX care_messages_thread_idx ON care_messages(appointment_id, created_at, id);
--> statement-breakpoint
CREATE UNIQUE INDEX care_messages_retry_idx ON care_messages(sender_id, client_id);
