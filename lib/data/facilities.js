/**
 * Niramoy — Health facility reference data
 * -----------------------------------------------------------------------------
 * Real, publicly-known government medical colleges, district hospitals and
 * upazila health complexes across all 8 divisions. Institution names are public
 * facts; the four Rajshahi entries marked `dghs: true` appear verbatim in the
 * DGHS "Doctor Directory" open dataset.
 *
 * NOTE: listing a facility here does NOT imply that facility is affiliated with
 * Niramoy. It is a location vocabulary for doctor profiles and search filters.
 */

export const FACILITIES = [
  // --- Dhaka -----------------------------------------------------------------
  { id: "dmch", name: "Dhaka Medical College Hospital", district: "Dhaka", division: "Dhaka", type: "Medical College Hospital" },
  { id: "bsmmu", name: "Bangabandhu Sheikh Mujib Medical University", district: "Dhaka", division: "Dhaka", type: "Postgraduate Hospital" },
  { id: "shsmc", name: "Shaheed Suhrawardy Medical College Hospital", district: "Dhaka", division: "Dhaka", type: "Medical College Hospital" },
  { id: "nicvd", name: "National Institute of Cardiovascular Diseases", district: "Dhaka", division: "Dhaka", type: "Specialised Institute" },
  { id: "nitor", name: "National Institute of Traumatology & Orthopaedic Rehabilitation", district: "Dhaka", division: "Dhaka", type: "Specialised Institute" },
  { id: "mmch-gazipur", name: "Shaheed Tajuddin Ahmad Medical College Hospital", district: "Gazipur", division: "Dhaka", type: "Medical College Hospital" },
  { id: "tangail-gh", name: "Tangail General Hospital", district: "Tangail", division: "Dhaka", type: "District Hospital" },
  { id: "faridpur-mch", name: "Faridpur Medical College Hospital", district: "Faridpur", division: "Dhaka", type: "Medical College Hospital" },
  { id: "narayanganj-gh", name: "Narayanganj General Hospital (Victoria)", district: "Narayanganj", division: "Dhaka", type: "District Hospital" },
  { id: "kishoreganj-gh", name: "Shaheed Syed Nazrul Islam Medical College Hospital", district: "Kishoreganj", division: "Dhaka", type: "Medical College Hospital" },

  // --- Chattogram ------------------------------------------------------------
  { id: "cmch", name: "Chittagong Medical College Hospital", district: "Chattogram", division: "Chattogram", type: "Medical College Hospital" },
  { id: "ctg-gh", name: "Chattogram General Hospital", district: "Chattogram", division: "Chattogram", type: "District Hospital" },
  { id: "coxsbazar-sh", name: "Cox's Bazar Sadar Hospital", district: "Cox's Bazar", division: "Chattogram", type: "District Hospital" },
  { id: "cumilla-mch", name: "Cumilla Medical College Hospital", district: "Cumilla", division: "Chattogram", type: "Medical College Hospital" },
  { id: "noakhali-mch", name: "Abdul Malek Ukil Medical College Hospital", district: "Noakhali", division: "Chattogram", type: "Medical College Hospital" },
  { id: "feni-gh", name: "Feni General Hospital", district: "Feni", division: "Chattogram", type: "District Hospital" },
  { id: "rangamati-gh", name: "Rangamati General Hospital", district: "Rangamati", division: "Chattogram", type: "District Hospital" },
  { id: "brahmanbaria-gh", name: "Brahmanbaria Sadar Hospital", district: "Brahmanbaria", division: "Chattogram", type: "District Hospital" },

  // --- Rajshahi (entries marked dghs appear in the DGHS open dataset) ---------
  { id: "rmch", name: "Rajshahi Medical College Hospital", district: "Rajshahi", division: "Rajshahi", type: "Medical College Hospital", dghs: true },
  { id: "cnj-dh", name: "Chapai Nababganj District Hospital", district: "Chapai Nawabganj", division: "Rajshahi", type: "District Hospital", dghs: true },
  { id: "mohadevpur-uhc", name: "Mohadevpur Upazila Health Complex", district: "Naogaon", division: "Rajshahi", type: "Upazila Health Complex", dghs: true },
  { id: "chatmohar-uhc", name: "Chatmohar Upazila Health Complex", district: "Pabna", division: "Rajshahi", type: "Upazila Health Complex", dghs: true },
  { id: "bogura-shmc", name: "Shaheed Ziaur Rahman Medical College Hospital", district: "Bogura", division: "Rajshahi", type: "Medical College Hospital" },
  { id: "pabna-mch", name: "Pabna Medical College Hospital", district: "Pabna", division: "Rajshahi", type: "Medical College Hospital" },
  { id: "sirajganj-gh", name: "Sirajganj Sadar Hospital", district: "Sirajganj", division: "Rajshahi", type: "District Hospital" },
  { id: "natore-sh", name: "Natore Sadar Hospital", district: "Natore", division: "Rajshahi", type: "District Hospital" },
  { id: "joypurhat-gh", name: "Joypurhat General Hospital", district: "Joypurhat", division: "Rajshahi", type: "District Hospital" },

  // --- Khulna ----------------------------------------------------------------
  { id: "kmch", name: "Khulna Medical College Hospital", district: "Khulna", division: "Khulna", type: "Medical College Hospital" },
  { id: "jashore-gh", name: "Jashore General Hospital", district: "Jashore", division: "Khulna", type: "District Hospital" },
  { id: "kushtia-gh", name: "Kushtia General Hospital", district: "Kushtia", division: "Khulna", type: "District Hospital" },
  { id: "satkhira-mch", name: "Satkhira Medical College Hospital", district: "Satkhira", division: "Khulna", type: "Medical College Hospital" },
  { id: "bagerhat-sh", name: "Bagerhat Sadar Hospital", district: "Bagerhat", division: "Khulna", type: "District Hospital" },
  { id: "jhenaidah-sh", name: "Jhenaidah Sadar Hospital", district: "Jhenaidah", division: "Khulna", type: "District Hospital" },

  // --- Sylhet ----------------------------------------------------------------
  { id: "sylhet-mag", name: "Sylhet MAG Osmani Medical College Hospital", district: "Sylhet", division: "Sylhet", type: "Medical College Hospital" },
  { id: "moulvibazar-sh", name: "Moulvibazar Sadar Hospital", district: "Moulvibazar", division: "Sylhet", type: "District Hospital" },
  { id: "habiganj-sh", name: "Habiganj Sadar Hospital", district: "Habiganj", division: "Sylhet", type: "District Hospital" },
  { id: "sunamganj-sh", name: "Sunamganj Sadar Hospital", district: "Sunamganj", division: "Sylhet", type: "District Hospital" },

  // --- Rangpur ---------------------------------------------------------------
  { id: "rpmch", name: "Rangpur Medical College Hospital", district: "Rangpur", division: "Rangpur", type: "Medical College Hospital" },
  { id: "dinajpur-mch", name: "M Abdur Rahim Medical College Hospital", district: "Dinajpur", division: "Rangpur", type: "Medical College Hospital" },
  { id: "nilphamari-sh", name: "Nilphamari Sadar Hospital", district: "Nilphamari", division: "Rangpur", type: "District Hospital" },
  { id: "kurigram-sh", name: "Kurigram Sadar Hospital", district: "Kurigram", division: "Rangpur", type: "District Hospital" },
  { id: "thakurgaon-sh", name: "Thakurgaon Sadar Hospital", district: "Thakurgaon", division: "Rangpur", type: "District Hospital" },
  { id: "gaibandha-sh", name: "Gaibandha Sadar Hospital", district: "Gaibandha", division: "Rangpur", type: "District Hospital" },

  // --- Barishal --------------------------------------------------------------
  { id: "sbmch", name: "Sher-e-Bangla Medical College Hospital", district: "Barishal", division: "Barishal", type: "Medical College Hospital" },
  { id: "patuakhali-mch", name: "Patuakhali Medical College Hospital", district: "Patuakhali", division: "Barishal", type: "Medical College Hospital" },
  { id: "bhola-sh", name: "Bhola Sadar Hospital", district: "Bhola", division: "Barishal", type: "District Hospital" },
  { id: "pirojpur-sh", name: "Pirojpur Sadar Hospital", district: "Pirojpur", division: "Barishal", type: "District Hospital" },
  { id: "barguna-sh", name: "Barguna Sadar Hospital", district: "Barguna", division: "Barishal", type: "District Hospital" },

  // --- Mymensingh ------------------------------------------------------------
  { id: "mmch", name: "Mymensingh Medical College Hospital", district: "Mymensingh", division: "Mymensingh", type: "Medical College Hospital" },
  { id: "jamalpur-gh", name: "Jamalpur General Hospital", district: "Jamalpur", division: "Mymensingh", type: "District Hospital" },
  { id: "netrokona-sh", name: "Netrokona Sadar Hospital", district: "Netrokona", division: "Mymensingh", type: "District Hospital" },
  { id: "sherpur-sh", name: "Sherpur Sadar Hospital", district: "Sherpur", division: "Mymensingh", type: "District Hospital" },
];

export function facilitiesIn(district) {
  return FACILITIES.filter((f) => f.district === district);
}

export function facilityById(id) {
  return FACILITIES.find((f) => f.id === id);
}
