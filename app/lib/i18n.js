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

/**
 * Bangla first, because it is the default and the first language here.
 *
 * Written out in full — বাংলা, not বাং. An abbreviation of a language name is
 * one more thing to decode for the reader least able to decode it, and the two
 * words cost a few pixels in a header that has room for them.
 */
export const LANGUAGES = [
  { id: "bn", label: "বাংলা" },
  { id: "en", label: "English" },
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

  /* ---- Landing page ----------------------------------------------------- */
  /*
   * The public page is translated in full, not in part.
   *
   * Everything else in this file covers the surfaces where being unable to read
   * English changes what happens to a patient. The landing page is where being
   * unable to read English decides whether they ever get that far — a visitor
   * who cannot read the first screen does not sign up to discover that the
   * booking flow would have been in Bangla.
   */
  "landing.nav.how": { en: "How it works", bn: "কীভাবে কাজ করে" },
  "landing.nav.who": { en: "Who it's for", bn: "কার জন্য" },
  "landing.nav.features": { en: "Features", bn: "সুবিধাসমূহ" },
  "landing.nav.data": { en: "Our data", bn: "আমাদের তথ্য" },
  "landing.signIn": { en: "Sign in", bn: "সাইন ইন" },
  "landing.createAccount": { en: "Create account", bn: "অ্যাকাউন্ট খুলুন" },

  "landing.hero.eyebrow": {
    en: "Every bookable doctor is BM&DC-checked by hand",
    bn: "প্রতিটি বুকযোগ্য ডাক্তারের বিএমডিসি নিবন্ধন হাতে যাচাই করা",
  },
  "landing.hero.title": { en: "Care that comes to you", bn: "চিকিৎসা আসবে আপনার কাছে" },
  /*
   * The name, in the script of the page it is on. It is one word — নিরাময়,
   * "cure" — and an English sentence ending in Bangla script asks a reader who
   * chose English to read something they may not be able to.
   */
  "landing.hero.brand": { en: "Niramoy", bn: "নিরাময়" },
  "landing.hero.body": {
    en: "Niramoy connects patients across Bangladesh with doctors whose registration we check: describe your symptoms, get pointed to the right specialty, book a slot that is genuinely free, and consult over video without leaving home.",
    bn: "নিরাময় সারা বাংলাদেশের রোগীদের এমন ডাক্তারদের সঙ্গে যুক্ত করে, যাঁদের নিবন্ধন আমরা যাচাই করি: আপনার উপসর্গ বলুন, সঠিক বিশেষজ্ঞের দিশা নিন, সত্যিই খালি আছে এমন সময় বুক করুন, আর ঘরে বসেই ভিডিওতে পরামর্শ নিন।",
  },
  "landing.hero.ctaPatient": { en: "Get started as a patient", bn: "রোগী হিসেবে শুরু করুন" },
  "landing.hero.ctaDoctor": { en: "Join as a doctor", bn: "ডাক্তার হিসেবে যোগ দিন" },
  "landing.hero.alt": {
    en: "A woman at home on her sofa consulting a doctor by video on her phone, surrounded by panels for the AI health assistant, booking an appointment, a digital prescription and her medical history.",
    bn: "ঘরে সোফায় বসে একজন নারী ফোনে ভিডিওতে ডাক্তারের পরামর্শ নিচ্ছেন; চারপাশে এআই স্বাস্থ্য সহায়ক, অ্যাপয়েন্টমেন্ট বুকিং, ডিজিটাল প্রেসক্রিপশন ও স্বাস্থ্য রেকর্ডের প্যানেল।",
  },

  "landing.figures.profiles": { en: "Doctor profiles", bn: "ডাক্তারের প্রোফাইল" },
  "landing.figures.verified": { en: "BM&DC-verified", bn: "বিএমডিসি যাচাইকৃত" },
  "landing.figures.districts": { en: "Districts covered", bn: "যত জেলায় সেবা" },
  "landing.figures.triage": { en: "AI triage", bn: "এআই প্রাথমিক পরামর্শ" },

  "landing.roles.eyebrow": { en: "Three workspaces", bn: "তিনটি ওয়ার্কস্পেস" },
  "landing.roles.title": {
    en: "One platform, whichever side of care you're on",
    bn: "চিকিৎসার যে দিকেই থাকুন, প্ল্যাটফর্ম একটাই",
  },
  "landing.roles.sub": {
    en: "Pick the role that fits you — each sign-in opens a workspace built for that job.",
    bn: "আপনার ভূমিকাটি বেছে নিন — প্রতিটি সাইন-ইন সেই কাজের উপযোগী ওয়ার্কস্পেস খুলে দেয়।",
  },

  "landing.role.patient.title": { en: "I need care", bn: "আমার চিকিৎসা দরকার" },
  "landing.role.patient.blurb": {
    en: "Find a doctor near you, book a slot that is actually free, and keep every prescription in one place.",
    bn: "কাছের ডাক্তার খুঁজুন, সত্যিই খালি আছে এমন সময়ে বুক করুন, আর সব প্রেসক্রিপশন এক জায়গায় রাখুন।",
  },
  "landing.role.patient.p1": {
    en: "Search 64 districts by specialty and fee",
    bn: "বিশেষত্ব ও ফি অনুযায়ী ৬৪ জেলায় খুঁজুন",
  },
  "landing.role.patient.p2": {
    en: "AI symptom triage before you book",
    bn: "বুক করার আগে এআই উপসর্গ যাচাই",
  },
  "landing.role.patient.p3": {
    en: "Video consultations and family accounts",
    bn: "ভিডিও পরামর্শ ও পরিবারের অ্যাকাউন্ট",
  },
  "landing.role.patient.cta": { en: "Continue as a patient", bn: "রোগী হিসেবে এগিয়ে যান" },

  "landing.role.doctor.title": { en: "I practise medicine", bn: "আমি চিকিৎসা পেশায় আছি" },
  "landing.role.doctor.blurb": {
    en: "Publish a bookable profile after BM&DC verification, set your own hours, and issue prescriptions after each visit.",
    bn: "বিএমডিসি যাচাইয়ের পর বুকযোগ্য প্রোফাইল প্রকাশ করুন, নিজের সময় ঠিক করুন, আর প্রতিটি ভিজিটের পর প্রেসক্রিপশন দিন।",
  },
  "landing.role.doctor.p1": {
    en: "BM&DC-verified profile badge",
    bn: "বিএমডিসি যাচাইকৃত প্রোফাইল ব্যাজ",
  },
  "landing.role.doctor.p2": {
    en: "Recurring availability, no double bookings",
    bn: "নিয়মিত সময়সূচি, দ্বৈত বুকিং নয়",
  },
  "landing.role.doctor.p3": {
    en: "AI-drafted visit summaries you approve",
    bn: "এআই-খসড়া ভিজিট সারাংশ, অনুমোদন করবেন আপনি",
  },
  "landing.role.doctor.cta": { en: "Continue as a doctor", bn: "ডাক্তার হিসেবে এগিয়ে যান" },

  "landing.role.admin.title": { en: "I run the platform", bn: "আমি প্ল্যাটফর্ম চালাই" },
  "landing.role.admin.blurb": {
    en: "Work the verification queue, confirm registration numbers against the BM&DC register, and watch directory coverage.",
    bn: "যাচাইয়ের সারি সামলান, বিএমডিসি রেজিস্টারের সঙ্গে নিবন্ধন নম্বর মিলিয়ে দেখুন, আর ডিরেক্টরির কভারেজ নজরে রাখুন।",
  },
  "landing.role.admin.p1": { en: "Doctor verification queue", bn: "ডাক্তার যাচাইয়ের সারি" },
  "landing.role.admin.p2": {
    en: "Directory and specialty oversight",
    bn: "ডিরেক্টরি ও বিশেষত্ব তদারকি",
  },
  "landing.role.admin.p3": { en: "Staff invite code required", bn: "স্টাফ ইনভাইট কোড লাগবে" },
  "landing.role.admin.cta": { en: "Staff sign in", bn: "স্টাফ সাইন ইন" },

  "landing.steps.eyebrow": { en: "How it works", bn: "কীভাবে কাজ করে" },
  "landing.steps.title": {
    en: "From symptom to prescription in four steps",
    bn: "উপসর্গ থেকে প্রেসক্রিপশন — চার ধাপে",
  },
  "landing.steps.no": { en: "Step {n}", bn: "ধাপ {n}" },
  "landing.steps.1.title": { en: "Describe how you feel", bn: "কেমন লাগছে বলুন" },
  "landing.steps.1.text": {
    en: "The assistant triages your symptoms, flags anything urgent, and suggests the right specialty.",
    bn: "সহায়ক আপনার উপসর্গ যাচাই করে, জরুরি কিছু থাকলে চিহ্নিত করে, আর সঠিক বিশেষত্বের পরামর্শ দেয়।",
  },
  "landing.steps.2.title": { en: "Pick a doctor", bn: "ডাক্তার বাছুন" },
  "landing.steps.2.text": {
    en: "Filter by specialty, district, fee and language. Profiles show whether the BM&DC registration has been confirmed or the profile is sample data.",
    bn: "বিশেষত্ব, জেলা, ফি ও ভাষা দিয়ে ছেঁকে নিন। প্রোফাইলেই লেখা থাকে বিএমডিসি নিবন্ধন যাচাই হয়েছে, নাকি এটি নমুনা প্রোফাইল।",
  },
  "landing.steps.3.title": { en: "Book a real slot", bn: "সত্যিকারের সময় বুক করুন" },
  "landing.steps.3.text": {
    en: "Availability is generated from the doctor's own hours, and the same slot can never be taken twice.",
    bn: "ডাক্তারের নিজের সময় থেকেই স্লট তৈরি হয়, আর একই স্লট দুবার নেওয়া যায় না।",
  },
  "landing.steps.4.title": { en: "Consult and keep the record", bn: "পরামর্শ নিন, রেকর্ড থাকুক" },
  "landing.steps.4.text": {
    en: "Meet over video, then get your prescription and visit summary saved to your timeline.",
    bn: "ভিডিওতে কথা বলুন, তারপর প্রেসক্রিপশন ও ভিজিটের সারাংশ আপনার টাইমলাইনে জমা থাকবে।",
  },

  "landing.features.eyebrow": { en: "What you get", bn: "যা যা পাবেন" },
  "landing.features.title": {
    en: "The details that make it usable",
    bn: "যে খুঁটিনাটি একে ব্যবহারযোগ্য করে",
  },
  "landing.features.1.title": { en: "Verified, not scraped", bn: "যাচাই করা, তুলে আনা নয়" },
  "landing.features.1.text": {
    en: "Doctors join by submitting a BM&DC registration number that a human admin confirms. No harvested directories.",
    bn: "ডাক্তার নিজের বিএমডিসি নিবন্ধন নম্বর জমা দেন, একজন মানুষ সেটি মিলিয়ে দেখেন। কোথাও থেকে তালিকা তুলে আনা হয় না।",
  },
  "landing.features.2.title": { en: "Conflict-free scheduling", bn: "সংঘাতহীন সময়সূচি" },
  "landing.features.2.text": {
    en: "Slots come from recurring availability rules; a unique constraint on (doctor, start time) makes double booking impossible.",
    bn: "নিয়মিত সময়সূচির নিয়ম থেকেই স্লট তৈরি হয়; ডেটাবেসের শর্তই দ্বৈত বুকিং অসম্ভব করে রাখে।",
  },
  "landing.features.3.title": { en: "AI that knows its limits", bn: "এআই নিজের সীমা জানে" },
  "landing.features.3.text": {
    en: "Red-flag symptoms return emergency advice instead of a booking funnel, and are never sent to a model.",
    bn: "বিপদচিহ্ন উপসর্গে বুকিংয়ের বদলে জরুরি পরামর্শ দেখানো হয়, আর সেগুলো কখনো কোনো মডেলে পাঠানো হয় না।",
  },
  "landing.features.4.title": { en: "Records that follow you", bn: "রেকর্ড থাকবে আপনার সঙ্গে" },
  "landing.features.4.text": {
    en: "Prescriptions, notes and past visits stay on one timeline you can read on any device.",
    bn: "প্রেসক্রিপশন, নোট আর আগের ভিজিট এক টাইমলাইনে থাকে, যেকোনো ডিভাইসে পড়া যায়।",
  },
  "landing.features.5.title": { en: "Family accounts", bn: "পরিবারের অ্যাকাউন্ট" },
  "landing.features.5.text": {
    en: "Book for a parent or a child from your own account, without a second sign-up.",
    bn: "নিজের অ্যাকাউন্ট থেকেই বাবা-মা বা সন্তানের জন্য বুক করুন, আলাদা সাইন-আপ ছাড়াই।",
  },
  "landing.features.6.title": { en: "Built for Bangladesh", bn: "বাংলাদেশের জন্য তৈরি" },
  "landing.features.6.text": {
    en: "All 8 divisions and 64 districts, fees in taka, and Bangla alongside English.",
    bn: "আট বিভাগ ও ৬৪ জেলা, টাকায় ফি, আর ইংরেজির পাশে বাংলা।",
  },

  "landing.data.title": {
    en: "Where the doctor data comes from",
    bn: "ডাক্তারের তথ্য কোথা থেকে আসে",
  },
  "landing.data.p1": {
    en: "Bangladesh has no public API or bulk registry of licensed doctors — the BM&DC service verifies one registration number at a time. So Niramoy verifies each doctor individually: they submit their number, an admin confirms it at verify.bmdc.org.bd, and only then does the profile become bookable.",
    bn: "বাংলাদেশে নিবন্ধিত ডাক্তারদের কোনো উন্মুক্ত এপিআই বা পূর্ণ তালিকা নেই — বিএমডিসির সেবা একবারে একটি নিবন্ধন নম্বরই যাচাই করে। তাই নিরাময় প্রত্যেক ডাক্তারকে আলাদা করে যাচাই করে: তিনি নম্বরটি জমা দেন, একজন অ্যাডমিন verify.bmdc.org.bd-তে সেটি মিলিয়ে দেখেন, তারপরই প্রোফাইলটি বুকযোগ্য হয়।",
  },
  "landing.data.p2a": {
    en: "The directory ships with synthetic sample profiles so there is something to explore before real doctors sign up. Every one of them carries a ",
    bn: "আসল ডাক্তাররা যুক্ত হওয়ার আগেও যাতে ঘুরে দেখা যায়, সে জন্য ডিরেক্টরিতে কিছু নমুনা প্রোফাইল রাখা আছে। প্রতিটির গায়ে সব জায়গাতেই ",
  },
  "landing.data.badge": { en: "Demo profile", bn: "ডেমো প্রোফাইল" },
  "landing.data.p2b": {
    en: " badge, everywhere it appears. No real physician's name or phone number is used.",
    bn: " ব্যাজ থাকে। কোনো বাস্তব চিকিৎসকের নাম বা ফোন নম্বর ব্যবহার করা হয়নি।",
  },

  "landing.final.title": { en: "Ready when you are", bn: "আপনি প্রস্তুত হলেই শুরু" },
  "landing.final.sub": {
    en: "Create an account in under a minute. No card, no clinic queue.",
    bn: "এক মিনিটেরও কম সময়ে অ্যাকাউন্ট খুলুন। কার্ড লাগবে না, লাইনেও দাঁড়াতে হবে না।",
  },
  "landing.final.create": { en: "Create your account", bn: "অ্যাকাউন্ট খুলুন" },
  "landing.final.have": { en: "I already have one", bn: "আমার অ্যাকাউন্ট আছে" },

  "landing.footer": {
    en: "An AI-assisted telemedicine and appointment platform for Bangladesh. Built for CSE-356, CUET. Not a substitute for emergency care — for emergencies, call {number}.",
    bn: "বাংলাদেশের জন্য এআই-সহায়ক টেলিমেডিসিন ও অ্যাপয়েন্টমেন্ট প্ল্যাটফর্ম। চুয়েটের CSE-356 কোর্সের কাজ। এটি জরুরি চিকিৎসার বিকল্প নয় — জরুরি অবস্থায় {number} নম্বরে কল করুন।",
  },

  /* ---- Shared ----------------------------------------------------------- */
  "common.cancel": { en: "Cancel", bn: "বাতিল" },
  "common.back": { en: "Back", bn: "পেছনে" },
  "common.retry": { en: "Try again", bn: "আবার চেষ্টা করুন" },
  "common.optional": { en: "Optional", bn: "ঐচ্ছিক" },
  "common.language": { en: "Language", bn: "ভাষা" },
};

const LanguageContext = createContext({ lang: "en", setLang: () => {}, t: (key) => key });

const BANGLA_DIGITS = "০১২৩৪৫৬৭৮৯";

/**
 * ASCII digits to Bangla ones, for numbers that are read rather than dialled or
 * copied: a count, a step number, a year. Phone numbers and registration
 * numbers keep their ASCII digits — those get typed into a keypad or matched
 * against a document, and a converted digit there is a transcription error.
 */
export function banglaDigits(value) {
  return String(value).replace(/\d/g, (d) => BANGLA_DIGITS[Number(d)]);
}

export function LanguageProvider({ children }) {
  /**
   * Bangla until told otherwise.
   *
   * Most people this is for read Bangla first, and the ones who prefer English
   * can find a two-button switch in the header. The reverse is not true: a
   * patient who cannot read English cannot reliably find the control that would
   * fix that, so the default has to be the one that fails safe for them.
   */
  const [lang, setLangState] = useState("bn");

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
