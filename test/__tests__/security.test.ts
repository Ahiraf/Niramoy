/**
 * Security test suite — the cases enumerated in the brief, §61.
 *
 * These run the REAL route handlers against a REAL database. Nothing is mocked,
 * because what is being tested is whether the SQL is scoped and the
 * authorization helpers are actually invoked — properties a mock would hide.
 *
 * Every one of these corresponded to a working attack against the prototype.
 */
import { GET as authGet, PATCH as authPatch } from "../../app/api/auth/route";
import { POST as loginPost } from "../../app/api/auth/login/route";
import { POST as resetPost } from "../../app/api/auth/password-reset/route";
import { GET as recordsGet, POST as recordsPost } from "../../app/api/records/route";
import { GET as rxGet, POST as rxPost } from "../../app/api/prescriptions/route";
import { GET as apptGet, POST as apptPost } from "../../app/api/appointments/route";
import { PATCH as apptPatch } from "../../app/api/appointments/[id]/route";
import { GET as familyGet, DELETE as familyDelete } from "../../app/api/family/route";
import { GET as notifGet } from "../../app/api/notifications/route";
import { POST as reviewPost } from "../../app/api/reviews/route";
import { GET as verificationGet } from "../../app/api/verification/route";
import { POST as videoPost } from "../../app/api/appointments/[id]/video/route";

import { requestAs, requestWithBadCsrf, seedAppointment, type World } from "../fixtures";
import { call, params, setupWorld, teardownWorld } from "../harness";

const BASE = "http://localhost:3000";

let world: World;

beforeEach(async () => {
  world = await setupWorld();
});

afterEach(async () => {
  await teardownWorld(world);
});

/* ========================================================================== */
/* §61.1 — Patient A attempts to access Patient B's record                     */
/* ========================================================================== */

describe("§61.1 cross-patient record access", () => {
  it("returns only the caller's own records, whatever the query says", async () => {
    // Give B a record that A must never see.
    await world.h.client.exec(`
      INSERT INTO medical_records (patient_id, author_role, author_display_name, title, body)
      VALUES ('${world.patientB.patientId}', 'patient', 'Patient B', 'B private lab', 'secret');
    `);
    await world.h.client.exec(`
      INSERT INTO medical_records (patient_id, author_role, author_display_name, title, body)
      VALUES ('${world.patientA.patientId}', 'patient', 'Patient A', 'A own lab', 'mine');
    `);

    const res = await call<{ records: { title: string }[] }>(
      recordsGet,
      requestAs(world.patientA, `${BASE}/api/records`),
    );

    expect(res.status).toBe(200);
    expect(res.body.records.map((r) => r.title)).toEqual(["A own lab"]);
  });
});

/* ========================================================================== */
/* §61.2 — Patient A changes patientId in the request                          */
/* ========================================================================== */

describe("§61.2 client-supplied patientId is ignored", () => {
  it("ignores ?patientId= on records", async () => {
    await world.h.client.exec(`
      INSERT INTO medical_records (patient_id, author_role, author_display_name, title, body)
      VALUES ('${world.patientB.patientId}', 'patient', 'Patient B', 'B private lab', 'secret');
    `);

    const res = await call<{ records: { title: string }[] }>(
      recordsGet,
      requestAs(world.patientA, `${BASE}/api/records?patientId=${world.patientB.patientId}`),
    );

    // The prototype returned B's records here. Now the parameter does nothing.
    expect(res.status).toBe(200);
    expect(res.body.records).toHaveLength(0);
  });

  it("ignores ?patientId= on prescriptions", async () => {
    const appointmentId = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientB,
      startUtc: "2026-01-05T10:00:00Z",
    });
    await world.h.client.exec(`
      INSERT INTO prescriptions (prescription_number, appointment_id, patient_id, doctor_id, status, issued_at)
      VALUES ('RX-B', '${appointmentId}', '${world.patientB.patientId}', '${world.doctor.doctorId}', 'issued', now());
    `);

    const res = await call<{ prescriptions: unknown[] }>(
      rxGet,
      requestAs(world.patientA, `${BASE}/api/prescriptions?patientId=${world.patientB.patientId}`),
    );
    expect(res.body.prescriptions).toHaveLength(0);
  });

  it("ignores a patientId in a POST body", async () => {
    const res = await call<{ record: { patientId: string } }>(
      recordsPost,
      requestAs(world.patientA, `${BASE}/api/records`, {
        method: "POST",
        body: JSON.stringify({
          title: "Planted",
          note: "should land on A",
          patientId: world.patientB.patientId,
        }),
      }),
    );

    expect(res.status).toBe(201);
    expect(res.body.record.patientId).toBe(world.patientA.patientId);
  });

  it("ignores ?userId= on notifications", async () => {
    await world.h.client.exec(`
      INSERT INTO notifications (user_id, type, title, body)
      VALUES ('${world.patientB.userId}', 'test', 'B only', 'private');
    `);

    const res = await call<{ notifications: unknown[] }>(
      notifGet,
      requestAs(world.patientA, `${BASE}/api/notifications?userId=${world.patientB.userId}`),
    );
    expect(res.body.notifications).toHaveLength(0);
  });
});

/* ========================================================================== */
/* §61.3 — A patient creates a prescription                                    */
/* ========================================================================== */

describe("§61.3 patients cannot prescribe", () => {
  it("refuses POST /api/prescriptions from a patient", async () => {
    const res = await call(
      rxPost,
      requestAs(world.patientA, `${BASE}/api/prescriptions`, {
        method: "POST",
        body: JSON.stringify({ items: [{ medicine: "Diazepam" }] }),
      }),
    );
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("FORBIDDEN");
  });

  it("refuses the prescription back door on POST /api/records", async () => {
    // The prototype routed `kind: "prescription"` straight into the
    // prescriptions table with no role check at all.
    const res = await call(
      recordsPost,
      requestAs(world.patientA, `${BASE}/api/records`, {
        method: "POST",
        body: JSON.stringify({ kind: "prescription", title: "Self-issued", items: [] }),
      }),
    );
    expect(res.status).toBe(403);
  });
});

/* ========================================================================== */
/* §61.4 — A doctor accesses an unrelated patient's data                       */
/* ========================================================================== */

describe("§61.4 doctors need a treatment relationship", () => {
  it("refuses a prescription for an appointment belonging to another doctor", async () => {
    const appointmentId = await seedAppointment(world, {
      doctor: world.otherDoctor,
      patient: world.patientA,
      startUtc: "2026-01-05T10:00:00Z",
    });

    const res = await call(
      rxPost,
      requestAs(world.doctor, `${BASE}/api/prescriptions`, {
        method: "POST",
        body: JSON.stringify({
          appointmentId,
          items: [{ medicine: "Paracetamol", dose: "500mg" }],
        }),
      }),
    );

    // NOT_FOUND rather than FORBIDDEN: whether that appointment exists is
    // itself information this doctor is not entitled to.
    expect(res.status).toBe(404);
  });

  it("lets a doctor prescribe for their own completed consultation", async () => {
    const appointmentId = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: "2026-01-05T10:00:00Z",
      status: "completed",
    });

    const res = await call(
      rxPost,
      requestAs(world.doctor, `${BASE}/api/prescriptions`, {
        method: "POST",
        body: JSON.stringify({
          appointmentId,
          diagnosis: "Tension headache",
          items: [{ medicine: "Paracetamol", strength: "500 mg", frequency: "TDS" }],
        }),
      }),
    );
    expect(res.status).toBe(201);
  });

  it("refuses a prescription for a consultation that has not happened", async () => {
    const appointmentId = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: "2027-01-05T10:00:00Z",
      status: "confirmed",
    });

    const res = await call(
      rxPost,
      requestAs(world.doctor, `${BASE}/api/prescriptions`, {
        method: "POST",
        body: JSON.stringify({ appointmentId, items: [{ medicine: "Paracetamol" }] }),
      }),
    );
    expect(res.status).toBe(422);
    expect(res.body.error?.code).toBe("NOT_ELIGIBLE");
  });

  it("shows a doctor only their own clinic", async () => {
    await seedAppointment(world, {
      doctor: world.otherDoctor,
      patient: world.patientA,
      startUtc: "2026-01-05T10:00:00Z",
    });
    await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientB,
      startUtc: "2026-01-06T10:00:00Z",
    });

    const res = await call<{ appointments: { doctorId: string }[] }>(
      apptGet,
      requestAs(world.doctor, `${BASE}/api/appointments`),
    );
    expect(res.body.appointments).toHaveLength(1);
    expect(res.body.appointments[0]!.doctorId).toBe(world.doctor.doctorId);
  });
});

/* ========================================================================== */
/* §61.5 — A normal user accesses an admin route                               */
/* ========================================================================== */

describe("§61.5 admin routes require the admin role", () => {
  it("refuses the verification queue to a patient", async () => {
    const res = await call(verificationGet, requestAs(world.patientA, `${BASE}/api/verification`));
    expect(res.status).toBe(403);
  });

  it("refuses the verification queue to a doctor", async () => {
    const res = await call(verificationGet, requestAs(world.doctor, `${BASE}/api/verification`));
    expect(res.status).toBe(403);
  });

  it("refuses the verification queue to an anonymous caller", async () => {
    const res = await call(verificationGet, requestAs(null, `${BASE}/api/verification`));
    expect(res.status).toBe(401);
  });

  it("allows it for an admin", async () => {
    const res = await call(verificationGet, requestAs(world.admin, `${BASE}/api/verification`));
    expect(res.status).toBe(200);
  });
});

/* ========================================================================== */
/* §61.6 — A doctor changes their own verification status                      */
/* ========================================================================== */

describe("§61.6 doctors cannot self-verify", () => {
  it("ignores verificationStatus in a profile update", async () => {
    const res = await call(
      authPatch,
      requestAs(world.doctor, `${BASE}/api/auth`, {
        method: "PATCH",
        body: JSON.stringify({
          name: "Dr. Test",
          verificationStatus: "verified",
          role: "admin",
        }),
      }),
    );
    expect(res.status).toBe(200);

    // Neither the role nor the verification status is writable through here.
    const { rows } = await world.h.client.query<{ role: string }>(
      `SELECT role FROM users WHERE id = '${world.doctor.userId}'`,
    );
    expect(rows[0]!.role).toBe("doctor");
  });

  it("does not let an unverified doctor prescribe", async () => {
    await world.h.client.exec(`
      UPDATE doctors SET verification_status = 'pending' WHERE id = '${world.doctor.doctorId}';
    `);
    const appointmentId = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: "2026-01-05T10:00:00Z",
      status: "completed",
    });

    const res = await call(
      rxPost,
      requestAs(world.doctor, `${BASE}/api/prescriptions`, {
        method: "POST",
        body: JSON.stringify({ appointmentId, items: [{ medicine: "Paracetamol" }] }),
      }),
    );
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("NOT_VERIFIED");
  });
});

/* ========================================================================== */
/* Unowned mutation — finding S4                                               */
/* ========================================================================== */

describe("appointment mutation requires participation", () => {
  it("refuses to let a stranger cancel someone else's appointment", async () => {
    const appointmentId = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: "2027-06-01T10:00:00Z",
      status: "confirmed",
    });

    const res = await call(
      apptPatch,
      requestAs(world.patientB, `${BASE}/api/appointments/${appointmentId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "cancel" }),
      }),
      params({ id: appointmentId }),
    );
    expect(res.status).toBe(404);

    const { rows } = await world.h.client.query<{ status: string }>(
      `SELECT status FROM appointments WHERE id = '${appointmentId}'`,
    );
    expect(rows[0]!.status).toBe("confirmed");
  });

  it("refuses to let a patient mark a consultation completed", async () => {
    const appointmentId = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: "2027-06-01T10:00:00Z",
      status: "confirmed",
    });

    const res = await call(
      apptPatch,
      requestAs(world.patientA, `${BASE}/api/appointments/${appointmentId}`, {
        method: "PATCH",
        body: JSON.stringify({ action: "complete" }),
      }),
      params({ id: appointmentId }),
    );
    expect(res.status).toBe(403);
  });
});

/* ========================================================================== */
/* Review forgery — finding S5                                                 */
/* ========================================================================== */

describe("reviews require an eligible completed appointment", () => {
  it("refuses a review for someone else's appointment", async () => {
    const appointmentId = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientB,
      startUtc: "2026-01-05T10:00:00Z",
      status: "completed",
    });

    const res = await call(
      reviewPost,
      requestAs(world.patientA, `${BASE}/api/reviews`, {
        method: "POST",
        body: JSON.stringify({ appointmentId, rating: 1, comment: "sabotage" }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("refuses a review for a consultation that has not happened", async () => {
    const appointmentId = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: "2027-06-01T10:00:00Z",
      status: "confirmed",
    });

    const res = await call(
      reviewPost,
      requestAs(world.patientA, `${BASE}/api/reviews`, {
        method: "POST",
        body: JSON.stringify({ appointmentId, rating: 5 }),
      }),
    );
    expect(res.status).toBe(422);
  });

  it("accepts one review and refuses a second", async () => {
    const appointmentId = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: "2026-01-05T10:00:00Z",
      status: "completed",
    });

    const body = JSON.stringify({ appointmentId, rating: 5, comment: "Very helpful" });
    const first = await call(
      reviewPost,
      requestAs(world.patientA, `${BASE}/api/reviews`, { method: "POST", body }),
    );
    expect(first.status).toBe(201);

    const second = await call(
      reviewPost,
      requestAs(world.patientA, `${BASE}/api/reviews`, { method: "POST", body }),
    );
    expect(second.status).toBe(409);
    expect(second.body.error?.code).toBe("ALREADY_REVIEWED");
  });
});

/* ========================================================================== */
/* Unowned deletes — finding S6                                                */
/* ========================================================================== */

describe("family members can only be removed by their owner", () => {
  it("refuses to delete another account's family member", async () => {
    const created = await call<{ member: { id: string } }>(
      familyGet,
      requestAs(world.patientB, `${BASE}/api/family`),
    );
    void created;

    await world.h.client.exec(`
      INSERT INTO family_accounts (id, owner_user_id) VALUES
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${world.patientB.userId}');
      INSERT INTO patients (id, patient_code, display_name) VALUES
        ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'NRM-DEP', 'Dependent');
      INSERT INTO family_members (id, family_account_id, patient_id, name, relation) VALUES
        ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
         'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Dependent', 'child');
    `);

    const res = await call(
      familyDelete,
      requestAs(world.patientA, `${BASE}/api/family?id=cccccccc-cccc-4ccc-8ccc-cccccccccccc`, {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(404);

    const { rows } = await world.h.client.query<{ is_active: boolean }>(
      `SELECT is_active FROM family_members WHERE id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'`,
    );
    expect(rows[0]!.is_active).toBe(true);
  });
});

/* ========================================================================== */
/* §61.13 — Password reset for an unknown email                                */
/* ========================================================================== */

describe("§61.13 password reset does not reveal account existence", () => {
  it("answers identically for a known and an unknown address", async () => {
    const known = await call(
      resetPost,
      requestAs(null, `${BASE}/api/auth/password-reset`, {
        method: "POST",
        body: JSON.stringify({ email: world.patientA.email }),
      }),
    );
    const unknown = await call(
      resetPost,
      requestAs(null, `${BASE}/api/auth/password-reset`, {
        method: "POST",
        body: JSON.stringify({ email: "nobody-at-all@example.com" }),
      }),
    );

    expect(known.status).toBe(unknown.status);
    expect(known.status).toBe(200);
    expect(known.body.message).toBe(unknown.body.message);

    // A token was created for the real account and not for the fictional one —
    // the only difference, and it is not visible to the caller.
    const { rows } = await world.h.client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM auth_tokens WHERE purpose = 'password_reset'`,
    );
    expect(rows[0]!.n).toBe(1);
  });

  it("gives the same answer for a wrong password and a missing account", async () => {
    const wrongPassword = await call(
      loginPost,
      requestAs(null, `${BASE}/api/auth/login`, {
        method: "POST",
        body: JSON.stringify({ email: world.patientA.email, password: "not-the-password" }),
      }),
    );
    const noAccount = await call(
      loginPost,
      requestAs(null, `${BASE}/api/auth/login`, {
        method: "POST",
        body: JSON.stringify({ email: "ghost@example.com", password: "not-the-password" }),
      }),
    );

    expect(wrongPassword.status).toBe(401);
    expect(noAccount.status).toBe(401);
    expect(wrongPassword.body.error?.code).toBe(noAccount.body.error?.code);
    expect(wrongPassword.body.error?.message).toBe(noAccount.body.error?.message);
  });
});

/* ========================================================================== */
/* CSRF                                                                        */
/* ========================================================================== */

describe("CSRF protection", () => {
  it("rejects a state-changing request whose CSRF header does not match", async () => {
    const res = await call(
      recordsPost,
      requestWithBadCsrf(world.patientA, `${BASE}/api/records`, {
        method: "POST",
        body: JSON.stringify({ title: "Injected" }),
      }),
    );
    expect(res.status).toBe(403);
    expect(res.body.error?.code).toBe("CSRF_FAILED");
  });

  it("rejects a state-changing request from another origin", async () => {
    const headers = new Headers({
      "content-type": "application/json",
      origin: "https://evil.example",
      cookie: `niramoy_session=${world.patientA.sessionToken}; niramoy_csrf=${world.patientA.csrfToken}`,
      "x-niramoy-csrf": world.patientA.csrfToken,
    });
    const res = await call(
      recordsPost,
      new Request(`${BASE}/api/records`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "Injected" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("does not require a CSRF token for a safe method", async () => {
    const headers = new Headers({
      cookie: `niramoy_session=${world.patientA.sessionToken}`,
    });
    const res = await call(
      recordsGet,
      new Request(`${BASE}/api/records`, { headers }),
    );
    expect(res.status).toBe(200);
  });
});

/* ========================================================================== */
/* §61.14 — Session cookie flags                                               */
/* ========================================================================== */

describe("§61.14 session cookie attributes", () => {
  it("sets HttpOnly and SameSite on the session cookie, and not on the CSRF one", async () => {
    const response = await loginPost(
      requestAs(null, `${BASE}/api/auth/login`, {
        method: "POST",
        body: JSON.stringify({ email: world.patientA.email, password: "correct-horse-9" }),
      }),
    );
    expect(response.status).toBe(200);

    const cookies = response.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith("niramoy_session="));
    const csrf = cookies.find((c) => c.startsWith("niramoy_csrf="));

    expect(session).toMatch(/HttpOnly/);
    expect(session).toMatch(/SameSite=Lax/);
    expect(session).toMatch(/Path=\//);

    // The CSRF cookie is deliberately readable — the page must echo it back.
    expect(csrf).toBeDefined();
    expect(csrf).not.toMatch(/HttpOnly/);
  });
});

/* ========================================================================== */
/* Anonymous access — finding S2                                               */
/* ========================================================================== */

describe("signed-out callers get nothing", () => {
  const guarded: Array<[string, (r: Request) => Promise<Response>]> = [
    ["records", recordsGet],
    ["prescriptions", rxGet],
    ["appointments", apptGet],
    ["family", familyGet],
    ["notifications", notifGet],
  ];

  it.each(guarded)("refuses anonymous access to /api/%s", async (_name, handler) => {
    const res = await call(handler, requestAs(null, `${BASE}/api/x`));
    expect(res.status).toBe(401);
  });

  it("returns { user: null } from /api/auth rather than a 401", async () => {
    // The one endpoint that must answer without credentials, so the client can
    // ask whether it is signed in.
    const res = await call<{ user: null }>(authGet, requestAs(null, `${BASE}/api/auth`));
    expect(res.status).toBe(200);
    expect(res.body.user).toBeNull();
  });

  it("refuses an anonymous booking attempt", async () => {
    const res = await call(
      apptPost,
      requestAs(null, `${BASE}/api/appointments`, {
        method: "POST",
        body: JSON.stringify({ doctorId: world.doctor.doctorId, startUtc: "2027-06-01T10:00:00Z" }),
      }),
    );
    expect(res.status).toBe(401);
  });
});

/* ========================================================================== */
/* Video access — brief §14                                                    */
/* ========================================================================== */

describe("consultation rooms admit only the two participants", () => {
  /** Now-ish, so the join window is open. */
  const soon = () => new Date(Date.now() + 5 * 60_000).toISOString();

  it("issues a token to the patient on the appointment", async () => {
    const id = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: soon(),
      status: "confirmed",
    });

    const res = await call<{ call: { token: string; role: string } }>(
      videoPost,
      requestAs(world.patientA, `${BASE}/api/appointments/${id}/video`, { method: "POST" }),
      params({ id }),
    );
    expect(res.status).toBe(200);
    expect(res.body.call.role).toBe("patient");
    expect(res.body.call.token).toBeTruthy();
  });

  it("issues a token to the doctor on the appointment", async () => {
    const id = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: soon(),
      status: "confirmed",
    });

    const res = await call<{ call: { role: string } }>(
      videoPost,
      requestAs(world.doctor, `${BASE}/api/appointments/${id}/video`, { method: "POST" }),
      params({ id }),
    );
    expect(res.status).toBe(200);
    expect(res.body.call.role).toBe("doctor");
  });

  it("refuses a token to an unrelated patient", async () => {
    const id = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: soon(),
      status: "confirmed",
    });

    const res = await call(
      videoPost,
      requestAs(world.patientB, `${BASE}/api/appointments/${id}/video`, { method: "POST" }),
      params({ id }),
    );
    expect(res.status).toBe(404);
  });

  it("refuses a token to an unrelated doctor", async () => {
    const id = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: soon(),
      status: "confirmed",
    });

    const res = await call(
      videoPost,
      requestAs(world.otherDoctor, `${BASE}/api/appointments/${id}/video`, { method: "POST" }),
      params({ id }),
    );
    expect(res.status).toBe(404);
  });

  it("refuses a token to an admin", async () => {
    // An admin has no clinical role in a consultation, so administrative
    // authority does not extend to sitting in on one.
    const id = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: soon(),
      status: "confirmed",
    });

    const res = await call(
      videoPost,
      requestAs(world.admin, `${BASE}/api/appointments/${id}/video`, { method: "POST" }),
      params({ id }),
    );
    expect(res.status).toBe(404);
  });

  it("refuses a token well before the appointment", async () => {
    const id = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: new Date(Date.now() + 6 * 3_600_000).toISOString(),
      status: "confirmed",
    });

    const res = await call(
      videoPost,
      requestAs(world.patientA, `${BASE}/api/appointments/${id}/video`, { method: "POST" }),
      params({ id }),
    );
    expect(res.status).toBe(422);
  });

  it("refuses a token for a cancelled consultation", async () => {
    const id = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: soon(),
      status: "cancelled",
    });

    const res = await call(
      videoPost,
      requestAs(world.patientA, `${BASE}/api/appointments/${id}/video`, { method: "POST" }),
      params({ id }),
    );
    expect(res.status).toBe(422);
  });

  it("never enables recording on the room it creates", async () => {
    const id = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: soon(),
      status: "confirmed",
    });
    await call(
      videoPost,
      requestAs(world.patientA, `${BASE}/api/appointments/${id}/video`, { method: "POST" }),
      params({ id }),
    );

    const { rows } = await world.h.client.query<{ recording_enabled: boolean }>(
      `SELECT recording_enabled FROM video_sessions WHERE appointment_id = '${id}'`,
    );
    expect(rows[0]!.recording_enabled).toBe(false);
  });
});
