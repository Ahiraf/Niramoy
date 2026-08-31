"use client";

/**
 * Bangla / English.
 *
 * Scope, stated honestly: this covers the surfaces where being unable to read
 * English changes what happens to you — navigation, the booking flow,
 * emergency warnings, payment instructions, and how a prescription is
 * explained. It is not a full translation of the application, and the language
 * switch does not pretend otherwise.
 *
 * Two rules the Bangla copy follows:
 *
 *   1. Emergency strings are short, literal, and use the number, not a word
 *      for the number. Someone reading them is frightened and skimming.
 *   2. No transliterated English where a normal Bangla word exists — but
 *      "bKash" stays "bKash", because that is what is written on the app the
 *      patient is about to open.
 *
 * THE BANGLA NEEDS A NATIVE REVIEW before this is shown to patients. It was
 * written by the same person who wrote the English, and medical phrasing is
 * exactly where a confident non-native translation goes wrong.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const LANG_KEY = "niramoy:language";

export const LANGUAGES = [
  { id: "en", label: "English", short: "EN" },
  { id: "bn", label: "বাংলা", short: "বাং" },
];

const STRINGS = {
  /* ---- Navigation ------------------------------------------------------- */
  "nav.dashboard": { en: "Dashboard", bn: "ড্যাশবোর্ড" },
  "nav.doctors": { en: "Find a doctor", bn: "ডাক্তার খুঁজুন" },
  "nav.appointments": { en: "My appointments", bn: "আমার অ্যাপয়েন্টমেন্ট" },
  "nav.records": { en: "Medical records", bn: "স্বাস্থ্য রেকর্ড" },
  "nav.assistant": { en: "AI health assistant", bn: "এআই স্বাস্থ্য সহায়ক" },
  "nav.doctor-home": { en: "Overview", bn: "সারসংক্ষেপ" },
  "nav.doctor-schedule": { en: "Appointments", bn: "অ্যাপয়েন্টমেন্ট" },
  "nav.availability": { en: "Availability", bn: "সময়সূচি" },
  "nav.earnings": { en: "Earnings", bn: "আয়" },
  "nav.admin-home": { en: "Overview", bn: "সারসংক্ষেপ" },
  "nav.verification": { en: "Doctor verification", bn: "ডাক্তার যাচাই" },
  "nav.directory": { en: "Directory", bn: "ডিরেক্টরি" },
  "nav.specialties": { en: "Specialties", bn: "বিশেষত্ব" },
  "nav.profile": { en: "Settings", bn: "সেটিংস" },
  "nav.family": { en: "Family members", bn: "পরিবারের সদস্য" },
  "nav.signout": { en: "Sign out", bn: "সাইন আউট" },

  "role.patient": { en: "Patient workspace", bn: "রোগীর ওয়ার্কস্পেস" },
  "role.doctor": { en: "Doctor workspace", bn: "ডাক্তারের ওয়ার্কস্পেস" },
  "role.admin": { en: "Admin workspace", bn: "অ্যাডমিন ওয়ার্কস্পেস" },

  /* ---- Emergency -------------------------------------------------------- */
  // Deliberately blunt. This is the one string that must survive being read in
  // a hurry by someone who is frightened.
  "emergency.title": { en: "This may be an emergency", bn: "এটি জরুরি অবস্থা হতে পারে" },
  "emergency.call": {
    en: "Call {number} now, or go to the nearest emergency department.",
    bn: "এখনই {number} নম্বরে কল করুন, অথবা নিকটতম হাসপাতালের জরুরি বিভাগে যান।",
  },
  "emergency.dontWait": {
    en: "Do not wait for an online consultation.",
    bn: "অনলাইন পরামর্শের জন্য অপেক্ষা করবেন না।",
  },
  "emergency.button": { en: "Call {number}", bn: "{number} এ কল করুন" },

  /* ---- Booking ---------------------------------------------------------- */
  "booking.title": { en: "Book an appointment", bn: "অ্যাপয়েন্টমেন্ট নিন" },
  "booking.pickDay": { en: "Pick a day", bn: "দিন বেছে নিন" },
  "booking.pickTime": { en: "Pick a time", bn: "সময় বেছে নিন" },
  "booking.noSlots": { en: "No free slots that day", bn: "সেদিন কোনো খালি সময় নেই" },
  "booking.reason": { en: "What would you like to discuss?", bn: "কী নিয়ে পরামর্শ চান?" },
  "booking.reasonHint": {
    en: "Optional. The doctor sees this before the consultation.",
    bn: "ঐচ্ছিক। ডাক্তার পরামর্শের আগে এটি দেখবেন।",
  },
  "booking.confirm": { en: "Confirm booking", bn: "বুকিং নিশ্চিত করুন" },
  "booking.fee": { en: "Consultation fee", bn: "পরামর্শ ফি" },
  "booking.timezone": { en: "All times are Bangladesh time.", bn: "সব সময় বাংলাদেশ সময় অনুযায়ী।" },
  "booking.booked": { en: "You're booked", bn: "আপনার বুকিং হয়ে গেছে" },
  "booking.whatNext": { en: "What happens next", bn: "এরপর কী হবে" },

  /* ---- Payment ---------------------------------------------------------- */
  "pay.title": { en: "Pay with bKash", bn: "bKash দিয়ে পেমেন্ট করুন" },
  "pay.amount": { en: "Amount payable", bn: "প্রদেয় পরিমাণ" },
  "pay.walletLabel": { en: "Your bKash account number", bn: "আপনার bKash অ্যাকাউন্ট নম্বর" },
  "pay.walletHint": {
    en: "The 11-digit number the wallet is registered to.",
    bn: "যে ১১ সংখ্যার নম্বরে অ্যাকাউন্টটি নিবন্ধিত।",
  },
  // The anti-phishing line. If one payment string is read, it should be this.
  "pay.noPin": {
    en: "Niramoy never asks for your bKash PIN. If any site asks you to type your PIN into their page, it is not bKash.",
    bn: "নিরাময় কখনোই আপনার bKash পিন চাইবে না। কোনো ওয়েবসাইট যদি তাদের পাতায় পিন লিখতে বলে, সেটি bKash নয়।",
  },
  "pay.sandbox": {
    en: "Sandbox payment. Nothing is charged and no money moves.",
    bn: "পরীক্ষামূলক পেমেন্ট। কোনো টাকা কাটা হবে না।",
  },
  "pay.slotSafe": {
    en: "Your slot is already booked. The countdown is on this bKash session, not on your appointment.",
    bn: "আপনার সময়টি ইতিমধ্যেই বুক করা আছে। এই সময় গণনা bKash সেশনের জন্য, আপনার অ্যাপয়েন্টমেন্টের জন্য নয়।",
  },
  "pay.expired": {
    en: "This payment session has expired. Your appointment is still booked.",
    bn: "এই পেমেন্ট সেশনের সময় শেষ। আপনার অ্যাপয়েন্টমেন্ট এখনও বহাল আছে।",
  },
  "pay.later": { en: "Pay later", bn: "পরে দেব" },
  "pay.atChamber": { en: "Pay at the chamber", bn: "চেম্বারে পরিশোধ করুন" },

  /* ---- Prescriptions ---------------------------------------------------- */
  "rx.title": { en: "Prescription", bn: "প্রেসক্রিপশন" },
  "rx.dose": { en: "Dose", bn: "মাত্রা" },
  "rx.frequency": { en: "How often", bn: "কতবার" },
  "rx.duration": { en: "For how long", bn: "কত দিন" },
  "rx.instructions": { en: "How to take it", bn: "যেভাবে খাবেন" },
  "rx.diagnosis": { en: "Diagnosis", bn: "রোগ নির্ণয়" },
  "rx.advice": { en: "Advice", bn: "পরামর্শ" },
  "rx.issuedBy": { en: "Issued by", bn: "প্রদান করেছেন" },
  "rx.finishCourse": {
    en: "Finish the full course even if you feel better, unless your doctor tells you to stop.",
    bn: "ভালো বোধ করলেও ওষুধের পুরো কোর্স শেষ করুন, যদি না ডাক্তার থামতে বলেন।",
  },
  "rx.notADiagnosis": {
    en: "Ask your doctor or pharmacist if anything here is unclear. Do not share prescribed medicine with anyone else.",
    bn: "কিছু বুঝতে অসুবিধা হলে ডাক্তার বা ফার্মাসিস্টকে জিজ্ঞাসা করুন। নিজের ওষুধ অন্য কাউকে দেবেন না।",
  },

  /* ---- Shared ----------------------------------------------------------- */
  "common.cancel": { en: "Cancel", bn: "বাতিল" },
  "common.back": { en: "Back", bn: "পেছনে" },
  "common.retry": { en: "Try again", bn: "আবার চেষ্টা করুন" },
  "common.optional": { en: "Optional", bn: "ঐচ্ছিক" },
  "common.language": { en: "Language", bn: "ভাষা" },
};

const LanguageContext = createContext({ lang: "en", setLang: () => {}, t: (key) => key });

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState("en");

  useEffect(() => {
    const stored = window.localStorage.getItem(LANG_KEY);
    if (stored === "bn" || stored === "en") setLangState(stored);
  }, []);

  // Keep the document's language in step: it drives screen-reader
  // pronunciation and the browser's own offer to translate the page.
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((next) => {
    setLangState(next);
    window.localStorage.setItem(LANG_KEY, next);
  }, []);

  /**
   * Falls back to English, then to the key itself. A missing translation
   * shows readable English rather than a blank or a raw key — the switch
   * covers named surfaces only, so misses are expected, not exceptional.
   */
  const t = useCallback(
    /**
     * `force` renders one specific language regardless of the switch. It
     * exists for the emergency block, which is shown in both at once.
     */
    (key, vars, force) => {
      const entry = STRINGS[key];
      let text = entry ? (entry[force ?? lang] ?? entry.en) : key;
      if (vars) {
        for (const [name, value] of Object.entries(vars)) {
          text = text.replaceAll(`{${name}}`, String(value));
        }
      }
      return text;
    },
    [lang],
  );

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useT() {
  return useContext(LanguageContext);
}
