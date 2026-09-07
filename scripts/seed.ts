/**
 * Niramoy — development / demo seed
 *
 *   npm run db:seed
 *
 * Loads the real structural reference data (8 divisions, 64 districts, the DGHS
 * specialty taxonomy, real public hospitals) and, on top of it, a synthetic
 * demo directory.
 *
 * WHAT IS REAL AND WHAT IS NOT
 *   Real     — divisions, districts, specialty taxonomy, facility names.
 *   Invented — every practitioner, every patient, every appointment.
 *
 * No seeded doctor carries a BM&DC registration number. The prototype's
 * generator issued plausible-looking ones; those are fabricated credentials that
 * could collide with a real practitioner's, so the schema now forbids them on a
 * demo profile outright (ck_doctors_demo_has_no_registration).
 *
 * The seed refuses to run when demo profiles are disabled, which is the
 * production default.
 */
import "./_bootstrap";

import { sql } from "drizzle-orm";

import { hashPassword } from "../lib/auth/password";
import { getEnv } from "../lib/config/env";
import { closeDb, getDb } from "../lib/db/client";
import * as t from "../lib/db/schema";

// The prototype's reference data. Still the source of truth for these lists;
// these modules stay JavaScript until the phase that needs to change them.
import { DIVISIONS } from "../lib/data/geo.js";
import { SPECIALTIES } from "../lib/data/specialties.js";
import { FACILITIES } from "../lib/data/facilities.js";
import { SEED_DOCTORS, BD_OFFSET_MINUTES } from "../lib/data/doctors.js";

interface SeedDivision { id: string; name: string; bn?: string; districts: string[] }
interface SeedSpecialty { id: string; name: string; bn?: string; icon?: string; blurb?: string; dghs?: string[] }
interface SeedFacility { id: string; name: string; district: string; division: string; type?: string }
interface SeedAvailability {
  weekday: number; start: string; end: string;
  slotMinutes: number; bufferMinutes: number;
  localStart?: string; localEnd?: string;
}
interface SeedDoctor {
  id: string; name: string; initials: string; avatar: string;
  specialtyId: string; degrees: string; bio: string;
  facilityId: string; district: string; divisionId: string;
  experienceYears: number; fee: number; rating: number; ratingCount: number;
  languages: string[]; consultationMinutes: number;
  acceptsVideo: boolean; acceptsFollowUp: boolean;
  availability: SeedAvailability[];
}

export const DEMO_PASSWORD = "niramoy123";
const TZ = "Asia/Dhaka";

/** "Dhaka" -> "dhaka", "Cox's Bazar" -> "coxs-bazar". Stable, URL-safe ids. */
const slugify = (value: string): string =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const hhmmToMinutes = (value: string): number => {
  const [h, m] = value.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

async function main(): Promise<void> {
  const env = getEnv();

  if (!env.allowDemoProfiles) {
    throw new Error(
      "Refusing to seed: ALLOW_DEMO_PROFILES is false. Synthetic profiles must " +
        "never be inserted into a production directory.",
    );
  }

  const db = getDb();
  console.log(`▸ seeding (env: ${env.APP_ENV})`);

  /* ---- Reference data --------------------------------------------------- */

  const divisions = DIVISIONS as SeedDivision[];

  await db
    .insert(t.divisions)
    .values(
      divisions.map((d, i) => ({ id: d.id, name: d.name, nameBn: d.bn ?? null, sortOrder: i })),
    )
    .onConflictDoNothing();

  const districtRows = divisions.flatMap((d) =>
    d.districts.map((name) => ({
      id: slugify(name),
      divisionId: d.id,
      name,
      nameBn: null,
    })),
  );
  await db.insert(t.districts).values(districtRows).onConflictDoNothing();

  await db
    .insert(t.specialties)
    .values(
      (SPECIALTIES as SeedSpecialty[]).map((s, i) => ({
        id: s.id,
        name: s.name,
        nameBn: s.bn ?? null,
        icon: s.icon ?? null,
        blurb: s.blurb ?? null,
        dghsLabels: s.dghs ?? [],
        sortOrder: i,
      })),
    )
    .onConflictDoNothing();

  await db
    .insert(t.facilities)
    .values(
      (FACILITIES as SeedFacility[]).map((f) => ({
        id: f.id,
        name: f.name,
        kind: f.type ?? null,
        divisionId: slugify(f.division),
        districtId: slugify(f.district),
      })),
    )
    .onConflictDoNothing();

  console.log(
    `  reference: ${divisions.length} divisions, ${districtRows.length} districts, ` +
      `${(SPECIALTIES as unknown[]).length} specialties, ${(FACILITIES as unknown[]).length} facilities`,
  );

  /* ---- Synthetic doctor directory --------------------------------------- */

  const seedDoctors = SEED_DOCTORS as SeedDoctor[];
  const verifiedAt = new Date("2026-07-01T00:00:00Z");

  const doctorRows = seedDoctors.map((d) => ({
    id: sql`gen_random_uuid()`,
    displayName: d.name,
    initials: d.initials,
    avatar: d.avatar,
    slug: slugify(`${d.name}-${d.id}`),
    primarySpecialtyId: d.specialtyId,
    degrees: d.degrees,
    bio: d.bio,
    experienceYears: d.experienceYears,
    languages: d.languages,
    facilityId: d.facilityId,
    districtId: slugify(d.district),
    divisionId: d.divisionId,
    feeAmount: String(d.fee),
    currency: "BDT",
    consultationMinutes: d.consultationMinutes,
    acceptsVideo: d.acceptsVideo,
    acceptsFollowUp: d.acceptsFollowUp,

    // No registration number. A demo profile has no registration, because there
    // is nobody to register. The schema enforces this.
    bmdcNumber: null,
    verificationStatus: "verified" as const,
    verifiedAt,
    isDemoProfile: true,
    provenance: "synthetic_seed",

    ratingAvg: String(d.rating),
    ratingCount: d.ratingCount,
  }));

  const inserted = await db
    .insert(t.doctors)
    .values(doctorRows)
    .returning({ id: t.doctors.id, slug: t.doctors.slug });

  // Secondary-specialty join rows (primary only, for now).
  await db.insert(t.doctorSpecialties).values(
    inserted.map((row, i) => ({
      doctorId: row.id,
      specialtyId: seedDoctors[i]!.specialtyId,
      isPrimary: true,
    })),
  );

  /**
   * Availability.
   *
   * The prototype pre-converted local hours to UTC by subtracting six
   * (`toUtc = localHour - BD_OFFSET_MINUTES / 60`) and stored the result as the
   * rule. That bakes a fixed offset into the data and produces a negative hour
   * for any clinic starting before 06:00 local.
   *
   * The schema stores the LOCAL window plus its IANA zone, and the scheduling
   * engine converts. So the offset is undone here on the way in.
   */
  const availabilityRows = inserted.flatMap((row, i) =>
    seedDoctors[i]!.availability.map((rule) => {
      const startLocal = rule.localStart
        ? hhmmToMinutes(rule.localStart)
        : hhmmToMinutes(rule.start) + BD_OFFSET_MINUTES;
      const endLocal = rule.localEnd
        ? hhmmToMinutes(rule.localEnd)
        : hhmmToMinutes(rule.end) + BD_OFFSET_MINUTES;

      return {
        doctorId: row.id,
        weekday: rule.weekday,
        startMinute: startLocal,
        endMinute: endLocal,
        slotMinutes: rule.slotMinutes,
        bufferMinutes: rule.bufferMinutes,
        timezone: TZ,
      };
    }),
  );
  await db.insert(t.doctorAvailability).values(availabilityRows);

  console.log(
    `  directory: ${inserted.length} synthetic doctors (all flagged isDemoProfile), ` +
      `${availabilityRows.length} availability rules`,
  );

  /* ---- Demo accounts ----------------------------------------------------- */

  const password = await hashPassword(DEMO_PASSWORD);

  const [patientUser] = await db
    .insert(t.users)
    .values({
      role: "patient",
      name: "Nabila Begum",
      email: "nabila@example.com",
      phone: "+880 1712 345 678",
      passwordHash: password.hash,
      passwordAlgo: password.algo,
      emailVerifiedAt: new Date(),
    })
    .returning({ id: t.users.id });

  const [doctorUser] = await db
    .insert(t.users)
    .values({
      role: "doctor",
      name: "Dr. Ayesha Khan",
      email: "ayesha@example.com",
      passwordHash: password.hash,
      passwordAlgo: password.algo,
      emailVerifiedAt: new Date(),
    })
    .returning({ id: t.users.id });

  const [adminUser] = await db
    .insert(t.users)
    .values({
      role: "admin",
      name: "Sakib Rahman",
      email: "sakib@example.com",
      passwordHash: password.hash,
      passwordAlgo: password.algo,
      emailVerifiedAt: new Date(),
    })
    .returning({ id: t.users.id });

  const [patient] = await db
    .insert(t.patients)
    .values({
      userId: patientUser!.id,
      patientCode: "NRM-240184",
      displayName: "Nabila Begum",
      divisionId: "dhaka",
      districtId: "dhaka",
    })
    .returning({ id: t.patients.id });

  /**
   * The demo doctor account gets its own bookable profile so the doctor
   * workspace has real data. It is a DEMO profile — badged as such in the UI —
   * because Dr. Ayesha Khan is invented and holds no registration.
   */
  const [ayeshaProfile] = await db
    .insert(t.doctors)
    .values({
      userId: doctorUser!.id,
      displayName: "Dr. Ayesha Khan",
      initials: "AK",
      avatar: "teal",
      slug: "dr-ayesha-khan-demo",
      primarySpecialtyId: "cardiology",
      degrees: "MBBS, MD (Cardiology)",
      bio: "Heart failure, hypertension and long-term cardiac follow-up.",
      experienceYears: 14,
      languages: ["Bangla", "English"],
      facilityId: "nicvd",
      districtId: "dhaka",
      divisionId: "dhaka",
      feeAmount: "1200",
      consultationMinutes: 20,
      bmdcNumber: null,
      verificationStatus: "verified",
      verifiedAt,
      isDemoProfile: true,
      provenance: "synthetic_seed",
      ratingAvg: "4.8",
      ratingCount: 96,
    })
    .returning({ id: t.doctors.id });

  await db.insert(t.doctorSpecialties).values({
    doctorId: ayeshaProfile!.id,
    specialtyId: "cardiology",
    isPrimary: true,
  });

  // Sun–Thu, 17:00–21:00 local, 20-minute slots.
  await db.insert(t.doctorAvailability).values(
    [0, 1, 2, 3, 4].map((weekday) => ({
      doctorId: ayeshaProfile!.id,
      weekday,
      startMinute: 17 * 60,
      endMinute: 21 * 60,
      slotMinutes: 20,
      bufferMinutes: 0,
      timezone: TZ,
    })),
  );

  await db.insert(t.familyAccounts).values({ ownerUserId: patientUser!.id, label: "Household" });

  console.log("  accounts: 3 demo logins (patient / doctor / admin)");

  /* ---- A pending verification, so the admin queue is not empty ----------- */

  await db.insert(t.doctorVerifications).values({
    userId: null,
    // Synthetic. Well-formed so the validator accepts it, in a high range that
    // is unlikely to collide, and labelled in `notes` so no reviewer mistakes
    // it for a live application.
    registrationNumber: "A-999001",
    registrationType: "mbbs",
    claimedName: "Dr. Mahmudul Karim",
    claimedSpecialtyId: "gastroenterology",
    claimedDegrees: "MBBS, MD (Gastroenterology)",
    claimedFacility: "Dhaka Medical College Hospital",
    claimedDistrictId: "dhaka",
    claimedDivisionId: "dhaka",
    claimedExperienceYears: 11,
    contactEmail: "mahmudul.karim@example.com",
    status: "pending",
    notes: "SEEDED DEMO APPLICATION — not a real person and not a real registration number.",
  });

  console.log("  verification: 1 pending demo application");

  /* ---- Patient history --------------------------------------------------- */

  const gp = inserted.find((_, i) => seedDoctors[i]!.specialtyId === "general");
  if (gp) {
    const start = new Date(Date.now() - 9 * 86_400_000);
    start.setUTCMinutes(0, 0, 0);
    const end = new Date(start.getTime() + 20 * 60_000);

    const [past] = await db
      .insert(t.appointments)
      .values({
        reference: "NRM-A-0001",
        doctorId: gp.id,
        patientId: patient!.id,
        bookedByUserId: patientUser!.id,
        startUtc: start,
        endUtc: end,
        durationMinutes: 20,
        status: "completed",
        type: "video",
        reason: "Recurring headaches",
        feeAmount: "600",
        completedAt: end,
      })
      .returning({ id: t.appointments.id });

    await db.insert(t.appointmentStatusHistory).values({
      appointmentId: past!.id,
      fromStatus: "confirmed",
      toStatus: "completed",
      reasonCode: "seed",
    });

    const [rx] = await db
      .insert(t.prescriptions)
      .values({
        prescriptionNumber: "NRM-RX-0001",
        appointmentId: past!.id,
        patientId: patient!.id,
        doctorId: gp.id,
        diagnosis: "Tension-type headache",
        notes: "Hydration, regular meals and a consistent sleep schedule.",
        advice: "Review in two weeks if symptoms persist.",
        status: "issued",
        issuedAt: end,
      })
      .returning({ id: t.prescriptions.id });

    await db.insert(t.prescriptionItems).values([
      {
        prescriptionId: rx!.id,
        position: 0,
        medicine: "Paracetamol",
        strength: "500 mg",
        dose: "1 tablet",
        route: "Oral",
        frequency: "Up to 3 times daily as needed",
        duration: "5 days",
        quantity: "15 tablets",
        instructions: "Take after food. Do not exceed 3 g in 24 hours.",
      },
      {
        prescriptionId: rx!.id,
        position: 1,
        medicine: "Omeprazole",
        strength: "20 mg",
        dose: "1 capsule",
        route: "Oral",
        frequency: "Once daily before breakfast",
        duration: "10 days",
        quantity: "10 capsules",
        instructions: "Take 30 minutes before the first meal of the day.",
      },
    ]);
  }

  await db.insert(t.medicalRecords).values([
    {
      patientId: patient!.id,
      authorUserId: patientUser!.id,
      authorRole: "patient",
      authorDisplayName: "Nabila Begum",
      kind: "lab",
      title: "Complete blood count (CBC)",
      body: "All values within normal range. Haemoglobin 12.8 g/dL.",
    },
    {
      patientId: patient!.id,
      authorUserId: patientUser!.id,
      authorRole: "patient",
      authorDisplayName: "Nabila Begum",
      kind: "note",
      title: "Blood pressure log",
      body: "Two weeks of home readings, averaging 128/84 mmHg.",
    },
  ]);

  console.log("  patient history: 1 completed visit, 1 prescription, 2 records");

  console.log(
    `\n✓ seeded. Sign in with nabila@example.com / ayesha@example.com / sakib@example.com` +
      `\n  password: ${DEMO_PASSWORD}` +
      `\n  admin invite code: ${env.adminInviteCode}\n`,
  );

  void adminUser;
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error("✗ seed failed");
    console.error(err);
    await closeDb().catch(() => {});
    process.exit(1);
  });
