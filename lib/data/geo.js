/**
 * Niramoy — Bangladesh administrative geography (reference data)
 * -----------------------------------------------------------------------------
 * The 8 divisions and 64 districts of Bangladesh. This is factual public
 * reference data and is what powers the "search by location" filters.
 *
 * Upazila samples for the Rajshahi division come from the DGHS "Doctor
 * Directory" open dataset (see db/reference/dghs-doctor-directory.json).
 */

export const DIVISIONS = [
  {
    id: "barishal",
    name: "Barishal",
    bn: "বরিশাল",
    districts: ["Barguna", "Barishal", "Bhola", "Jhalokati", "Patuakhali", "Pirojpur"],
  },
  {
    id: "chattogram",
    name: "Chattogram",
    bn: "চট্টগ্রাম",
    districts: [
      "Bandarban", "Brahmanbaria", "Chandpur", "Chattogram", "Cumilla",
      "Cox's Bazar", "Feni", "Khagrachhari", "Lakshmipur", "Noakhali", "Rangamati",
    ],
  },
  {
    id: "dhaka",
    name: "Dhaka",
    bn: "ঢাকা",
    districts: [
      "Dhaka", "Faridpur", "Gazipur", "Gopalganj", "Kishoreganj", "Madaripur",
      "Manikganj", "Munshiganj", "Narayanganj", "Narsingdi", "Rajbari",
      "Shariatpur", "Tangail",
    ],
  },
  {
    id: "khulna",
    name: "Khulna",
    bn: "খুলনা",
    districts: [
      "Bagerhat", "Chuadanga", "Jashore", "Jhenaidah", "Khulna", "Kushtia",
      "Magura", "Meherpur", "Narail", "Satkhira",
    ],
  },
  {
    id: "mymensingh",
    name: "Mymensingh",
    bn: "ময়মনসিংহ",
    districts: ["Jamalpur", "Mymensingh", "Netrokona", "Sherpur"],
  },
  {
    id: "rajshahi",
    name: "Rajshahi",
    bn: "রাজশাহী",
    districts: [
      "Bogura", "Chapai Nawabganj", "Joypurhat", "Naogaon", "Natore",
      "Pabna", "Rajshahi", "Sirajganj",
    ],
  },
  {
    id: "rangpur",
    name: "Rangpur",
    bn: "রংপুর",
    districts: [
      "Dinajpur", "Gaibandha", "Kurigram", "Lalmonirhat", "Nilphamari",
      "Panchagarh", "Rangpur", "Thakurgaon",
    ],
  },
  {
    id: "sylhet",
    name: "Sylhet",
    bn: "সিলেট",
    districts: ["Habiganj", "Moulvibazar", "Sunamganj", "Sylhet"],
  },
];

/** Flat list of all 64 districts, each tagged with its division. */
export const DISTRICTS = DIVISIONS.flatMap((d) =>
  d.districts.map((name) => ({ name, division: d.name, divisionId: d.id }))
);

export const DIVISION_NAMES = DIVISIONS.map((d) => d.name);

export function districtsOf(divisionName) {
  if (!divisionName || divisionName === "All divisions") {
    return DISTRICTS.map((d) => d.name);
  }
  return DIVISIONS.find((d) => d.name === divisionName)?.districts ?? [];
}
