/**
 * Niramoy — Specialty taxonomy
 * -----------------------------------------------------------------------------
 * Patient-facing specialties. The `dghs` field maps each entry back to the
 * specialty label used in the DGHS "Doctor Directory" open dataset, so a real
 * DGHS/BMDC import can be normalised onto this taxonomy later.
 * See db/reference/dghs-doctor-directory.json for the raw 43 source labels.
 */

export const SPECIALTIES = [
  { id: "general", name: "General Physician", bn: "সাধারণ চিকিৎসক", icon: "heart", dghs: ["Medical Officer", "Medicine", "Medical", "OPD", "Indoor"], blurb: "First stop for fever, infection, pain and everyday illness." },
  { id: "medicine", name: "Internal Medicine", bn: "মেডিসিন", icon: "file", dghs: ["Medicine"], blurb: "Complex or long-running adult conditions and diagnosis." },
  { id: "cardiology", name: "Cardiology", bn: "হৃদরোগ", icon: "heart", dghs: ["Cardiology"], blurb: "Heart, blood pressure, cholesterol and chest symptoms." },
  { id: "pediatrics", name: "Pediatrics", bn: "শিশু", icon: "users", dghs: ["Pediatrics", "Pediatric Surgery", "Neonatalogy"], blurb: "Newborns, children and teenagers." },
  { id: "gynecology", name: "Gynecology & Obstetrics", bn: "স্ত্রীরোগ", icon: "users", dghs: ["Obstetrics & Gynecology", "Gynecological Oncology"], blurb: "Pregnancy, menstrual and women's reproductive health." },
  { id: "dermatology", name: "Dermatology", bn: "চর্মরোগ", icon: "shield", dghs: ["Dermatology"], blurb: "Skin, hair, nails, acne, eczema and allergy." },
  { id: "psychiatry", name: "Psychiatry & Mental Health", bn: "মানসিক স্বাস্থ্য", icon: "bot", dghs: ["Psychiatry"], blurb: "Anxiety, depression, sleep and emotional wellbeing." },
  { id: "neurology", name: "Neurology", bn: "স্নায়ুরোগ", icon: "bot", dghs: ["Neuro Medicine", "Neuro Surgery"], blurb: "Migraine, seizures, nerve pain and movement problems." },
  { id: "orthopedics", name: "Orthopedics", bn: "অর্থোপেডিক্স", icon: "shield", dghs: ["Orthopedic Surgery"], blurb: "Bones, joints, fractures, back and sports injury." },
  { id: "ent", name: "ENT (Ear, Nose & Throat)", bn: "নাক-কান-গলা", icon: "bell", dghs: ["Otolaryngology"], blurb: "Hearing, sinus, tonsils, voice and balance." },
  { id: "ophthalmology", name: "Ophthalmology", bn: "চক্ষু", icon: "search", dghs: ["Ophthalmology"], blurb: "Vision, eye pain, cataract and screening." },
  { id: "surgery", name: "General Surgery", bn: "সার্জারি", icon: "file", dghs: ["Surgery", "General Surgery"], blurb: "Surgical opinion, hernia, gallbladder and appendix." },
  { id: "urology", name: "Urology", bn: "ইউরোলজি", icon: "file", dghs: ["Urology", "Nephrology"], blurb: "Kidney, bladder, stones and urinary symptoms." },
  { id: "dentistry", name: "Dentistry", bn: "দন্ত", icon: "shield", dghs: ["Dentistry", "DGHS-Dental", "Prostho Surgery"], blurb: "Toothache, gums, cavities and oral health." },
  { id: "endocrinology", name: "Endocrinology & Diabetes", bn: "ডায়াবেটিস", icon: "clock", dghs: ["Endocrinology"], blurb: "Diabetes, thyroid and hormone conditions." },
  { id: "gastroenterology", name: "Gastroenterology", bn: "গ্যাস্ট্রোলিভার", icon: "file", dghs: ["Gastroenterology"], blurb: "Stomach, liver, acidity and digestive problems." },
  { id: "pulmonology", name: "Pulmonology", bn: "বক্ষব্যাধি", icon: "heart", dghs: ["Respiratory Medicine"], blurb: "Asthma, cough, breathlessness and chest infection." },
  { id: "physical-medicine", name: "Physical Medicine & Rehab", bn: "ফিজিক্যাল মেডিসিন", icon: "users", dghs: ["Physical Medicine", "Physical Medicine & Rehabilitaion"], blurb: "Chronic pain, physiotherapy and recovery after injury." },
];

export const SPECIALTY_NAMES = SPECIALTIES.map((s) => s.name);

export function specialtyByName(name) {
  return SPECIALTIES.find((s) => s.name === name);
}

export function specialtyById(id) {
  return SPECIALTIES.find((s) => s.id === id);
}

/** Normalise a raw DGHS/BMDC specialty label onto the Niramoy taxonomy. */
export function normaliseSpecialty(raw) {
  if (!raw) return null;
  const needle = String(raw).trim().toLowerCase();
  const hit = SPECIALTIES.find(
    (s) =>
      s.name.toLowerCase() === needle ||
      s.dghs.some((d) => d.toLowerCase() === needle)
  );
  return hit ? hit.name : null;
}
