/**
 * Niramoy — deterministic triage rules
 * -----------------------------------------------------------------------------
 * ⚠  THIS RULE SET IS NOT MEDICALLY COMPLETE, AND IS NOT CLAIMED TO BE.
 *
 * It is a versioned engineering artefact covering the conditions the brief
 * enumerates. It has NOT been reviewed by a clinician. Before any real patient
 * depends on it, it must be — and that is a separate requirement from legal
 * review, which does not substitute for it. See docs/REGULATORY_ASSUMPTIONS.md
 * A9.
 *
 * Why rules run first, and alone, for emergencies:
 *
 *   A language model is a probabilistic system whose failure mode is a
 *   confident wrong answer. For "is this chest pain a heart attack?", the cost
 *   of a false negative is not a bad user experience. So the emergency path
 *   never involves a model: patterns match, emergency advice is returned, and
 *   the patient's text is never transmitted anywhere.
 *
 * Every rule carries a stable id. The id is what gets logged — never the text
 * that matched it, which is the patient's description of their symptoms.
 */

export const RULE_SET_VERSION = "2026-08-27.1";

export type Urgency = "emergency" | "urgent" | "see_doctor_soon" | "routine" | "self_care";

/** Ordered most severe first. The engine can only ever move UP this list. */
export const URGENCY_RANK: Record<Urgency, number> = {
  emergency: 1,
  urgent: 2,
  see_doctor_soon: 3,
  routine: 4,
  self_care: 5,
};

export const URGENCY_LABEL: Record<Urgency, string> = {
  emergency: "Emergency — seek care now",
  urgent: "Urgent — see a doctor today",
  see_doctor_soon: "See a doctor soon",
  routine: "Routine — book when convenient",
  self_care: "Self-care may be enough",
};

/** True when `a` is at least as severe as `b`. */
export const atLeastAsSevere = (a: Urgency, b: Urgency): boolean =>
  URGENCY_RANK[a] <= URGENCY_RANK[b];

/** The more severe of two urgencies. */
export const moreSevere = (a: Urgency, b: Urgency): Urgency =>
  URGENCY_RANK[a] <= URGENCY_RANK[b] ? a : b;

export interface RedFlagRule {
  /** Stable identifier. This is what is logged, never the matching text. */
  id: string;
  /** English, Banglish and Bangla surface forms. */
  patterns: RegExp[];
  /** Shown to the patient. Plain, actionable, no hedging. */
  why: string;
}

/**
 * Emergency patterns.
 *
 * Note the absence of `\b` word boundaries. The prototype used them throughout,
 * which is why its Bangla support was decorative: `\b` is defined by ASCII word
 * characters and does not match a boundary anywhere in Bangla script, so no
 * Bangla pattern could ever fire. Substring matching is used instead, which is
 * blunter but actually works. Over-triage here is the acceptable direction.
 */
export const RED_FLAGS: RedFlagRule[] = [
  {
    id: "rf.chest_pain",
    patterns: [
      /chest pain|chest tightness|crushing chest|pressure in (my )?chest|pain in (my )?chest/i,
      /buke betha|buke bytha|buk e betha|chest e betha|buker betha/i,
      /বুকে ব্যথা|বুকে চাপ|বুক ব্যথা|বুকে যন্ত্রণা/,
    ],
    why: "Chest pain can be a sign of a heart attack.",
  },
  {
    id: "rf.breathing",
    patterns: [
      /can'?t breathe|cannot breathe|unable to breathe|severe breathlessness|gasping|struggling to breathe|shortness of breath at rest|breath.{0,12}(difficult|impossible)|can'?t catch (my |his |her )?breath/i,
      /nishwash nite parchi na|dom bondho|shash nite kosto|niswas nite parchina/i,
      /শ্বাস নিতে পারছি না|শ্বাসকষ্ট|দম বন্ধ|নিঃশ্বাস নিতে কষ্ট/,
    ],
    why: "Severe difficulty breathing needs emergency assessment.",
  },
  {
    id: "rf.unconscious",
    patterns: [
      /unconscious|unresponsive|passed out|fainted|blacked out|won'?t wake up|not waking up/i,
      /gyan harano|osshan|jnan hariye|behush/i,
      /অজ্ঞান|জ্ঞান হারিয়ে|বেহুশ|সাড়া দিচ্ছে না/,
    ],
    why: "Loss of consciousness needs immediate assessment.",
  },
  {
    id: "rf.stroke",
    patterns: [
      /stroke|(face|mouth|facial).{0,12}droop|droop.{0,12}(face|mouth)|slurred speech|speech.{0,12}slurr|slurring|one side.{0,15}weak|sudden weakness|can'?t move (my )?(arm|leg|side)|numbness on one side/i,
      /mukh beke|kotha jorano|ek pash|ek dike durbol|strok/i,
      /স্ট্রোক|মুখ বেঁকে|কথা জড়িয়ে|এক পাশ অবশ|এক দিকে দুর্বল/,
    ],
    why: "These are stroke warning signs, and treatment is time-critical.",
  },
  {
    id: "rf.bleeding",
    patterns: [
      /severe bleeding|bleeding heavily|bleeding a lot|won'?t stop bleeding|bleeding.{0,15}(won'?t|not) stop|vomiting blood|blood in (the )?vomit|coughing up blood|heavy blood loss/i,
      /onek rokto|rokto bondho hocche na|rokto boma|rokto porche/i,
      /প্রচুর রক্ত|রক্ত বন্ধ হচ্ছে না|রক্ত বমি|রক্তক্ষরণ/,
    ],
    why: "Heavy bleeding needs emergency care.",
  },
  {
    id: "rf.self_harm",
    patterns: [
      /suicide|suicidal|kill myself|end my life|end it all|take my own life|self harm|self-harm|hurt myself|don'?t want to live|want to die/i,
      /atmahotya|nijeke shesh|mora jaite chai|bachte chai na/i,
      /আত্মহত্যা|নিজেকে শেষ|মরে যেতে চাই|বাঁচতে চাই না/,
    ],
    why: "You deserve immediate support from a person, not an app.",
  },
  {
    id: "rf.seizure",
    patterns: [
      /seizure|convulsion|convulsing|fitting|having a fit|shaking uncontrollably/i,
      /khiche|khichuni|mrigi/i,
      /খিঁচুনি|খেঁচুনি|মৃগী/,
    ],
    why: "An active or first seizure needs urgent assessment.",
  },
  {
    id: "rf.abdominal",
    patterns: [
      /severe abdominal pain|rigid abdomen|severe stomach pain|unbearable stomach|abdomen is hard/i,
      /petheh prochondo betha|pet shokto|peter prochondo betha/i,
      /পেটে প্রচণ্ড ব্যথা|পেট শক্ত|তীব্র পেট ব্যথা/,
    ],
    why: "Severe abdominal pain can indicate a surgical emergency.",
  },
  {
    id: "rf.anaphylaxis",
    patterns: [
      /anaphylaxis|throat.{0,12}(clos|tight|swell)|tongue.{0,12}swell|(face|lips?).{0,12}swell|swell.{0,12}(tongue|throat|lips?)|severe allergic|can'?t swallow/i,
      /gola bondho|jibh fule|mukh fule|allergy prochondo/i,
      /গলা বন্ধ|জিভ ফুলে|মুখ ফুলে|তীব্র অ্যালার্জি/,
    ],
    why: "A severe allergic reaction can close the airway within minutes.",
  },
  {
    id: "rf.infant_fever",
    patterns: [
      /(newborn|infant|baby|neonate).{0,30}(fever|temperature)/i,
      /(fever|temperature).{0,30}(newborn|infant|baby under|month old)/i,
      /nobojatok jor|baccha jor besi/i,
      /নবজাতক.{0,20}জ্বর|শিশুর প্রচণ্ড জ্বর/,
    ],
    why: "Fever in a very young infant is an emergency.",
  },
  {
    id: "rf.obstetric",
    patterns: [
      /bleeding.{0,25}pregnan|pregnan.{0,25}bleeding|water broke|waters broke|severe.{0,15}pregnan|no fetal movement|baby (has )?stopped moving|labour pain|labor pain/i,
      /garvoboti rokto|bacha nore na|pani bhenge/i,
      /গর্ভবতী.{0,20}রক্ত|বাচ্চা নড়ছে না|পানি ভেঙে/,
    ],
    why: "Bleeding, reduced movement or waters breaking in pregnancy need urgent obstetric care.",
  },
  {
    id: "rf.poisoning",
    patterns: [
      /poison|overdose|swallowed.{0,20}(chemical|bleach|acid|pills)|took too many pills|drank acid/i,
      /bish khe|onek osudh kheye|acid kheye/i,
      /বিষ খে|অতিরিক্ত ওষুধ|অ্যাসিড খে/,
    ],
    why: "Suspected poisoning or overdose needs emergency treatment immediately.",
  },
  {
    id: "rf.head_injury",
    patterns: [
      /head injury|hit (my|his|her) head.{0,30}(vomit|unconscious|confus)|skull|severe head trauma/i,
      /mathay aghat|mathay bari/i,
      /মাথায় আঘাত|মাথায় গুরুতর/,
    ],
    why: "A head injury with vomiting, confusion or loss of consciousness is an emergency.",
  },
];

/* -------------------------------------------------------------------------- */
/* Specialty routing                                                           */
/* -------------------------------------------------------------------------- */

export interface SpecialtyHint {
  id: string;
  terms: string[];
}

/**
 * Substring terms per specialty, in English, Banglish and Bangla. Routing is
 * advisory — getting it wrong sends someone to a General Physician who refers
 * them on, which is what a GP is for.
 */
export const SPECIALTY_HINTS: SpecialtyHint[] = [
  { id: "cardiology", terms: ["heart", "palpitation", "blood pressure", "hypertension", "cholesterol", "hridroga", "উচ্চ রক্তচাপ", "হৃদ", "বুক ধড়ফড়"] },
  { id: "pulmonology", terms: ["asthma", "cough", "breathless", "wheeze", "tuberculosis", " tb ", "hapani", "kashi", "হাঁপানি", "কাশি", "যক্ষ্মা"] },
  { id: "gastroenterology", terms: ["stomach", "acidity", "gastric", "liver", "jaundice", "diarrhea", "diarrhoea", "constipation", "ulcer", "nausea", "vomit", "peter", "gastrik", "জন্ডিস", "পেট", "গ্যাস্ট্রিক", "বমি", "ডায়রিয়া"] },
  { id: "neurology", terms: ["headache", "migraine", "dizzy", "numbness", "tingling", "tremor", "memory", "mathabetha", "mathe betha", "মাথাব্যথা", "মাথা ব্যথা", "মাইগ্রেন", "ঝিমঝিম"] },
  { id: "psychiatry", terms: ["anxiety", "depress", "panic", "stress", "insomnia", "sleep", "mood", "dushchinta", "hotasha", "উদ্বেগ", "বিষণ্ণ", "ঘুম", "মানসিক"] },
  { id: "dermatology", terms: ["skin", "rash", "acne", "eczema", "itch", "hair fall", "pimple", "chulkani", "chamra", "চর্ম", "চুলকানি", "ব্রণ", "ত্বক"] },
  { id: "orthopedics", terms: ["bone", "joint", "knee", "back pain", "fracture", "shoulder", "sprain", "arthritis", "haar", "kmore betha", "হাড়", "কোমর ব্যথা", "জয়েন্ট", "হাঁটু"] },
  { id: "ent", terms: ["ear", "throat", "sinus", "tonsil", "hearing", "nose", "sore throat", "kaan", "gola betha", "কান", "গলা", "নাক", "টনসিল"] },
  { id: "ophthalmology", terms: ["eye", "vision", "blurry", "cataract", "chokh", "চোখ", "দৃষ্টি", "ছানি"] },
  { id: "gynecology", terms: ["pregnan", "period", "menstrual", "uterus", "ovary", "vaginal", "mashik", "garvo", "গর্ভ", "মাসিক", "ঋতু"] },
  { id: "pediatrics", terms: ["my child", "my son", "my daughter", "baby", "infant", "toddler", "newborn", "amar bacha", "shishu", "শিশু", "আমার বাচ্চা", "নবজাতক"] },
  { id: "endocrinology", terms: ["diabetes", "sugar", "thyroid", "weight gain", "weight loss", "hormone", "diabetis", "ডায়াবেটিস", "থাইরয়েড", "সুগার"] },
  { id: "urology", terms: ["urine", "urinary", "kidney", "stone", "bladder", "prosrab", "kidni", "প্রস্রাব", "কিডনি", "পাথর"] },
  { id: "dentistry", terms: ["tooth", "teeth", "gum", "dental", "toothache", "dat betha", "দাঁত", "মাড়ি"] },
  { id: "medicine", terms: ["fever", "weakness", "fatigue", "tired", "body ache", "infection", "jor", "durbol", "জ্বর", "দুর্বল", "শরীর ব্যথা"] },
];

/* -------------------------------------------------------------------------- */
/* Urgency modifiers                                                           */
/* -------------------------------------------------------------------------- */

export interface UrgencyHint {
  level: Urgency;
  terms: string[];
}

export const URGENCY_HINTS: UrgencyHint[] = [
  {
    level: "urgent",
    terms: ["severe", "unbearable", "getting worse fast", "very high fever", "can't stand", "cannot walk", "blood", "prochondo", "oshohyo", "প্রচণ্ড", "অসহ্য", "তীব্র", "রক্ত"],
  },
  {
    level: "see_doctor_soon",
    terms: ["for weeks", "for a month", "recurring", "not improving", "keeps coming back", "every day", "onek din", "bar bar", "অনেক দিন", "বার বার", "প্রতিদিন"],
  },
  {
    level: "self_care",
    terms: ["mild", "slight", "a little", "since yesterday", "minor", "olpo", "সামান্য", "অল্প", "হালকা"],
  },
];

/**
 * Vulnerable-group markers. These never lower urgency; they raise the floor,
 * because the same symptom carries more risk at the extremes of age and in
 * pregnancy.
 */
/* -------------------------------------------------------------------------- */
/* Structured intake                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The optional questions asked before the description, and what each answer
 * does to the urgency FLOOR.
 *
 * These duplicate signals VULNERABLE_HINTS already looks for in free text, on
 * purpose: the text rules only fire if the patient happens to write the word
 * "pregnant", and someone describing abdominal pain has no reason to think that
 * is relevant. Asking makes the signal reliable instead of incidental.
 *
 * Floors match the free-text equivalents exactly, so answering "pregnant" and
 * typing "I am pregnant" reach the same result. A floor NEVER lowers urgency —
 * moreSevere() takes whichever is worse.
 *
 * CLINICAL REVIEW OUTSTANDING. These thresholds are conservative guesses by an
 * engineer, like the rest of this rule set, and carry the same caveat recorded
 * in docs/AI_SAFETY.md: nothing here has been read by a clinician, and the
 * sensitivity of the emergency path is unmeasured. Where a value was a
 * judgement call it errs upward, because over-referral is recoverable and
 * under-referral is not.
 */
export const AGE_BANDS = ["infant", "child", "adult", "elderly"] as const;
export const DURATION_BANDS = ["hours", "days", "weeks", "months"] as const;
export const SEVERITY_BANDS = ["mild", "moderate", "severe"] as const;
export const CONDITIONS = [
  "diabetes",
  "hypertension",
  "heart_disease",
  "asthma",
  "kidney_disease",
  "immunocompromised",
] as const;

export type AgeBand = (typeof AGE_BANDS)[number];
export type DurationBand = (typeof DURATION_BANDS)[number];
export type SeverityBand = (typeof SEVERITY_BANDS)[number];

export interface Intake {
  ageBand?: AgeBand | null;
  durationBand?: DurationBand | null;
  severity?: SeverityBand | null;
  pregnant?: boolean | null;
  conditions?: string[];
  /** The language the patient asked to be answered in. Never affects urgency. */
  language?: "bn" | "en" | null;
}

/** Floors keyed by answer. Anything absent contributes nothing. */
export const INTAKE_FLOORS: Array<{
  id: string;
  applies: (intake: Intake) => boolean;
  floor: Urgency;
  reason: string;
}> = [
  {
    id: "intake.infant",
    applies: (i) => i.ageBand === "infant",
    floor: "urgent",
    reason: "Symptoms in a very young child are assessed more cautiously.",
  },
  {
    id: "intake.elderly",
    applies: (i) => i.ageBand === "elderly",
    floor: "see_doctor_soon",
    reason: "Symptoms in an older adult are assessed more cautiously.",
  },
  {
    id: "intake.pregnancy",
    applies: (i) => i.pregnant === true,
    floor: "urgent",
    reason: "Symptoms during pregnancy are assessed more cautiously.",
  },
  {
    id: "intake.severe",
    applies: (i) => i.severity === "severe",
    floor: "urgent",
    reason: "You described this as severe, so it is treated as needing prompt attention.",
  },
  {
    id: "intake.comorbidity",
    applies: (i) => Boolean(i.conditions?.length),
    floor: "see_doctor_soon",
    reason: "An existing long-term condition means new symptoms are reviewed sooner.",
  },
];

export const VULNERABLE_HINTS: Array<{ id: string; terms: string[]; floor: Urgency }> = [
  {
    id: "vul.infant",
    terms: ["newborn", "infant", "baby", "months old", "nobojatok", "নবজাতক", "শিশু"],
    floor: "urgent",
  },
  {
    id: "vul.pregnancy",
    terms: ["pregnant", "pregnancy", "expecting", "garvoboti", "গর্ভবতী", "গর্ভাবস্থা"],
    floor: "urgent",
  },
  {
    id: "vul.elderly",
    terms: ["elderly", "my father is 7", "my mother is 7", "80 year", "90 year", "bridho", "বৃদ্ধ", "বয়স্ক"],
    floor: "see_doctor_soon",
  },
];
