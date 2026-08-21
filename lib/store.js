/**
 * Niramoy — data layer
 * -----------------------------------------------------------------------------
 * THE SINGLE SWAP POINT. Every API route talks to this module and nothing else.
 * Today it is an in-memory store seeded from lib/data/*; to move to Vercel
 * Postgres you replace the function bodies here with SQL against db/schema.sql
 * and no route or component changes.
 *
 * The table names in the comments map 1:1 to db/schema.sql.
 */

import { SEED_DOCTORS, BD_OFFSET_MINUTES } from "./data/doctors.js";
import { SPECIALTIES } from "./data/specialties.js";
import { DIVISIONS } from "./data/geo.js";
import { FACILITIES } from "./data/facilities.js";
import schedulingModule from "./scheduling.js";
import { VERIFICATION_STATUS } from "./bmdc.js";

const { generateSlots, canBook, canCancel } = schedulingModule;

/* -------------------------------------------------------------------------- */
/* In-memory tables                                                            */
/* -------------------------------------------------------------------------- */

const db = globalThis.__niramoy ?? (globalThis.__niramoy = {
  doctors: [...SEED_DOCTORS],          // doctor_profiles
  appointments: [],                    // appointments
  prescriptions: [],                   // prescriptions + prescription_items
  records: [],                         // medical_records
  notifications: [],                   // notifications
  reviews: [],                         // reviews
  waitlist: [],                        // waitlist
  familyMembers: [],                   // family accounts
  verificationQueue: [],               // pending doctor_profiles
  seq: 1,
});

const nextId = () => db.seq++;

/** The signed-in demo patient. Replace with the NextAuth session user. */
export const CURRENT_PATIENT = {
  id: "nrm-p-0001",
  name: "Nabila Begum",
  initials: "NB",
  email: "nabila@example.com",
  phone: "+880 1712 345 678",
  avatar: "tan",
  patientCode: "NRM-240184",
  district: "Dhaka",
  division: "Dhaka",
};

/* -------------------------------------------------------------------------- */
/* Reference data                                                              */
/* -------------------------------------------------------------------------- */

export function getSpecialties() {
  return SPECIALTIES.map((s) => ({
    ...s,
    doctorCount: db.doctors.filter((d) => d.specialtyId === s.id && d.verified).length,
  }));
}

export function getDivisions() {
  return DIVISIONS.map((d) => ({
    ...d,
    doctorCount: db.doctors.filter((doc) => doc.divisionId === d.id && doc.verified).length,
  }));
}

export function getFacilities() {
  return FACILITIES;
}

/* -------------------------------------------------------------------------- */
/* Doctors                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Search the verified directory.
 * @param {Object} q
 * @param {string} [q.search]      free text over name / specialty / facility
 * @param {string} [q.specialty]   specialty name
 * @param {string} [q.division]    division name
 * @param {string} [q.district]    district name
 * @param {number} [q.maxFee]
 * @param {number} [q.minRating]
 * @param {string} [q.language]
 * @param {string} [q.sort]        best | rating | fee_low | fee_high | experience
 */
export function searchDoctors(q = {}) {
  const term = (q.search ?? "").trim().toLowerCase();
  let out = db.doctors.filter((d) => d.verified);

  if (term) {
    out = out.filter((d) =>
      `${d.name} ${d.specialty} ${d.facility} ${d.district} ${d.degrees}`
        .toLowerCase()
        .includes(term)
    );
  }
  if (q.specialty && q.specialty !== "All specialties") {
    out = out.filter((d) => d.specialty === q.specialty);
  }
  if (q.division && q.division !== "All divisions") {
    out = out.filter((d) => d.division === q.division);
  }
  if (q.district && q.district !== "All districts") {
    out = out.filter((d) => d.district === q.district);
  }
  if (q.maxFee) out = out.filter((d) => d.fee <= Number(q.maxFee));
  if (q.minRating) out = out.filter((d) => d.rating >= Number(q.minRating));
  if (q.language && q.language !== "Any language") {
    out = out.filter((d) => d.languages.includes(q.language));
  }

  const sorters = {
    rating: (a, b) => b.rating - a.rating || b.ratingCount - a.ratingCount,
    fee_low: (a, b) => a.fee - b.fee,
    fee_high: (a, b) => b.fee - a.fee,
    experience: (a, b) => b.experienceYears - a.experienceYears,
    best: (a, b) =>
      b.rating * Math.log10(b.ratingCount + 10) -
      a.rating * Math.log10(a.ratingCount + 10),
  };
  return [...out].sort(sorters[q.sort] ?? sorters.best);
}

export function getDoctor(id) {
  return db.doctors.find((d) => d.id === id) ?? null;
}

/**
 * Bookable slots for a doctor, via the scheduling engine.
 * @returns {{startUtc: string, localLabel: string, period: "Morning"|"Afternoon"|"Evening"}[]}
 */
export function getDoctorSlots(doctorId, { days = 14, now = new Date() } = {}) {
  const doctor = getDoctor(doctorId);
  if (!doctor) return [];

  const booked = db.appointments
    .filter((a) => a.doctorId === doctorId && !["cancelled", "no_show"].includes(a.status))
    .map((a) => new Date(a.startUtc));

  const rangeStart = new Date(now);
  const rangeEnd = new Date(now.getTime() + days * 86400000);

  return generateSlots({
    rules: doctor.availability,
    exceptions: doctor.exceptions ?? [],
    booked,
    rangeStart,
    rangeEnd,
    now,
    leadMinutes: 60, // no booking inside the next hour
  }).map(describeSlot);
}

/** Render a UTC slot in Bangladesh Standard Time. */
function describeSlot(startUtc) {
  const local = new Date(startUtc.getTime() + BD_OFFSET_MINUTES * 60000);
  const hour = local.getUTCHours();
  const minute = local.getUTCMinutes();
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  const period = hour < 12 ? "Morning" : hour < 17 ? "Afternoon" : "Evening";

  return {
    startUtc: startUtc.toISOString(),
    dateKey: local.toISOString().slice(0, 10),
    day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][local.getUTCDay()],
    date: String(local.getUTCDate()),
    month: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][local.getUTCMonth()],
    localLabel: `${String(h12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`,
    period,
  };
}

export { describeSlot };

/* -------------------------------------------------------------------------- */
/* Appointments                                                                */
/* -------------------------------------------------------------------------- */

export function listAppointments({ patientId, doctorId } = {}) {
  return db.appointments
    .filter((a) => (!patientId || a.patientId === patientId) && (!doctorId || a.doctorId === doctorId))
    .map(hydrateAppointment)
    .sort((a, b) => new Date(a.startUtc) - new Date(b.startUtc));
}

function hydrateAppointment(a) {
  const slot = describeSlot(new Date(a.startUtc));
  return {
    ...a,
    doctor: getDoctor(a.doctorId),
    ...slot,
    time: slot.localLabel,
    canCancel: canCancel({ appointmentStart: new Date(a.startUtc), cancelWindowMinutes: 60 }),
  };
}

/**
 * Book a slot. Mirrors the transactional insert guarded by
 * `UNIQUE (doctor_id, start_utc)` in db/schema.sql — the duplicate check below
 * is what that constraint does at the database level.
 *
 * @returns {{ok: boolean, appointment?: object, reason?: string}}
 */
export function bookAppointment({ doctorId, patientId, startUtc, forMember = null, reason = "" }) {
  const doctor = getDoctor(doctorId);
  if (!doctor) return { ok: false, reason: "doctor_not_found" };

  const now = new Date();
  const available = getDoctorSlots(doctorId, { now }).map((s) => new Date(s.startUtc));
  const check = canBook({
    requestedStart: new Date(startUtc),
    availableSlots: available,
    now,
    leadMinutes: 60,
  });
  if (!check.ok) return { ok: false, reason: check.reason };

  // UNIQUE (doctor_id, start_utc)
  const clash = db.appointments.some(
    (a) =>
      a.doctorId === doctorId &&
      a.startUtc === new Date(startUtc).toISOString() &&
      !["cancelled", "no_show"].includes(a.status)
  );
  if (clash) return { ok: false, reason: "slot_taken" };

  const appointment = {
    id: `nrm-a-${nextId()}`,
    doctorId,
    patientId,
    forMember,
    reason,
    startUtc: new Date(startUtc).toISOString(),
    status: "confirmed",
    type: "Video consultation",
    videoRoomId: `niramoy-${doctorId}-${Date.now().toString(36)}`,
    fee: doctor.fee,
    createdAt: now.toISOString(),
  };
  db.appointments.push(appointment);

  notify(patientId, "appointment_confirmed", {
    title: "Appointment confirmed",
    body: `Your consultation with ${doctor.name} is booked.`,
  });

  return { ok: true, appointment: hydrateAppointment(appointment) };
}

export function cancelAppointment(id) {
  const appt = db.appointments.find((a) => a.id === id);
  if (!appt) return { ok: false, reason: "not_found" };
  if (!canCancel({ appointmentStart: new Date(appt.startUtc), cancelWindowMinutes: 60 })) {
    return { ok: false, reason: "cancel_window_closed" };
  }
  appt.status = "cancelled";
  promoteWaitlist(appt.doctorId, appt.startUtc);
  return { ok: true, appointment: hydrateAppointment(appt) };
}

export function rescheduleAppointment(id, newStartUtc) {
  const appt = db.appointments.find((a) => a.id === id);
  if (!appt) return { ok: false, reason: "not_found" };

  const previous = appt.startUtc;
  appt.status = "cancelled"; // free the old slot before re-checking
  const result = bookAppointment({
    doctorId: appt.doctorId,
    patientId: appt.patientId,
    startUtc: newStartUtc,
    forMember: appt.forMember,
    reason: appt.reason,
  });
  if (!result.ok) {
    appt.status = "confirmed"; // roll back
    return result;
  }
  promoteWaitlist(appt.doctorId, previous);
  return result;
}

export function completeAppointment(id) {
  const appt = db.appointments.find((a) => a.id === id);
  if (appt) appt.status = "completed";
  return appt ? { ok: true, appointment: hydrateAppointment(appt) } : { ok: false };
}

/* -------------------------------------------------------------------------- */
/* Waitlist                                                                    */
/* -------------------------------------------------------------------------- */

export function joinWaitlist({ doctorId, patientId, dateKey }) {
  const entry = { id: `nrm-w-${nextId()}`, doctorId, patientId, dateKey, createdAt: new Date().toISOString() };
  db.waitlist.push(entry);
  return entry;
}

export function listWaitlist(patientId) {
  return db.waitlist
    .filter((w) => w.patientId === patientId)
    .map((w) => ({ ...w, doctor: getDoctor(w.doctorId) }));
}

export function leaveWaitlist(id) {
  db.waitlist = db.waitlist.filter((w) => w.id !== id);
  return { ok: true };
}

/** When a slot frees up, tell the first person waiting for that doctor/day. */
function promoteWaitlist(doctorId, startUtc) {
  const dateKey = describeSlot(new Date(startUtc)).dateKey;
  const waiting = db.waitlist.find((w) => w.doctorId === doctorId && w.dateKey === dateKey);
  if (!waiting) return;
  const doctor = getDoctor(doctorId);
  notify(waiting.patientId, "waitlist_slot_open", {
    title: "A slot just opened",
    body: `${doctor?.name ?? "Your doctor"} has an opening on ${dateKey}. Book it before someone else does.`,
    doctorId,
  });
}

/* -------------------------------------------------------------------------- */
/* Prescriptions & medical records                                             */
/* -------------------------------------------------------------------------- */

export function listPrescriptions(patientId) {
  return db.prescriptions
    .filter((p) => p.patientId === patientId)
    .map((p) => ({ ...p, doctor: getDoctor(p.doctorId) }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function addPrescription({ appointmentId, patientId, doctorId, diagnosis, notes, items = [], aiSummary = null }) {
  const prescription = {
    id: `nrm-rx-${nextId()}`,
    appointmentId, patientId, doctorId,
    diagnosis, notes, items, aiSummary,
    createdAt: new Date().toISOString(),
  };
  db.prescriptions.push(prescription);
  notify(patientId, "prescription_ready", {
    title: "Prescription ready",
    body: `${getDoctor(doctorId)?.name ?? "Your doctor"} added a prescription to your records.`,
  });
  return prescription;
}

export function listRecords(patientId) {
  return db.records
    .filter((r) => r.patientId === patientId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function addRecord({ patientId, title, note, kind = "note", fileUrl = null }) {
  const record = {
    id: `nrm-mr-${nextId()}`,
    patientId, title, note, kind, fileUrl,
    createdAt: new Date().toISOString(),
  };
  db.records.push(record);
  return record;
}

/* -------------------------------------------------------------------------- */
/* Reviews                                                                     */
/* -------------------------------------------------------------------------- */

export function addReview({ appointmentId, patientId, doctorId, rating, comment }) {
  if (db.reviews.some((r) => r.appointmentId === appointmentId)) {
    return { ok: false, reason: "already_reviewed" }; // UNIQUE (appointment_id)
  }
  const review = {
    id: `nrm-rv-${nextId()}`,
    appointmentId, patientId, doctorId,
    rating: Math.max(1, Math.min(5, Number(rating))),
    comment,
    createdAt: new Date().toISOString(),
  };
  db.reviews.push(review);

  // Maintain doctor_profiles.rating_avg / rating_count.
  const doctor = getDoctor(doctorId);
  if (doctor) {
    const total = doctor.rating * doctor.ratingCount + review.rating;
    doctor.ratingCount += 1;
    doctor.rating = Number((total / doctor.ratingCount).toFixed(2));
  }
  return { ok: true, review };
}

export function listReviews(doctorId) {
  return db.reviews.filter((r) => r.doctorId === doctorId);
}

/* -------------------------------------------------------------------------- */
/* Family members                                                              */
/* -------------------------------------------------------------------------- */

export function listFamily(patientId) {
  return db.familyMembers.filter((m) => m.ownerId === patientId);
}

export function addFamilyMember({ ownerId, name, relation, age, gender }) {
  const member = {
    id: `nrm-fm-${nextId()}`,
    ownerId, name, relation, age, gender,
    initials: name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase(),
    createdAt: new Date().toISOString(),
  };
  db.familyMembers.push(member);
  return member;
}

export function removeFamilyMember(id) {
  db.familyMembers = db.familyMembers.filter((m) => m.id !== id);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

export function notify(userId, type, payload) {
  const n = {
    id: `nrm-n-${nextId()}`,
    userId, type, payload,
    read: false,
    createdAt: new Date().toISOString(),
  };
  db.notifications.unshift(n);
  return n;
}

export function listNotifications(userId) {
  return db.notifications.filter((n) => n.userId === userId).slice(0, 30);
}

export function markNotificationsRead(userId) {
  db.notifications.forEach((n) => {
    if (n.userId === userId) n.read = true;
  });
  return { ok: true };
}

/* -------------------------------------------------------------------------- */
/* Doctor onboarding & admin verification                                      */
/* -------------------------------------------------------------------------- */

export function submitDoctorApplication(application) {
  const entry = {
    id: `nrm-va-${nextId()}`,
    ...application,
    status: VERIFICATION_STATUS.PENDING,
    submittedAt: new Date().toISOString(),
  };
  db.verificationQueue.push(entry);
  return entry;
}

export function listVerificationQueue() {
  return [...db.verificationQueue].sort(
    (a, b) => new Date(b.submittedAt) - new Date(a.submittedAt)
  );
}

/**
 * Admin decision. On approval the applicant becomes a real, non-demo,
 * bookable doctor in the same directory as the seed profiles.
 */
export function decideApplication(id, { approve, adminNote = "", verifiedName = null }) {
  const entry = db.verificationQueue.find((v) => v.id === id);
  if (!entry) return { ok: false, reason: "not_found" };

  entry.status = approve ? VERIFICATION_STATUS.VERIFIED : VERIFICATION_STATUS.REJECTED;
  entry.decidedAt = new Date().toISOString();
  entry.adminNote = adminNote;

  if (!approve) return { ok: true, entry };

  const name = verifiedName || entry.name;
  db.doctors.push({
    id: `nrm-d-${nextId()}`,
    name,
    initials: name.replace(/^Dr\.?\s*/, "").split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase(),
    avatar: "teal",
    specialtyId: entry.specialtyId,
    specialty: entry.specialty,
    degrees: entry.degrees,
    facility: entry.facility,
    district: entry.district,
    division: entry.division,
    divisionId: DIVISIONS.find((d) => d.name === entry.division)?.id ?? "dhaka",
    experienceYears: Number(entry.experienceYears) || 1,
    fee: Number(entry.fee) || 500,
    feeLabel: `৳ ${(Number(entry.fee) || 500).toLocaleString("en-BD")}`,
    rating: 0,
    ratingCount: 0,
    languages: entry.languages ?? ["Bangla", "English"],
    bio: entry.bio ?? "",
    bmdcNumber: entry.bmdcNumber,
    verified: true,
    verifiedAt: entry.decidedAt.slice(0, 10),
    // The whole point: an admin-verified doctor is NOT a demo profile.
    isDemoProfile: false,
    provenance: "bmdc_verified",
    availability: entry.availability ?? [],
    consultationMinutes: 20,
    acceptsVideo: true,
    acceptsFollowUp: true,
    nextAvailableHint: "This week",
  });

  return { ok: true, entry };
}

/* -------------------------------------------------------------------------- */
/* Platform stats (admin overview)                                             */
/* -------------------------------------------------------------------------- */

export function platformStats() {
  const verified = db.doctors.filter((d) => d.verified);
  return {
    doctors: verified.length,
    demoDoctors: verified.filter((d) => d.isDemoProfile).length,
    realDoctors: verified.filter((d) => !d.isDemoProfile).length,
    divisionsCovered: new Set(verified.map((d) => d.division)).size,
    districtsCovered: new Set(verified.map((d) => d.district)).size,
    specialties: new Set(verified.map((d) => d.specialtyId)).size,
    appointments: db.appointments.length,
    pendingVerifications: db.verificationQueue.filter(
      (v) => v.status === VERIFICATION_STATUS.PENDING
    ).length,
  };
}

/* -------------------------------------------------------------------------- */
/* Demo seeding — gives a fresh session something to look at                    */
/* -------------------------------------------------------------------------- */

export function ensureDemoData() {
  if (db.appointments.length || db.records.length) return;

  const pick = (specialtyId) => db.doctors.find((d) => d.specialtyId === specialtyId);
  const cardiologist = pick("cardiology");
  const gp = pick("general");
  const derm = pick("dermatology");

  // One upcoming appointment on the doctor's next real generated slot.
  if (cardiologist) {
    const slots = getDoctorSlots(cardiologist.id);
    if (slots[0]) {
      bookAppointment({
        doctorId: cardiologist.id,
        patientId: CURRENT_PATIENT.id,
        startUtc: slots[0].startUtc,
        reason: "Follow-up on blood pressure readings",
      });
    }
  }

  // One completed past visit, with a prescription and a record.
  if (gp) {
    const past = {
      id: `nrm-a-${nextId()}`,
      doctorId: gp.id,
      patientId: CURRENT_PATIENT.id,
      forMember: null,
      reason: "Recurring headaches",
      startUtc: new Date(Date.now() - 9 * 86400000).toISOString(),
      status: "completed",
      type: "Video consultation",
      videoRoomId: "niramoy-past-demo",
      fee: gp.fee,
      createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
    };
    db.appointments.push(past);

    addPrescription({
      appointmentId: past.id,
      patientId: CURRENT_PATIENT.id,
      doctorId: gp.id,
      diagnosis: "Tension-type headache",
      notes: "Hydration, regular meals and a consistent sleep schedule. Review in two weeks.",
      aiSummary:
        "Patient reported recurring bilateral headaches over three weeks, worse in the afternoon, " +
        "with irregular meals and short sleep. No red-flag features. Advised hydration, regular " +
        "meals, sleep hygiene and simple analgesia; two-week follow-up arranged.",
      items: [
        { drug: "Paracetamol", dose: "500 mg", frequency: "1 tablet, up to 3× daily as needed", duration: "5 days" },
        { drug: "Omeprazole", dose: "20 mg", frequency: "1 capsule before breakfast", duration: "10 days" },
      ],
    });
  }

  if (derm) {
    const slots = getDoctorSlots(derm.id);
    if (slots[6]) {
      bookAppointment({
        doctorId: derm.id,
        patientId: CURRENT_PATIENT.id,
        startUtc: slots[6].startUtc,
        reason: "Persistent skin rash on forearm",
      });
    }
  }

  addRecord({
    patientId: CURRENT_PATIENT.id,
    title: "Complete blood count (CBC)",
    note: "All values within normal range. Haemoglobin 12.8 g/dL.",
    kind: "lab",
  });
  addRecord({
    patientId: CURRENT_PATIENT.id,
    title: "Blood pressure log",
    note: "Two weeks of home readings, averaging 128/84 mmHg.",
    kind: "note",
  });

  // A doctor waiting in the admin verification queue, to demo the real flow.
  submitDoctorApplication({
    name: "Dr. Mahmudul Karim",
    email: "mahmudul.karim@example.com",
    bmdcNumber: "A-58211",
    registrationType: "mbbs",
    specialtyId: "gastroenterology",
    specialty: "Gastroenterology",
    degrees: "MBBS, MD (Gastroenterology)",
    facility: "Dhaka Medical College Hospital",
    district: "Dhaka",
    division: "Dhaka",
    experienceYears: 11,
    fee: 1200,
    languages: ["Bangla", "English"],
    bio: "Liver, acidity and digestive health, with a focus on long-term management.",
    availability: [],
  });
}
