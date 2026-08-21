/**
 * Niramoy — AI layer
 * -----------------------------------------------------------------------------
 * Symptom triage, doctor matching and visit summarisation.
 *
 * Every function here works WITHOUT an API key, using a transparent rule-based
 * engine. If AI_API_KEY / AI_BASE_URL are set, the LLM is used and the rule
 * engine becomes the fallback when the call fails. That means the demo never
 * breaks in a viva because the network is down, and the triage logic stays
 * inspectable — which matters for a tool that touches health decisions.
 *
 * SAFETY: this is not a diagnostic tool and must never be presented as one.
 * `RED_FLAGS` short-circuits straight to emergency advice before any model is
 * consulted, and no code path can downgrade an emergency result.
 */

import { SPECIALTIES } from "./data/specialties.js";

export const URGENCY = {
  EMERGENCY: "emergency",
  URGENT: "urgent",
  SOON: "see_doctor_soon",
  ROUTINE: "routine",
  SELF_CARE: "self_care",
};

export const URGENCY_LABEL = {
  [URGENCY.EMERGENCY]: "Emergency — seek care now",
  [URGENCY.URGENT]: "Urgent — see a doctor today",
  [URGENCY.SOON]: "See a doctor soon",
  [URGENCY.ROUTINE]: "Routine — book when convenient",
  [URGENCY.SELF_CARE]: "Self-care may be enough",
};

/**
 * Symptoms that mean "stop, go to hospital". Checked before anything else and
 * never overridden by the model.
 */
const RED_FLAGS = [
  { pattern: /\b(chest pain|chest tightness|crushing chest|buke betha)\b/i, why: "Chest pain can indicate a heart attack." },
  { pattern: /\b(can'?t breathe|cannot breathe|severe breathlessness|gasping|shortness of breath at rest)\b/i, why: "Severe breathing difficulty needs emergency assessment." },
  { pattern: /\b(unconscious|fainted|unresponsive|passed out)\b/i, why: "Loss of consciousness needs immediate assessment." },
  { pattern: /\b(stroke|face droop|slurred speech|one side weakness|sudden weakness)\b/i, why: "These are stroke warning signs — treatment is time-critical." },
  { pattern: /\b(severe bleeding|bleeding heavily|vomiting blood|blood in vomit)\b/i, why: "Heavy bleeding needs emergency care." },
  { pattern: /\b(suicide|kill myself|end my life|self harm)\b/i, why: "You deserve immediate support from a person, not an app." },
  { pattern: /\b(seizure|convulsion|fitting)\b/i, why: "An active or first seizure needs urgent assessment." },
  { pattern: /\b(severe abdominal pain|rigid abdomen)\b/i, why: "Severe abdominal pain can indicate a surgical emergency." },
  { pattern: /\b(high fever.*(baby|newborn|infant)|newborn fever)\b/i, why: "Fever in a very young infant is an emergency." },
];

/** Symptom → specialty keyword map. Ordered; first strong match wins. */
const SPECIALTY_HINTS = [
  { id: "cardiology", terms: ["heart", "palpitation", "blood pressure", "hypertension", "cholesterol", "chest"] },
  { id: "pulmonology", terms: ["asthma", "cough", "breathless", "wheeze", "chest infection", "tuberculosis", "tb"] },
  { id: "gastroenterology", terms: ["stomach", "acidity", "gastric", "liver", "jaundice", "diarrhea", "diarrhoea", "constipation", "ulcer", "nausea", "vomit"] },
  { id: "neurology", terms: ["headache", "migraine", "dizzy", "numbness", "tingling", "tremor", "memory", "seizure"] },
  { id: "psychiatry", terms: ["anxiety", "depress", "panic", "stress", "insomnia", "sleep", "mood", "worried all the time"] },
  { id: "dermatology", terms: ["skin", "rash", "acne", "eczema", "itch", "hair fall", "pimple", "allergy"] },
  { id: "orthopedics", terms: ["bone", "joint", "knee", "back pain", "fracture", "shoulder", "sprain", "arthritis"] },
  { id: "ent", terms: ["ear", "throat", "sinus", "tonsil", "hearing", "nose", "sore throat"] },
  { id: "ophthalmology", terms: ["eye", "vision", "blurry", "cataract", "red eye"] },
  { id: "gynecology", terms: ["pregnan", "period", "menstrual", "uterus", "ovary", "vaginal"] },
  { id: "pediatrics", terms: ["my child", "my son", "my daughter", "baby", "infant", "toddler", "newborn", "year old boy", "year old girl"] },
  { id: "endocrinology", terms: ["diabetes", "sugar", "thyroid", "weight gain", "weight loss", "hormone"] },
  { id: "urology", terms: ["urine", "urinary", "kidney", "stone", "bladder", "burning when passing"] },
  { id: "dentistry", terms: ["tooth", "teeth", "gum", "dental", "toothache"] },
  { id: "physical-medicine", terms: ["physiotherapy", "rehab", "chronic pain", "posture"] },
  { id: "medicine", terms: ["fever", "weakness", "fatigue", "tired", "body ache", "infection"] },
];

const URGENCY_HINTS = [
  { level: URGENCY.URGENT, terms: ["severe", "unbearable", "getting worse fast", "very high fever", "can't stand", "cannot walk", "blood"] },
  { level: URGENCY.SOON, terms: ["for weeks", "for a month", "recurring", "not improving", "keeps coming back", "every day"] },
  { level: URGENCY.SELF_CARE, terms: ["mild", "slight", "a little", "since yesterday", "minor"] },
];

function scan(text, terms) {
  const t = text.toLowerCase();
  return terms.filter((term) => t.includes(term));
}

/**
 * Rule-based triage. Deterministic and inspectable.
 * @returns {{urgency, urgencyLabel, specialty, specialtyId, reasoning, matchedTerms, redFlag, disclaimer, source}}
 */
export function triageRuleBased(text) {
  const input = String(text ?? "").trim();
  const base = {
    disclaimer:
      "Niramoy AI offers general guidance, not a diagnosis. If you feel this is an emergency, call 999.",
    source: "rules",
  };

  if (!input) {
    return { ...base, urgency: URGENCY.ROUTINE, urgencyLabel: URGENCY_LABEL[URGENCY.ROUTINE], specialty: "General Physician", specialtyId: "general", reasoning: "No symptoms described yet.", matchedTerms: [], redFlag: null };
  }

  // 1. Red flags first — nothing downstream can override this.
  const flag = RED_FLAGS.find((f) => f.pattern.test(input));
  if (flag) {
    return {
      ...base,
      urgency: URGENCY.EMERGENCY,
      urgencyLabel: URGENCY_LABEL[URGENCY.EMERGENCY],
      specialty: "Emergency care",
      specialtyId: "general",
      reasoning: `${flag.why} Please call 999 or go to your nearest emergency department now — do not wait for an online consultation.`,
      matchedTerms: [],
      redFlag: flag.why,
    };
  }

  // 2. Specialty routing.
  let best = { id: "general", hits: [] };
  for (const hint of SPECIALTY_HINTS) {
    const hits = scan(input, hint.terms);
    if (hits.length > best.hits.length) best = { id: hint.id, hits };
  }

  // Is this about a child? Treated as context rather than as a competing
  // specialty: a child with a rash may still be best seen by a dermatologist,
  // but a child with a vague complaint should go to a paediatrician.
  const childHint = SPECIALTY_HINTS.find((h) => h.id === "pediatrics");
  const childHits = scan(input, childHint.terms);
  const isChild = childHits.length > 0;
  if (isChild && ["general", "medicine"].includes(best.id)) {
    best = { id: "pediatrics", hits: childHits };
  }

  const specialty = SPECIALTIES.find((s) => s.id === best.id) ?? SPECIALTIES[0];

  // 3. Urgency.
  let urgency = URGENCY.SOON;
  let urgencyHits = [];
  for (const hint of URGENCY_HINTS) {
    const hits = scan(input, hint.terms);
    if (hits.length) {
      urgency = hint.level;
      urgencyHits = hits;
      break;
    }
  }
  if (best.hits.length === 0 && urgencyHits.length === 0) urgency = URGENCY.ROUTINE;

  const reasoning = best.hits.length
    ? `Your description mentions ${best.hits.slice(0, 3).map((h) => `"${h}"`).join(", ")}, which usually points to ${specialty.name.toLowerCase()}.`
    : `There isn't a clear specialty signal in what you described, so a General Physician is the safest starting point — they can refer you onward.`;

  return {
    ...base,
    urgency,
    urgencyLabel: URGENCY_LABEL[urgency],
    specialty: specialty.name,
    specialtyId: specialty.id,
    reasoning: isChild && specialty.id !== "pediatrics"
      ? `${reasoning} Since this is about a child, a Paediatrician is also a reasonable first stop.`
      : reasoning,
    matchedTerms: [...best.hits, ...urgencyHits],
    isChild,
    redFlag: null,
  };
}

/**
 * Triage with the LLM when configured, falling back to rules.
 * Red-flag detection always runs first, regardless of provider.
 */
export async function triage(text) {
  const rules = triageRuleBased(text);
  if (rules.redFlag) return rules; // never hand an emergency to a model

  const key = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_BASE_URL;
  if (!key || !baseUrl) return rules;

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.AI_MODEL ?? "gpt-4o-mini",
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are a triage assistant for a Bangladeshi telemedicine platform. You do NOT diagnose. " +
              `Reply with JSON: {"urgency": one of ${Object.values(URGENCY).join("|")}, ` +
              `"specialty": one of ${SPECIALTIES.map((s) => s.name).join("|")}, "reasoning": string}. ` +
              "Be conservative: when in doubt, escalate urgency rather than reassure.",
          },
          { role: "user", content: String(text) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const body = await res.json();
    const parsed = JSON.parse(body.choices[0].message.content);

    const specialty = SPECIALTIES.find((s) => s.name === parsed.specialty);
    const urgency = Object.values(URGENCY).includes(parsed.urgency) ? parsed.urgency : rules.urgency;

    return {
      ...rules,
      urgency,
      urgencyLabel: URGENCY_LABEL[urgency],
      specialty: specialty?.name ?? rules.specialty,
      specialtyId: specialty?.id ?? rules.specialtyId,
      reasoning: parsed.reasoning ?? rules.reasoning,
      source: "llm",
    };
  } catch {
    return rules; // fail safe, not open
  }
}

/**
 * Rank doctors for a triage result. Pure scoring so the "why" is explainable.
 * @param {object} triageResult
 * @param {object[]} doctors
 * @param {{district?: string, division?: string, maxFee?: number}} preferences
 */
export function matchDoctors(triageResult, doctors, preferences = {}) {
  const scored = doctors.map((d) => {
    let score = 0;
    const why = [];

    if (d.specialtyId === triageResult.specialtyId) {
      score += 50;
      why.push(`Specialises in ${d.specialty}`);
    } else if (triageResult.isChild && d.specialtyId === "pediatrics") {
      score += 34;
      why.push("Paediatrician — sees children");
    } else if (d.specialtyId === "general") {
      score += 18;
      why.push("General Physician — can assess and refer");
    }

    if (preferences.district && d.district === preferences.district) {
      score += 14;
      why.push(`Practises in ${d.district}`);
    } else if (preferences.division && d.division === preferences.division) {
      score += 7;
      why.push(`Practises in ${d.division} division`);
    }

    score += Math.min(d.rating, 5) * 4;
    if (d.ratingCount > 60) score += 4;
    if (d.experienceYears >= 10) {
      score += 5;
      why.push(`${d.experienceYears} years of experience`);
    }

    if (preferences.maxFee && d.fee <= Number(preferences.maxFee)) {
      score += 8;
      why.push(`Within your ৳${preferences.maxFee} budget`);
    } else if (preferences.maxFee) {
      score -= 12;
    }

    // Urgent cases favour whoever can be seen soonest.
    if ([URGENCY.URGENT, URGENCY.SOON].includes(triageResult.urgency)) {
      if (d.nextAvailableHint === "Today") { score += 10; why.push("Available today"); }
      else if (d.nextAvailableHint === "Tomorrow") { score += 5; why.push("Available tomorrow"); }
    }

    return { doctor: d, score, why: why.slice(0, 3) };
  });

  return scored.sort((a, b) => b.score - a.score).slice(0, 6);
}

/**
 * Draft a structured visit summary. The doctor must review and confirm before
 * it is saved — the API marks the output `requiresReview: true`.
 */
export async function summariseVisit({ transcript, patientName, doctorName, specialty }) {
  const key = process.env.AI_API_KEY;
  const baseUrl = process.env.AI_BASE_URL;

  const fallback = {
    summary:
      `Consultation between ${patientName ?? "the patient"} and ${doctorName ?? "the doctor"}` +
      `${specialty ? ` (${specialty})` : ""}. ` +
      (transcript
        ? `Discussed: ${String(transcript).slice(0, 400)}${String(transcript).length > 400 ? "…" : ""}`
        : "No consultation notes were captured."),
    diagnosis: "",
    advice: "",
    followUp: "",
    requiresReview: true,
    source: "rules",
  };

  if (!key || !baseUrl || !transcript) return fallback;

  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.AI_MODEL ?? "gpt-4o-mini",
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Summarise a telemedicine consultation for the doctor to review. Reply with JSON: " +
              '{"summary": string, "diagnosis": string, "advice": string, "followUp": string}. ' +
              "Only state what the notes support. Never invent findings, doses or diagnoses.",
          },
          { role: "user", content: String(transcript) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const parsed = JSON.parse((await res.json()).choices[0].message.content);
    return { ...parsed, requiresReview: true, source: "llm" };
  } catch {
    return fallback;
  }
}

/** Canned answers for the general health-assistant chat. */
export function assistantReply(message, triageResult) {
  if (triageResult?.redFlag) {
    return `${triageResult.reasoning}\n\nI'm not able to help with something this urgent through a booking app.`;
  }
  return (
    `Thanks for telling me. ${triageResult.reasoning} ` +
    `I've marked this as "${triageResult.urgencyLabel.toLowerCase()}" and pulled up matching doctors below. ` +
    `Remember I can't diagnose — a doctor still needs to confirm this.`
  );
}
