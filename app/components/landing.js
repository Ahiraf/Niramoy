"use client";

import Image from "next/image";

import { Icon } from "./icons.js";
import { LanguageSwitch } from "./shell.js";
import { banglaDigits, useT } from "../lib/i18n.js";

/**
 * The public front door. Everything here is readable signed out; every call to
 * action lands on the auth page with a role already chosen, so a visitor never
 * has to guess which of the three workspaces is theirs.
 *
 * Every string on this page goes through `t()`, and the page opens in Bangla.
 * Elsewhere the translation covers named surfaces only — but this is the screen
 * that decides whether somebody signs up at all, and a visitor who cannot read
 * it will not stay to find out that the booking flow would have been in Bangla.
 */

/**
 * Who this page is for. Administration is deliberately absent: it is staff
 * tooling on its own URL (/admin), not something to advertise to visitors.
 */
const ROLE_CARDS = [
  { role: "patient", icon: "heart" },
  { role: "doctor", icon: "badge" },
];

const STEP_ICONS = ["bot", "search", "calendar", "video"];
const FEATURE_ICONS = ["shield", "clock", "bot", "file", "users", "pin"];

export function Landing({ stats, onSignIn, onSignUp }) {
  const { lang, t } = useT();

  /** Counts are read, not dialled, so they take Bangla numerals in Bangla. */
  const num = (value) => (lang === "bn" ? banglaDigits(value) : String(value));

  /*
   * Two separate numbers, never one.
   *
   * The directory is mostly seeded sample profiles, so a single "doctors"
   * figure next to the word verified would read as a claim that all of them
   * are. Both counts come from the database, so they cannot drift from what
   * the directory actually contains.
   */
  const figures = [
    { value: num(stats?.doctors ?? "—"), label: t("landing.figures.profiles") },
    { value: num(stats?.realDoctors ?? "—"), label: t("landing.figures.verified") },
    { value: num(stats?.districtsCovered ?? "—"), label: t("landing.figures.districts") },
    { value: num("24/7"), label: t("landing.figures.triage") },
  ];

  return (
    <div className="landing">
      <header className="landing-nav">
        <div className="brand">
          <div className="brand-mark"><Icon name="heart" size={20} strokeWidth={2.2} /></div>
          <div className="brand-name">nira<span>moy</span></div>
        </div>

        <nav className="landing-links">
          <a href="#how">{t("landing.nav.how")}</a>
          <a href="#roles">{t("landing.nav.who")}</a>
          <a href="#features">{t("landing.nav.features")}</a>
          <a href="#data">{t("landing.nav.data")}</a>
        </nav>

        <div className="landing-nav-actions">
          {/* First control in the header, before the two account buttons: it is
              the one a visitor needs before they can read the others. */}
          <LanguageSwitch />
          <button className="button ghost" onClick={() => onSignIn("patient")}>
            {t("landing.signIn")}
          </button>
          <button className="button primary" onClick={() => onSignUp("patient")}>
            {t("landing.createAccount")} <Icon name="arrow" size={13} />
          </button>
        </div>
      </header>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <span className="landing-eyebrow">
            <Icon name="shield" size={12} /> {t("landing.hero.eyebrow")}
          </span>
          <h1>
            {t("landing.hero.title")} — <em>{t("landing.hero.brand")}</em>
          </h1>
          <p>{t("landing.hero.body")}</p>

          <div className="landing-cta-row">
            <button className="button primary" onClick={() => onSignUp("patient")}>
              {t("landing.hero.ctaPatient")} <Icon name="arrow" size={13} />
            </button>
            <button className="button ghost" onClick={() => onSignUp("doctor")}>
              <Icon name="badge" size={13} /> {t("landing.hero.ctaDoctor")}
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

        {/*
          One illustration instead of the three mocked-up cards that used to sit
          here. Those cards named a doctor, a fee and a slot that did not exist,
          which is a strange thing to put on the page of a product whose whole
          argument is that its directory is checked by hand.

          The alt text describes what the picture shows rather than repeating the
          headline: somebody using a screen reader gets the scene, not a second
          copy of the sentence beside it.
        */}
        <aside className="landing-hero-art">
          <Image
            src="/landing-hero.png"
            alt={t("landing.hero.alt")}
            width={586}
            height={880}
            sizes="(max-width: 1080px) 100vw, 44vw"
            priority
          />
        </aside>
      </section>

      <section className="landing-section" id="roles">
        <div className="landing-head">
          <span className="landing-eyebrow plain">{t("landing.roles.eyebrow")}</span>
          <h2>{t("landing.roles.title")}</h2>
          <p>{t("landing.roles.sub")}</p>
        </div>

        <div className="landing-role-grid">
          {ROLE_CARDS.map((card) => (
            <article className={`landing-role-card card ${card.role}`} key={card.role}>
              <div className="landing-role-icon"><Icon name={card.icon} size={19} /></div>
              <h3>{t(`landing.role.${card.role}.title`)}</h3>
              <p>{t(`landing.role.${card.role}.blurb`)}</p>
              <ul>
                {[1, 2, 3].map((n) => (
                  <li key={n}>
                    <Icon name="check" size={12} /> {t(`landing.role.${card.role}.p${n}`)}
                  </li>
                ))}
              </ul>
              <button
                className={`button ${card.role === "patient" ? "primary" : "secondary"}`}
                onClick={() => onSignUp(card.role)}
              >
                {t(`landing.role.${card.role}.cta`)} <Icon name="arrow" size={13} />
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section tinted" id="how">
        <div className="landing-head">
          <span className="landing-eyebrow plain">{t("landing.steps.eyebrow")}</span>
          <h2>{t("landing.steps.title")}</h2>
        </div>

        <ol className="landing-steps">
          {STEP_ICONS.map((icon, i) => (
            <li key={icon}>
              <div className="landing-step-icon"><Icon name={icon} size={17} /></div>
              <span className="landing-step-no">{t("landing.steps.no", { n: num(i + 1) })}</span>
              <strong>{t(`landing.steps.${i + 1}.title`)}</strong>
              <p>{t(`landing.steps.${i + 1}.text`)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section" id="features">
        <div className="landing-head">
          <span className="landing-eyebrow plain">{t("landing.features.eyebrow")}</span>
          <h2>{t("landing.features.title")}</h2>
        </div>

        <div className="landing-feature-grid">
          {FEATURE_ICONS.map((icon, i) => (
            <article className="landing-feature card" key={`${icon}-${i}`}>
              <div className="landing-feature-icon"><Icon name={icon} size={17} /></div>
              <strong>{t(`landing.features.${i + 1}.title`)}</strong>
              <p>{t(`landing.features.${i + 1}.text`)}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="landing-section" id="data">
        <div className="landing-note card">
          <div className="landing-note-icon"><Icon name="info" size={19} /></div>
          <div>
            <h3>{t("landing.data.title")}</h3>
            <p>{t("landing.data.p1")}</p>
            <p>
              {t("landing.data.p2a")}
              <strong>{t("landing.data.badge")}</strong>
              {t("landing.data.p2b")}
            </p>
          </div>
        </div>
      </section>

      <section className="landing-final">
        <h2>{t("landing.final.title")}</h2>
        <p>{t("landing.final.sub")}</p>
        <div className="landing-cta-row center">
          <button className="button primary" onClick={() => onSignUp("patient")}>
            {t("landing.final.create")} <Icon name="arrow" size={13} />
          </button>
          <button className="button ghost" onClick={() => onSignIn("patient")}>
            {t("landing.final.have")}
          </button>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="brand">
          <div className="brand-mark"><Icon name="heart" size={17} strokeWidth={2.2} /></div>
          <div className="brand-name">nira<span>moy</span></div>
        </div>
        {/* The emergency number keeps ASCII digits in both languages: it is
            dialled, not read, and 999 is what is printed on the keypad. */}
        <p>{t("landing.footer", { number: "999" })}</p>
      </footer>
    </div>
  );
}
