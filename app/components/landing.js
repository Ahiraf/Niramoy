"use client";

import { Icon } from "./icons.js";

/**
 * The public front door. Everything here is readable signed out; every call to
 * action lands on the auth page with a role already chosen, so a visitor never
 * has to guess which of the three workspaces is theirs.
 */

const ROLE_CARDS = [
  {
    role: "patient",
    icon: "heart",
    title: "I need care",
    blurb: "Find a doctor near you, book a slot that is actually free, and keep every prescription in one place.",
    points: ["Search 64 districts by specialty and fee", "AI symptom triage before you book", "Video consultations and family accounts"],
    cta: "Continue as a patient",
  },
  {
    role: "doctor",
    icon: "badge",
    title: "I practise medicine",
    blurb: "Publish a bookable profile after BM&DC verification, set your own hours, and issue prescriptions after each visit.",
    points: ["BM&DC-verified profile badge", "Recurring availability, no double bookings", "AI-drafted visit summaries you approve"],
    cta: "Continue as a doctor",
  },
  {
    role: "admin",
    icon: "shield",
    title: "I run the platform",
    blurb: "Work the verification queue, confirm registration numbers against the BM&DC register, and watch directory coverage.",
    points: ["Doctor verification queue", "Directory and specialty oversight", "Staff invite code required"],
    cta: "Staff sign in",
  },
];

const STEPS = [
  { icon: "bot", title: "Describe how you feel", text: "The assistant triages your symptoms, flags anything urgent, and suggests the right specialty." },
  { icon: "search", title: "Pick a doctor", text: "Filter by specialty, district, fee and language. Profiles show whether the BM&DC registration has been confirmed or the profile is sample data." },
  { icon: "calendar", title: "Book a real slot", text: "Availability is generated from the doctor's own hours, and the same slot can never be taken twice." },
  { icon: "video", title: "Consult and keep the record", text: "Meet over video, then get your prescription and visit summary saved to your timeline." },
];

const FEATURES = [
  { icon: "shield", title: "Verified, not scraped", text: "Doctors join by submitting a BM&DC registration number that a human admin confirms. No harvested directories." },
  { icon: "clock", title: "Conflict-free scheduling", text: "Slots come from recurring availability rules; a unique constraint on (doctor, start time) makes double booking impossible." },
  { icon: "bot", title: "AI that knows its limits", text: "Red-flag symptoms return emergency advice instead of a booking funnel, and are never sent to a model." },
  { icon: "file", title: "Records that follow you", text: "Prescriptions, notes and past visits stay on one timeline you can read on any device." },
  { icon: "users", title: "Family accounts", text: "Book for a parent or a child from your own account, without a second sign-up." },
  { icon: "pin", title: "Built for Bangladesh", text: "All 8 divisions and 64 districts, fees in taka, and Bangla alongside English." },
];

export function Landing({ stats, onSignIn, onSignUp }) {
  /*
   * Two separate numbers, never one.
   *
   * The directory is mostly seeded sample profiles, so a single "doctors"
   * figure next to the word verified would read as a claim that all of them
   * are. Both counts come from the database, so they cannot drift from what
   * the directory actually contains.
   */
  const figures = [
    { value: stats?.doctors ?? "—", label: "Doctor profiles" },
    { value: stats?.realDoctors ?? "—", label: "BM&DC-verified" },
    { value: stats?.districtsCovered ?? "—", label: "Districts covered" },
    { value: "24/7", label: "AI triage" },
  ];

  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="brand">
          <div className="brand-mark"><Icon name="heart" size={20} strokeWidth={2.2} /></div>
          <div className="brand-name">nira<span>moy</span></div>
        </div>

        <nav className="landing-links">
          <a href="#how">How it works</a>
          <a href="#roles">Who it&rsquo;s for</a>
          <a href="#features">Features</a>
          <a href="#data">Our data</a>
        </nav>

        <div className="landing-nav-actions">
          <button className="button ghost" onClick={() => onSignIn("patient")}>Sign in</button>
          <button className="button primary" onClick={() => onSignUp("patient")}>
            Create account <Icon name="arrow" size={13} />
          </button>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <span className="landing-eyebrow">
            <Icon name="shield" size={12} /> Every bookable doctor is BM&amp;DC-checked by hand
          </span>
          <h1>
            Care that comes to you — <em>নিরাময়</em>
          </h1>
          <p>
            Niramoy connects patients across Bangladesh with doctors whose registration we check: describe your
            symptoms, get pointed to the right specialty, book a slot that is genuinely free, and
            consult over video without leaving home.
          </p>

          <div className="landing-cta-row">
            <button className="button primary" onClick={() => onSignUp("patient")}>
              Get started as a patient <Icon name="arrow" size={13} />
            </button>
            <button className="button ghost" onClick={() => onSignUp("doctor")}>
              <Icon name="badge" size={13} /> Join as a doctor
            </button>
          </div>

          <div className="landing-figures">
            {figures.map((f) => (
              <div key={f.label}>
                <strong>{f.value}</strong>
                <span>{f.label}</span>
              </div>
            ))}
          </div>
        </div>

        <aside className="landing-hero-art" aria-hidden="true">
          <div className="landing-card-float top">
            <div className="avatar teal md">AK</div>
            <div>
              <strong>Dr. Ayesha Khan</strong>
              <span>Cardiologist · Dhaka</span>
            </div>
            <span className="verified"><Icon name="check" size={10} /> BM&amp;DC</span>
          </div>

          <div className="landing-card-float mid">
            <span className="eyebrow">Next appointment</span>
            <strong>Tomorrow, 5:20 PM</strong>
            <p>Video consultation · ৳ 900</p>
            <div className="landing-slotline">
              <span className="on">5:20</span><span>5:40</span><span>6:00</span><span>6:20</span>
            </div>
          </div>

          <div className="landing-card-float low">
            <div className="landing-triage-icon"><Icon name="bot" size={15} /></div>
            <div>
              <strong>Triage suggests Cardiology</strong>
              <span>Chest tightness on exertion · non-urgent</span>
            </div>
          </div>
        </aside>
      </section>

      <section className="landing-section" id="roles">
        <div className="landing-head">
          <span className="landing-eyebrow plain">Three workspaces</span>
          <h2>One platform, whichever side of care you&rsquo;re on</h2>
          <p>Pick the role that fits you — each sign-in opens a workspace built for that job.</p>
        </div>

        <div className="landing-role-grid">
          {ROLE_CARDS.map((card) => (
            <article className={`landing-role-card card ${card.role}`} key={card.role}>
              <div className="landing-role-icon"><Icon name={card.icon} size={19} /></div>
              <h3>{card.title}</h3>
              <p>{card.blurb}</p>
              <ul>
                {card.points.map((p) => (
                  <li key={p}><Icon name="check" size={12} /> {p}</li>
                ))}
              </ul>
              <button
                className={`button ${card.role === "patient" ? "primary" : "secondary"}`}
                onClick={() => (card.role === "admin" ? onSignIn("admin") : onSignUp(card.role))}
              >
                {card.cta} <Icon name="arrow" size={13} />
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section tinted" id="how">
        <div className="landing-head">
          <span className="landing-eyebrow plain">How it works</span>
          <h2>From symptom to prescription in four steps</h2>
        </div>

        <ol className="landing-steps">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <div className="landing-step-icon"><Icon name={step.icon} size={17} /></div>
              <span className="landing-step-no">Step {i + 1}</span>
              <strong>{step.title}</strong>
              <p>{step.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section" id="features">
        <div className="landing-head">
          <span className="landing-eyebrow plain">What you get</span>
          <h2>The details that make it usable</h2>
        </div>

        <div className="landing-feature-grid">
          {FEATURES.map((f) => (
            <article className="landing-feature card" key={f.title}>
              <div className="landing-feature-icon"><Icon name={f.icon} size={17} /></div>
              <strong>{f.title}</strong>
              <p>{f.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section" id="data">
        <div className="landing-note card">
          <div className="landing-note-icon"><Icon name="info" size={19} /></div>
          <div>
            <h3>Where the doctor data comes from</h3>
            <p>
              Bangladesh has no public API or bulk registry of licensed doctors — the BM&amp;DC
              service verifies one registration number at a time. So Niramoy verifies each doctor
              individually: they submit their number, an admin confirms it at verify.bmdc.org.bd,
              and only then does the profile become bookable.
            </p>
            <p>
              The directory ships with synthetic sample profiles so there is something to explore
              before real doctors sign up. Every one of them carries a <strong>Demo profile</strong>
              {" "}badge, everywhere it appears. No real physician&rsquo;s name or phone number is used.
            </p>
          </div>
        </div>
      </section>

      <section className="landing-final">
        <h2>Ready when you are</h2>
        <p>Create an account in under a minute. No card, no clinic queue.</p>
        <div className="landing-cta-row center">
          <button className="button primary" onClick={() => onSignUp("patient")}>
            Create your account <Icon name="arrow" size={13} />
          </button>
          <button className="button ghost" onClick={() => onSignIn("patient")}>I already have one</button>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="brand">
          <div className="brand-mark"><Icon name="heart" size={17} strokeWidth={2.2} /></div>
          <div className="brand-name">nira<span>moy</span></div>
        </div>
        <p>
          An AI-assisted telemedicine and appointment platform for Bangladesh. Built for CSE-356,
          CUET. Not a substitute for emergency care — for emergencies, call 999.
        </p>
      </footer>
    </div>
  );
}
