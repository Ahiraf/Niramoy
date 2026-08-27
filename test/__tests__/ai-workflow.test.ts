/**
 * AI workflow integration tests.
 *
 * The unit suite (lib/ai/__tests__) covers the rules and the validators. This
 * covers the properties that only exist once the database and the routes are in
 * play: what is persisted, what is refused, and the one path from an AI draft to
 * a patient's medical record.
 */
import { POST as triagePost } from "../../app/api/ai/triage/route";
import { POST as summaryPost } from "../../app/api/ai/summary/route";
import { PATCH as summaryPatch } from "../../app/api/ai/summary/[id]/route";

import { requestAs, seedAppointment, type World } from "../fixtures";
import { call, params, setupWorld, teardownWorld } from "../harness";

const BASE = "http://localhost:3000";

let world: World;

beforeEach(async () => {
  world = await setupWorld();
});

afterEach(async () => {
  await teardownWorld(world);
});

describe("triage persistence", () => {
  it("records provenance without storing the symptom text", async () => {
    const res = await call<{ sessionId: string; triage: { urgency: string } }>(
      triagePost,
      requestAs(world.patientA, `${BASE}/api/ai/triage`, {
        method: "POST",
        body: JSON.stringify({ message: "I have had a headache for three weeks, my name is Rahim" }),
      }),
    );
    expect(res.status).toBe(200);

    const { rows } = await world.h.client.query<{
      input_sha256: string;
      input_text_retained: string | null;
      rule_set_version: string;
      urgency: string;
      rule_urgency: string;
    }>(`SELECT * FROM ai_triage_sessions`);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.input_sha256).toMatch(/^[0-9a-f]{64}$/);
    // The description itself is not retained.
    expect(rows[0]!.input_text_retained).toBeNull();
    expect(rows[0]!.rule_set_version).toBeTruthy();
    // No model configured, so the final urgency is the rules'.
    expect(rows[0]!.urgency).toBe(rows[0]!.rule_urgency);
  });

  it("records an emergency and never marks it as sent to a model", async () => {
    await call(
      triagePost,
      requestAs(world.patientA, `${BASE}/api/ai/triage`, {
        method: "POST",
        body: JSON.stringify({ message: "crushing chest pain radiating to my arm" }),
      }),
    );

    const { rows } = await world.h.client.query<{
      red_flag_triggered: boolean;
      red_flag_rule_id: string;
      llm_invoked: boolean;
      urgency: string;
    }>(`SELECT * FROM ai_triage_sessions`);

    expect(rows[0]!.red_flag_triggered).toBe(true);
    expect(rows[0]!.red_flag_rule_id).toBe("rf.chest_pain");
    expect(rows[0]!.llm_invoked).toBe(false);
    expect(rows[0]!.urgency).toBe("emergency");
  });

  it("writes a safety event carrying rule ids, not symptoms", async () => {
    await call(
      triagePost,
      requestAs(world.patientA, `${BASE}/api/ai/triage`, {
        method: "POST",
        body: JSON.stringify({ message: "I want to kill myself, I am Karim from Dhaka" }),
      }),
    );

    const { rows } = await world.h.client.query<{ type: string; severity: number; detail: unknown }>(
      `SELECT type, severity, detail FROM safety_events`,
    );
    const emergency = rows.find((r) => r.type === "triage_emergency");
    expect(emergency).toBeDefined();
    expect(emergency!.severity).toBe(5);
    expect(JSON.stringify(emergency!.detail)).toContain("rf.self_harm");
    expect(JSON.stringify(emergency!.detail)).not.toContain("Karim");
  });

  it("offers no booking funnel for an emergency", async () => {
    const res = await call<{ matches: unknown[]; triage: { redFlag: string } }>(
      triagePost,
      requestAs(world.patientA, `${BASE}/api/ai/triage`, {
        method: "POST",
        body: JSON.stringify({ message: "I can't breathe" }),
      }),
    );
    expect(res.body.triage.redFlag).toBeTruthy();
    expect(res.body.matches).toHaveLength(0);
  });

  it("refuses an oversized input", async () => {
    const res = await call(
      triagePost,
      requestAs(world.patientA, `${BASE}/api/ai/triage`, {
        method: "POST",
        body: JSON.stringify({ message: "a".repeat(5000) }),
      }),
    );
    expect(res.status).toBe(413);
  });

  it("explains why each doctor is recommended", async () => {
    const res = await call<{ matches: Array<{ why: string[] }> }>(
      triagePost,
      requestAs(world.patientA, `${BASE}/api/ai/triage`, {
        method: "POST",
        body: JSON.stringify({ message: "my blood pressure has been high for weeks" }),
      }),
    );
    expect(res.body.matches.length).toBeGreaterThan(0);
    // Explainable factors, not an opaque score (brief §27).
    expect(res.body.matches[0]!.why.length).toBeGreaterThan(0);
  });
});

describe("visit summaries", () => {
  async function completedAppointment(): Promise<string> {
    return seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: "2026-02-01T10:00:00Z",
      status: "completed",
    });
  }

  it("refuses a draft request from a patient", async () => {
    const res = await call(
      summaryPost,
      requestAs(world.patientA, `${BASE}/api/ai/summary`, {
        method: "POST",
        body: JSON.stringify({ appointmentId: await completedAppointment(), transcript: "notes" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("refuses a draft for another doctor's consultation", async () => {
    const res = await call(
      summaryPost,
      requestAs(world.otherDoctor, `${BASE}/api/ai/summary`, {
        method: "POST",
        body: JSON.stringify({ appointmentId: await completedAppointment(), transcript: "notes" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("stores a draft as pending review, not as a record", async () => {
    const appointmentId = await completedAppointment();
    const res = await call<{ id: string; requiresReview: boolean }>(
      summaryPost,
      requestAs(world.doctor, `${BASE}/api/ai/summary`, {
        method: "POST",
        body: JSON.stringify({ appointmentId, transcript: "Patient reports headaches." }),
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.requiresReview).toBe(true);

    const summaries = await world.h.client.query<{
      review_status: string;
      requires_review: boolean;
      published_record_id: string | null;
    }>(`SELECT * FROM ai_visit_summaries`);
    expect(summaries.rows[0]!.review_status).toBe("pending");
    expect(summaries.rows[0]!.requires_review).toBe(true);
    expect(summaries.rows[0]!.published_record_id).toBeNull();

    // Crucially: nothing has reached the patient's record.
    const records = await world.h.client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM medical_records WHERE kind = 'visit_summary'`,
    );
    expect(records.rows[0]!.n).toBe(0);
  });

  it("writes to the record only when the doctor approves, authored by the doctor", async () => {
    const appointmentId = await completedAppointment();
    const draft = await call<{ id: string }>(
      summaryPost,
      requestAs(world.doctor, `${BASE}/api/ai/summary`, {
        method: "POST",
        body: JSON.stringify({ appointmentId, transcript: "Patient reports headaches." }),
      }),
    );

    const res = await call<{ recordId: string }>(
      summaryPatch,
      requestAs(world.doctor, `${BASE}/api/ai/summary/${draft.body.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "approve" }),
      }),
      params({ id: draft.body.id }),
    );
    expect(res.status).toBe(200);

    const { rows } = await world.h.client.query<{
      author_role: string;
      author_display_name: string;
      kind: string;
    }>(`SELECT * FROM medical_records WHERE kind = 'visit_summary'`);
    expect(rows).toHaveLength(1);
    // The doctor is the author. They confirmed it and their name is on it.
    expect(rows[0]!.author_role).toBe("doctor");
    expect(rows[0]!.author_display_name).toBe("Dr. Test");
  });

  it("records an edit as a correction, for the safety log", async () => {
    const appointmentId = await completedAppointment();
    const draft = await call<{ id: string }>(
      summaryPost,
      requestAs(world.doctor, `${BASE}/api/ai/summary`, {
        method: "POST",
        body: JSON.stringify({ appointmentId, transcript: "notes" }),
      }),
    );

    await call(
      summaryPatch,
      requestAs(world.doctor, `${BASE}/api/ai/summary/${draft.body.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          action: "approve",
          edited: { summary: "Corrected by the doctor", diagnosis: "Tension headache" },
        }),
      }),
      params({ id: draft.body.id }),
    );

    const summaries = await world.h.client.query<{ review_status: string }>(
      `SELECT review_status FROM ai_visit_summaries`,
    );
    expect(summaries.rows[0]!.review_status).toBe("edited");

    const events = await world.h.client.query<{ type: string }>(
      `SELECT type FROM safety_events WHERE type = 'ai_summary_corrected'`,
    );
    expect(events.rows).toHaveLength(1);
  });

  it("writes nothing to the record when the doctor rejects", async () => {
    const appointmentId = await completedAppointment();
    const draft = await call<{ id: string }>(
      summaryPost,
      requestAs(world.doctor, `${BASE}/api/ai/summary`, {
        method: "POST",
        body: JSON.stringify({ appointmentId, transcript: "notes" }),
      }),
    );

    await call(
      summaryPatch,
      requestAs(world.doctor, `${BASE}/api/ai/summary/${draft.body.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "reject", reason: "Does not reflect the consultation" }),
      }),
      params({ id: draft.body.id }),
    );

    const records = await world.h.client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM medical_records WHERE kind = 'visit_summary'`,
    );
    expect(records.rows[0]!.n).toBe(0);
  });

  it("refuses a second decision on the same draft", async () => {
    const appointmentId = await completedAppointment();
    const draft = await call<{ id: string }>(
      summaryPost,
      requestAs(world.doctor, `${BASE}/api/ai/summary`, {
        method: "POST",
        body: JSON.stringify({ appointmentId, transcript: "notes" }),
      }),
    );
    const body = JSON.stringify({ action: "approve" });

    await call(
      summaryPatch,
      requestAs(world.doctor, `${BASE}/api/ai/summary/${draft.body.id}`, { method: "PATCH", body }),
      params({ id: draft.body.id }),
    );
    const second = await call(
      summaryPatch,
      requestAs(world.doctor, `${BASE}/api/ai/summary/${draft.body.id}`, { method: "PATCH", body }),
      params({ id: draft.body.id }),
    );
    expect(second.status).toBe(422);
  });

  it("cannot be stored claiming it needs no review", async () => {
    const appointmentId = await completedAppointment();
    // Bypassing the service entirely: the database still refuses.
    await expect(
      world.h.client.exec(`
        INSERT INTO ai_visit_summaries
          (appointment_id, doctor_id, patient_id, draft, source, prompt_version,
           input_provenance, requires_review)
        VALUES ('${appointmentId}', '${world.doctor.doctorId}', '${world.patientA.patientId}',
                '{}'::jsonb, 'llm', 'v1', 'doctor_notes', false);
      `),
    ).rejects.toThrow(/ck_ai_summary_requires_review/);
  });
});
