/**
 * Integration-test fixtures.
 *
 * Builds a small but realistic world — reference data, two doctors, three
 * patients, appointments — so the security tests can assert about real rows
 * rather than mocks. A test that stubs the repository proves nothing about
 * whether the query is scoped.
 */
import { createTestDatabase, type TestDatabase } from "../db";
import { hashPassword } from "../../lib/auth/password";
import { generateToken, hashToken } from "../../lib/auth/tokens";
import * as t from "../../lib/db/schema";

export interface Actor {
  userId: string;
  email: string;
  name: string;
  role: "patient" | "doctor" | "admin";
  patientId?: string;
  doctorId?: string;
  sessionToken: string;
  csrfToken: string;
}

export interface World {
  h: TestDatabase;
  patientA: Actor;
  patientB: Actor;
  doctor: Actor;
  otherDoctor: Actor;
  admin: Actor;
}

export const TEST_PASSWORD = "correct-horse-9";

/** A request carrying this actor's session and CSRF material. */
export function requestAs(
  actor: Actor | null,
  url: string,
  init: RequestInit = {},
): Request {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("origin", "http://localhost:3000");

  if (actor) {
    headers.set(
      "cookie",
      `niramoy_session=${actor.sessionToken}; niramoy_csrf=${actor.csrfToken}`,
    );
    headers.set("x-niramoy-csrf", actor.csrfToken);
  }

  return new Request(url, { ...init, headers });
}

/** A request with a session but a WRONG csrf header, for the CSRF tests. */
export function requestWithBadCsrf(actor: Actor, url: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("origin", "http://localhost:3000");
  headers.set("cookie", `niramoy_session=${actor.sessionToken}; niramoy_csrf=${actor.csrfToken}`);
  headers.set("x-niramoy-csrf", "not-the-right-token");
  return new Request(url, { ...init, headers });
}

async function makeSession(db: TestDatabase["db"], userId: string) {
  const sessionToken = generateToken();
  const csrfToken = generateToken();
  await db.insert(t.sessions).values({
    userId,
    tokenHash: hashToken(sessionToken),
    csrfSecret: csrfToken,
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  return { sessionToken, csrfToken };
}

export async function buildWorld(): Promise<World> {
  const h = await createTestDatabase();
  const db = h.db;
  const password = await hashPassword(TEST_PASSWORD);

  await h.client.exec(`
    INSERT INTO divisions (id, name) VALUES ('dhaka', 'Dhaka');
    INSERT INTO districts (id, division_id, name) VALUES ('dhaka', 'dhaka', 'Dhaka');
    INSERT INTO specialties (id, name) VALUES ('cardiology', 'Cardiology'), ('general', 'General Physician');
  `);

  async function makeUser(
    role: "patient" | "doctor" | "admin",
    name: string,
    email: string,
  ): Promise<Actor> {
    const [user] = await db
      .insert(t.users)
      .values({
        role,
        name,
        email,
        passwordHash: password.hash,
        passwordAlgo: password.algo,
        emailVerifiedAt: new Date(),
      })
      .returning({ id: t.users.id });

    const session = await makeSession(db, user!.id);
    const actor: Actor = { userId: user!.id, email, name, role, ...session };

    if (role === "patient") {
      const [patient] = await db
        .insert(t.patients)
        .values({
          userId: user!.id,
          patientCode: `NRM-${Math.floor(Math.random() * 900_000) + 100_000}`,
          displayName: name,
        })
        .returning({ id: t.patients.id });
      actor.patientId = patient!.id;
    }

    if (role === "doctor") {
      const [doctor] = await db
        .insert(t.doctors)
        .values({
          userId: user!.id,
          displayName: name,
          initials: "DR",
          slug: email.split("@")[0]!,
          primarySpecialtyId: "cardiology",
          districtId: "dhaka",
          divisionId: "dhaka",
          feeAmount: "800",
          consultationMinutes: 30,
          bmdcNumber: `A-${Math.floor(Math.random() * 90_000) + 10_000}`,
          verificationStatus: "verified",
          verifiedAt: new Date(),
          isDemoProfile: false,
          provenance: "bmdc_verified",
        })
        .returning({ id: t.doctors.id });
      actor.doctorId = doctor!.id;

      // Sunday-to-Thursday evening clinic, so slots exist to book.
      await db.insert(t.doctorAvailability).values(
        [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          doctorId: doctor!.id,
          weekday,
          startMinute: 10 * 60,
          endMinute: 18 * 60,
          slotMinutes: 30,
          bufferMinutes: 0,
          timezone: "Asia/Dhaka",
        })),
      );
    }

    return actor;
  }

  return {
    h,
    patientA: await makeUser("patient", "Patient A", "a@example.com"),
    patientB: await makeUser("patient", "Patient B", "b@example.com"),
    doctor: await makeUser("doctor", "Dr. Test", "doctor@example.com"),
    otherDoctor: await makeUser("doctor", "Dr. Other", "other@example.com"),
    admin: await makeUser("admin", "Admin", "admin@example.com"),
  };
}

/** Insert a completed appointment directly, bypassing the booking rules. */
export async function seedAppointment(
  world: World,
  input: {
    doctor: Actor;
    patient: Actor;
    startUtc: string;
    minutes?: number;
    status?: string;
    reference?: string;
  },
): Promise<string> {
  const minutes = input.minutes ?? 30;
  const start = new Date(input.startUtc);
  const [row] = await world.h.db
    .insert(t.appointments)
    .values({
      reference: input.reference ?? `REF-${Math.random().toString(36).slice(2, 10)}`,
      doctorId: input.doctor.doctorId!,
      patientId: input.patient.patientId!,
      bookedByUserId: input.patient.userId,
      startUtc: start,
      endUtc: new Date(start.getTime() + minutes * 60_000),
      durationMinutes: minutes,
      status: (input.status ?? "completed") as never,
      feeAmount: "800",
    })
    .returning({ id: t.appointments.id });
  return row!.id;
}
