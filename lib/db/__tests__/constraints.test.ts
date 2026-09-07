/**
 * Schema integrity tests.
 *
 * These assert the guarantees the database makes on its own, with no application
 * code in the way. If one of these fails, an application-level bug becomes a
 * clinical-safety bug.
 */
import { sql } from "drizzle-orm";

import { createTestDatabase, type TestDatabase } from "../../../test/db";

let h: TestDatabase;

const DOCTOR = "11111111-1111-4111-8111-111111111111";
const PATIENT_A = "22222222-2222-4222-8222-222222222222";
const PATIENT_B = "33333333-3333-4333-8333-333333333333";

beforeAll(async () => {
  h = await createTestDatabase();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.truncate();
  await h.client.exec(`
    INSERT INTO divisions (id, name) VALUES ('dhaka', 'Dhaka');
    INSERT INTO districts (id, division_id, name) VALUES ('dhaka', 'dhaka', 'Dhaka');
    INSERT INTO specialties (id, name) VALUES ('cardiology', 'Cardiology');
    INSERT INTO doctors (id, display_name, initials, slug, primary_specialty_id, consultation_minutes)
      VALUES ('${DOCTOR}', 'Dr. Test', 'DT', 'dr-test', 'cardiology', 30);
    INSERT INTO patients (id, patient_code, display_name)
      VALUES ('${PATIENT_A}', 'NRM-A', 'Patient A'),
             ('${PATIENT_B}', 'NRM-B', 'Patient B');
  `);
});

/** Insert an appointment for the given doctor/patient over [start, end). */
function book(opts: {
  ref: string;
  start: string;
  end: string;
  patient?: string;
  status?: string;
}): Promise<unknown> {
  const minutes =
    (new Date(opts.end).getTime() - new Date(opts.start).getTime()) / 60000;
  return h.client.exec(`
    INSERT INTO appointments
      (reference, doctor_id, patient_id, start_utc, end_utc, duration_minutes, status)
    VALUES
      ('${opts.ref}', '${DOCTOR}', '${opts.patient ?? PATIENT_A}',
       '${opts.start}', '${opts.end}', ${minutes}, '${opts.status ?? "confirmed"}');
  `);
}

describe("appointment overlap", () => {
  it("accepts two adjacent appointments", async () => {
    await book({ ref: "A1", start: "2026-09-01T10:00:00Z", end: "2026-09-01T10:30:00Z" });
    await expect(
      book({
        ref: "A2",
        start: "2026-09-01T10:30:00Z",
        end: "2026-09-01T11:00:00Z",
        patient: PATIENT_B,
      }),
    ).resolves.toBeDefined();
  });

  it("rejects an identical slot (the UNIQUE guard)", async () => {
    await book({ ref: "B1", start: "2026-09-01T10:00:00Z", end: "2026-09-01T10:30:00Z" });
    await expect(
      book({
        ref: "B2",
        start: "2026-09-01T10:00:00Z",
        end: "2026-09-01T10:30:00Z",
        patient: PATIENT_B,
      }),
    ).rejects.toThrow();
  });

  /**
   * The case from the brief, §5. These two share no start time, so
   * UNIQUE (doctor_id, start_utc) permits both. Only the EXCLUDE constraint
   * catches it.
   */
  it("rejects partially overlapping appointments of different durations", async () => {
    await book({ ref: "C1", start: "2026-09-01T10:00:00Z", end: "2026-09-01T10:30:00Z" });
    await expect(
      book({
        ref: "C2",
        start: "2026-09-01T10:15:00Z",
        end: "2026-09-01T10:45:00Z",
        patient: PATIENT_B,
      }),
    ).rejects.toThrow(/conflicting key value|exclusion constraint/i);
  });

  it("rejects an appointment fully containing another", async () => {
    await book({ ref: "D1", start: "2026-09-01T10:10:00Z", end: "2026-09-01T10:20:00Z" });
    await expect(
      book({
        ref: "D2",
        start: "2026-09-01T10:00:00Z",
        end: "2026-09-01T11:00:00Z",
        patient: PATIENT_B,
      }),
    ).rejects.toThrow();
  });

  it("frees the interval once the appointment is cancelled", async () => {
    await book({ ref: "E1", start: "2026-09-01T10:00:00Z", end: "2026-09-01T10:30:00Z" });
    await h.client.exec(`UPDATE appointments SET status = 'cancelled' WHERE reference = 'E1';`);
    await expect(
      book({
        ref: "E2",
        start: "2026-09-01T10:15:00Z",
        end: "2026-09-01T10:45:00Z",
        patient: PATIENT_B,
      }),
    ).resolves.toBeDefined();
  });

  it("stops one patient being in two consultations at once", async () => {
    await h.client.exec(`
      INSERT INTO doctors (id, display_name, initials, slug, primary_specialty_id)
      VALUES ('44444444-4444-4444-8444-444444444444', 'Dr. Two', 'DW', 'dr-two', 'cardiology');
    `);
    await book({ ref: "F1", start: "2026-09-01T10:00:00Z", end: "2026-09-01T10:30:00Z" });
    await expect(
      h.client.exec(`
        INSERT INTO appointments
          (reference, doctor_id, patient_id, start_utc, end_utc, duration_minutes, status)
        VALUES
          ('F2', '44444444-4444-4444-8444-444444444444', '${PATIENT_A}',
           '2026-09-01T10:15:00Z', '2026-09-01T10:45:00Z', 30, 'confirmed');
      `),
    ).rejects.toThrow();
  });

  it("rejects an interval that ends before it starts", async () => {
    await expect(
      h.client.exec(`
        INSERT INTO appointments
          (reference, doctor_id, patient_id, start_utc, end_utc, duration_minutes)
        VALUES ('G1', '${DOCTOR}', '${PATIENT_A}',
                '2026-09-01T11:00:00Z', '2026-09-01T10:00:00Z', 60);
      `),
    ).rejects.toThrow(/ck_appointments_interval/);
  });
});

describe("AI safety constraints", () => {
  const triage = (urgency: string, ruleUrgency: string) =>
    h.client.exec(`
      INSERT INTO ai_triage_sessions
        (urgency, rule_urgency, source, rule_set_version, input_sha256, input_char_count)
      VALUES ('${urgency}', '${ruleUrgency}', 'llm', 'v1', 'abc', 10);
    `);

  it("allows the model to escalate urgency", async () => {
    await expect(triage("urgent", "routine")).resolves.toBeDefined();
  });

  it("refuses to store an urgency less severe than the rule engine's", async () => {
    await expect(triage("self_care", "urgent")).rejects.toThrow(/ck_triage_no_downgrade/);
  });

  it("refuses a red-flagged session that is not an emergency", async () => {
    await expect(
      h.client.exec(`
        INSERT INTO ai_triage_sessions
          (urgency, rule_urgency, source, rule_set_version, input_sha256,
           input_char_count, red_flag_triggered)
        VALUES ('routine', 'routine', 'rules', 'v1', 'abc', 10, true);
      `),
    ).rejects.toThrow(/ck_triage_red_flag_is_emergency/);
  });

  it("refuses a red-flagged session that was sent to a model", async () => {
    await expect(
      h.client.exec(`
        INSERT INTO ai_triage_sessions
          (urgency, rule_urgency, source, rule_set_version, input_sha256,
           input_char_count, red_flag_triggered, llm_invoked)
        VALUES ('emergency', 'emergency', 'rules', 'v1', 'abc', 10, true, true);
      `),
    ).rejects.toThrow(/ck_triage_red_flag_is_emergency/);
  });
});

describe("append-only enforcement", () => {
  it("refuses to update an audit log row", async () => {
    await h.client.exec(`INSERT INTO audit_logs (action) VALUES ('auth.login');`);
    await expect(
      h.client.exec(`UPDATE audit_logs SET action = 'nothing.happened';`),
    ).rejects.toThrow(/append-only/);
  });

  it("refuses to delete an audit log row", async () => {
    await h.client.exec(`INSERT INTO audit_logs (action) VALUES ('auth.login');`);
    await expect(h.client.exec(`DELETE FROM audit_logs;`)).rejects.toThrow(/append-only/);
  });

  it("refuses to rewrite the body of a medical record", async () => {
    await h.client.exec(`
      INSERT INTO medical_records (id, patient_id, author_role, author_display_name, title, body)
      VALUES ('55555555-5555-4555-8555-555555555555', '${PATIENT_A}', 'doctor', 'Dr. Test',
              'CBC', 'Haemoglobin 12.8 g/dL');
    `);
    await expect(
      h.client.exec(`UPDATE medical_records SET body = 'something else';`),
    ).rejects.toThrow(/immutable/);
  });

  it("allows superseding a record with an amendment", async () => {
    await h.client.exec(`
      INSERT INTO medical_records (id, patient_id, author_role, author_display_name, title, body)
      VALUES ('55555555-5555-4555-8555-555555555555', '${PATIENT_A}', 'doctor', 'Dr. Test',
              'CBC', 'Haemoglobin 12.8 g/dL');
      INSERT INTO medical_records (patient_id, author_role, author_display_name, title, body,
                                   kind, supersedes_id, amendment_reason)
      VALUES ('${PATIENT_A}', 'doctor', 'Dr. Test', 'CBC', 'Haemoglobin 12.9 g/dL',
              'amendment', '55555555-5555-4555-8555-555555555555', 'transcription error');
      UPDATE medical_records SET is_current = false
        WHERE id = '55555555-5555-4555-8555-555555555555';
    `);
    const { rows } = await h.client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM medical_records WHERE patient_id = '${PATIENT_A}'`,
    );
    expect(rows[0]?.n).toBe(2);
  });
});

describe("clinical guarantees", () => {
  it("refuses an AI visit summary that claims it needs no review", async () => {
    await book({ ref: "S1", start: "2026-09-01T10:00:00Z", end: "2026-09-01T10:30:00Z" });
    const { rows } = await h.client.query<{ id: string }>(
      `SELECT id FROM appointments WHERE reference = 'S1'`,
    );
    await expect(
      h.client.exec(`
        INSERT INTO ai_visit_summaries
          (appointment_id, doctor_id, patient_id, draft, source, prompt_version,
           input_provenance, requires_review)
        VALUES ('${rows[0]!.id}', '${DOCTOR}', '${PATIENT_A}', '{}'::jsonb, 'llm', 'v1',
                'doctor_notes', false);
      `),
    ).rejects.toThrow(/ck_ai_summary_requires_review/);
  });

  it("refuses a demo profile carrying a fabricated registration number", async () => {
    await expect(
      h.client.exec(`
        INSERT INTO doctors (display_name, initials, slug, primary_specialty_id,
                             is_demo_profile, bmdc_number)
        VALUES ('Dr. Seed', 'DS', 'dr-seed', 'cardiology', true, 'A-60000');
      `),
    ).rejects.toThrow(/ck_doctors_demo_has_no_registration/);
  });

  it("refuses to mark a real doctor verified without evidence", async () => {
    await expect(
      h.client.exec(
        `UPDATE doctors SET verification_status = 'verified' WHERE id = '${DOCTOR}';`,
      ),
    ).rejects.toThrow(/ck_doctors_verified_has_evidence/);
  });

  it("refuses a demo profile that claims BM&DC verification", async () => {
    await expect(
      h.client.exec(`
        INSERT INTO doctors (display_name, initials, slug, primary_specialty_id,
                             is_demo_profile, provenance)
        VALUES ('Dr. Fake', 'DF', 'dr-fake', 'cardiology', true, 'bmdc_verified');
      `),
    ).rejects.toThrow(/ck_doctors_demo_not_bmdc_verified/);
  });

  it("refuses a review rating outside 1-5", async () => {
    await book({ ref: "R1", start: "2026-09-01T10:00:00Z", end: "2026-09-01T10:30:00Z" });
    const { rows } = await h.client.query<{ id: string }>(
      `SELECT id FROM appointments WHERE reference = 'R1'`,
    );
    await expect(
      h.client.exec(`
        INSERT INTO reviews (appointment_id, patient_id, doctor_id, rating)
        VALUES ('${rows[0]!.id}', '${PATIENT_A}', '${DOCTOR}', 9);
      `),
    ).rejects.toThrow(/ck_reviews_rating/);
  });
});

describe("uuid identifiers", () => {
  it("issues non-sequential primary keys", async () => {
    await book({ ref: "U1", start: "2026-09-01T10:00:00Z", end: "2026-09-01T10:30:00Z" });
    await book({
      ref: "U2",
      start: "2026-09-01T11:00:00Z",
      end: "2026-09-01T11:30:00Z",
      patient: PATIENT_B,
    });
    const { rows } = await h.db.execute<{ id: string }>(
      sql`SELECT id FROM appointments ORDER BY reference`,
    );
    const ids = (rows as unknown as { id: string }[]).map((r) => r.id);
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(ids[0]).not.toBe(ids[1]);
  });
});
