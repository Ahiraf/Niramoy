/**
 * Niramoy — Seeded doctor directory
 * -----------------------------------------------------------------------------
 * ⚠️  READ THIS BEFORE USING THE DATA IN THIS FILE.
 *
 * Every profile produced here is a SYNTHETIC DEMO PROFILE. It is not a real
 * physician, and no real physician has consented to appear on Niramoy.
 *
 * Why it is built this way:
 *   Bangladesh has no public API or bulk registry of licensed doctors. The
 *   BM&DC verification service (verify.bmdc.org.bd) checks ONE registration
 *   number at a time behind a captcha; the DGHS "Doctor Directory" open dataset
 *   is from 2016, covers only part of Rajshahi division, and contains doctors'
 *   personal mobile numbers. Importing either as a bookable provider list would
 *   be inaccurate and a privacy violation.
 *
 *   So the directory is seeded on the REAL structural backbone — the 8
 *   divisions / 64 districts, real public hospital names, and the real DGHS
 *   specialty taxonomy — while the individual practitioners are invented.
 *
 * The real production path is the one the proposal specifies and that this
 * codebase implements alongside this seed: a doctor self-registers with their
 * BM&DC registration number, and an admin verifies it before the profile goes
 * live. See lib/bmdc.js and the admin verification queue.
 *
 * Every record carries `isDemoProfile: true`. The UI renders a "Demo profile"
 * badge for these, and `lib/store.js` will happily serve real, admin-verified
 * profiles alongside them once doctors start registering.
 */

import { DIVISIONS } from "./geo.js";
import { SPECIALTIES } from "./specialties.js";
import { FACILITIES } from "./facilities.js";

/** Bangladesh Standard Time is UTC+6 with no daylight saving. */
export const BD_OFFSET_MINUTES = 360;

/* -------------------------------------------------------------------------- */
/* Deterministic PRNG — the same seed always yields the same directory, so     */
/* server and client renders agree and demos are reproducible.                 */
/* -------------------------------------------------------------------------- */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const GIVEN_NAMES_M = [
  "Abdul", "Adnan", "Ahsan", "Anisur", "Arif", "Ashraful", "Bakhtiar", "Delwar",
  "Emran", "Faisal", "Farhan", "Golam", "Habibur", "Hasan", "Imtiaz", "Iqbal",
  "Jahangir", "Kamrul", "Khalid", "Mahfuz", "Mahmud", "Masud", "Mizanur",
  "Monirul", "Mostafa", "Nazmul", "Nurul", "Rafiqul", "Rashed", "Rezaul",
  "Saiful", "Shafiqul", "Shahriar", "Sohel", "Tanvir", "Tauhid", "Wahid", "Zahid",
];

const GIVEN_NAMES_F = [
  "Afroza", "Ayesha", "Bilkis", "Dilruba", "Farzana", "Fatema", "Hasina",
  "Israt", "Jesmin", "Kamrun", "Lubna", "Maisha", "Mahmuda", "Mst. Nasrin",
  "Nazneen", "Nusrat", "Papia", "Rafia", "Rahima", "Rokeya", "Rubina", "Sadia",
  "Salma", "Shahnaz", "Sharmin", "Shirin", "Sultana", "Tahmina", "Taslima",
  "Umme", "Yasmin", "Zakia",
];

const FAMILY_NAMES = [
  "Ahmed", "Akter", "Alam", "Ali", "Begum", "Bhuiyan", "Biswas", "Chowdhury",
  "Das", "Dutta", "Ghosh", "Haque", "Hossain", "Islam", "Jahan", "Kabir",
  "Karim", "Khan", "Khatun", "Kundu", "Mahmud", "Majumder", "Mia", "Mondal",
  "Nath", "Parvin", "Rahman", "Roy", "Saha", "Sarkar", "Sarwar", "Siddique",
  "Sultana", "Talukder", "Uddin",
];

/** Real Bangladeshi postgraduate qualification patterns, per specialty. */
const DEGREES = {
  general: ["MBBS", "MBBS, FCPS (Medicine)", "MBBS, MCPS"],
  medicine: ["MBBS, FCPS (Medicine)", "MBBS, MD (Internal Medicine)", "MBBS, MRCP (UK)"],
  cardiology: ["MBBS, D-Card", "MBBS, MD (Cardiology)", "MBBS, FCPS (Medicine), MD (Cardiology)"],
  pediatrics: ["MBBS, DCH", "MBBS, FCPS (Paediatrics)", "MBBS, MD (Paediatrics)"],
  gynecology: ["MBBS, FCPS (Gynae & Obs)", "MBBS, MCPS (Gynae & Obs)", "MBBS, MS (Gynae & Obs)"],
  dermatology: ["MBBS, DDV", "MBBS, MD (Dermatology)", "MBBS, FCPS (Skin & VD)"],
  psychiatry: ["MBBS, MPhil (Psychiatry)", "MBBS, FCPS (Psychiatry)", "MBBS, MD (Psychiatry)"],
  neurology: ["MBBS, MD (Neurology)", "MBBS, FCPS (Medicine), MD (Neurology)"],
  orthopedics: ["MBBS, MS (Orthopaedics)", "MBBS, D-Ortho", "MBBS, FCPS (Surgery)"],
  ent: ["MBBS, DLO", "MBBS, MS (ENT)", "MBBS, FCPS (ENT)"],
  ophthalmology: ["MBBS, DO", "MBBS, MS (Ophthalmology)", "MBBS, FCPS (Ophthalmology)"],
  surgery: ["MBBS, FCPS (Surgery)", "MBBS, MS (Surgery)", "MBBS, MCPS (Surgery)"],
  urology: ["MBBS, MS (Urology)", "MBBS, FCPS (Surgery), MS (Urology)"],
  dentistry: ["BDS", "BDS, FCPS (Dental Surgery)", "BDS, MS (Prosthodontics)"],
  endocrinology: ["MBBS, MD (Endocrinology)", "MBBS, FCPS (Medicine), MD (Endocrinology)"],
  gastroenterology: ["MBBS, MD (Gastroenterology)", "MBBS, FCPS (Medicine)"],
  pulmonology: ["MBBS, MD (Chest Diseases)", "MBBS, DTCD"],
  "physical-medicine": ["MBBS, MD (Physical Medicine)", "MBBS, FCPS (Physical Medicine)"],
};

const AVATAR_TONES = ["tan", "teal", "purple", "blue", "rose", "green"];

const REGIONAL_LANGUAGE = {
  Chattogram: "Chittagonian",
  Sylhet: "Sylheti",
  Rangpur: "Rangpuri",
  Barishal: "Barishali",
  Rajshahi: "Rajshahi regional",
};

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

function initialsOf(name) {
  const parts = name.replace(/^Dr\.?\s*/, "").split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "N";
  const last = parts[parts.length - 1]?.[0] ?? "A";
  return (first + last).toUpperCase();
}

/**
 * Build a weekly availability pattern. Rules are stored in UTC (as the
 * scheduling engine requires); the doctor "thinks" in Bangladesh time, so a
 * 09:00 BST clinic is written as 03:00 UTC.
 */
function buildAvailability(rng) {
  const patterns = [
    { days: [0, 1, 2, 3, 4], localStart: 9, localEnd: 13 },   // Sun–Thu morning
    { days: [6, 0, 1, 2, 3], localStart: 17, localEnd: 21 },  // evening chamber
    { days: [1, 3, 5], localStart: 10, localEnd: 14 },
    { days: [0, 2, 4, 6], localStart: 16, localEnd: 20 },
    { days: [0, 1, 2, 3, 4, 6], localStart: 18, localEnd: 21 },
  ];
  const p = pick(rng, patterns);
  const slotMinutes = pick(rng, [15, 20, 20, 25, 30]);
  const bufferMinutes = pick(rng, [0, 0, 5, 10]);
  const toUtc = (localHour) => localHour - BD_OFFSET_MINUTES / 60;

  return p.days.map((weekday) => ({
    weekday,
    start: `${String(toUtc(p.localStart)).padStart(2, "0")}:00`,
    end: `${String(toUtc(p.localEnd)).padStart(2, "0")}:00`,
    slotMinutes,
    bufferMinutes,
    // Kept for display only — the engine never reads these.
    localStart: `${String(p.localStart).padStart(2, "0")}:00`,
    localEnd: `${String(p.localEnd).padStart(2, "0")}:00`,
  }));
}

function buildBio(rng, specialty, district) {
  const openings = [
    `Provides ${specialty.name.toLowerCase()} care with an emphasis on clear explanation and a plan you can actually follow.`,
    `Sees patients from across ${district} and the surrounding upazilas, in Bangla or English.`,
    `Focused on early detection and long-term follow-up rather than one-off visits.`,
    `Believes most consultations should end with the patient understanding exactly what happens next.`,
  ];
  return `${specialty.blurb} ${pick(rng, openings)}`;
}

/**
 * Generate the seeded directory.
 * @param {number} [count=144] how many demo profiles to produce
 * @param {number} [seed=20240356] PRNG seed (CSE-356)
 */
export function generateDoctors(count = 144, seed = 20240356) {
  const rng = mulberry32(seed);
  const doctors = [];
  const usedNames = new Set();

  for (let i = 0; i < count; i += 1) {
    // Spread evenly across specialties, then across divisions.
    const specialty = SPECIALTIES[i % SPECIALTIES.length];
    const division = DIVISIONS[Math.floor(i / SPECIALTIES.length) % DIVISIONS.length];

    const inDivision = FACILITIES.filter((f) => f.division === division.name);
    const facility = pick(rng, inDivision.length ? inDivision : FACILITIES);
    const district = facility.district;

    // Unique-ish synthetic name.
    let name;
    let guard = 0;
    do {
      const female = rng() < 0.42;
      const given = pick(rng, female ? GIVEN_NAMES_F : GIVEN_NAMES_M);
      const family = pick(rng, FAMILY_NAMES);
      const middle = rng() < 0.3 ? `${pick(rng, ["Md.", "Mohammad", "A.K.M.", "S.M."])} ` : "";
      name = `Dr. ${female ? "" : middle}${given} ${family}`;
      guard += 1;
    } while (usedNames.has(name) && guard < 40);
    usedNames.add(name);

    const experience = 3 + Math.floor(rng() * 26);
    const ratingCount = 8 + Math.floor(rng() * 240);
    const rating = Number((3.9 + rng() * 1.1).toFixed(1));
    const feeBase = specialty.id === "general" ? 500 : 700;
    const fee = feeBase + Math.floor(rng() * 14) * 100;

    const languages = ["Bangla", "English"];
    const regional = REGIONAL_LANGUAGE[division.name];
    if (regional && rng() < 0.45) languages.push(regional);

    doctors.push({
      id: `nrm-d-${String(i + 1).padStart(4, "0")}`,
      name,
      initials: initialsOf(name),
      avatar: AVATAR_TONES[i % AVATAR_TONES.length],

      specialtyId: specialty.id,
      specialty: specialty.name,
      degrees: pick(rng, DEGREES[specialty.id] ?? DEGREES.general),

      facility: facility.name,
      facilityId: facility.id,
      district,
      division: division.name,
      divisionId: division.id,

      experienceYears: experience,
      fee,
      feeLabel: `৳ ${fee.toLocaleString("en-BD")}`,
      rating,
      ratingCount,
      languages,
      bio: buildBio(rng, specialty, district),

      // Verification state — mirrors doctor_profiles.verified / license_no.
      bmdcNumber: `A-${60000 + i * 7}`,
      verified: true,
      verifiedAt: "2026-07-01",

      // Provenance. Never render a demo profile without its badge.
      isDemoProfile: true,
      provenance: "seed",

      availability: buildAvailability(rng),
      consultationMinutes: 20,
      acceptsVideo: true,
      acceptsFollowUp: rng() < 0.8,
      nextAvailableHint: pick(rng, ["Today", "Tomorrow", "In 2 days", "This week"]),
    });
  }

  return doctors;
}

export const SEED_DOCTORS = generateDoctors();
