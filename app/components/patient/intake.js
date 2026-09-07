"use client";

/**
 * The few questions worth asking before a symptom description.
 *
 * A blank chat box asks the patient to know what is relevant. Most people do
 * not mention that they are pregnant when describing back pain, or that they
 * are diabetic when describing a slow-healing cut — and those are precisely the
 * facts that change the answer.
 *
 * Every question is optional and answered with a tap. Nothing here is required
 * to get a result, because a form standing between a frightened person and help
 * is worse than a thinner triage.
 */

import { Icon } from "../icons.js";

export const AGE_BANDS = [
  { id: "infant", label: "Under 1", bn: "১ বছরের কম" },
  { id: "child", label: "1–12", bn: "১–১২" },
  { id: "adult", label: "13–64", bn: "১৩–৬৪" },
  { id: "elderly", label: "65+", bn: "৬৫+" },
];

export const DURATION_BANDS = [
  { id: "hours", label: "Hours" },
  { id: "days", label: "Days" },
  { id: "weeks", label: "Weeks" },
  { id: "months", label: "Months" },
];

export const SEVERITY_BANDS = [
  { id: "mild", label: "Mild", hint: "Noticeable, not stopping me" },
  { id: "moderate", label: "Moderate", hint: "Affecting my day" },
  { id: "severe", label: "Severe", hint: "Hard to bear" },
];

export const CONDITIONS = [
  { id: "diabetes", label: "Diabetes" },
  { id: "hypertension", label: "High blood pressure" },
  { id: "heart_disease", label: "Heart disease" },
  { id: "asthma", label: "Asthma" },
  { id: "kidney_disease", label: "Kidney disease" },
  { id: "immunocompromised", label: "Weakened immunity" },
];

export const EMPTY_INTAKE = {
  ageBand: null,
  durationBand: null,
  severity: null,
  pregnant: null,
  conditions: [],
  language: null,
};

function ChoiceRow({ legend, hint, options, value, onSelect }) {
  return (
    <fieldset className="intake-row">
      <legend>
        {legend}
        {hint && <span>{hint}</span>}
      </legend>
      <div className="intake-choices">
        {options.map((option) => {
          const active = value === option.id;
          return (
            <button
              key={option.id}
              type="button"
              className={`chip ${active ? "active" : ""}`}
              aria-pressed={active}
              title={option.hint}
              // Tapping the chosen answer again clears it: every question is
              // optional, so every answer has to be un-answerable.
              onClick={() => onSelect(active ? null : option.id)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function IntakePanel({ intake, onChange, onSkip, collapsed, onExpand }) {
  const set = (key) => (value) => onChange({ ...intake, [key]: value });

  const answered = [
    intake.ageBand,
    intake.durationBand,
    intake.severity,
    intake.pregnant === true ? "yes" : null,
    intake.conditions.length ? "conditions" : null,
  ].filter(Boolean).length;

  if (collapsed) {
    return (
      <button type="button" className="intake-summary" onClick={onExpand}>
        <Icon name="file" size={13} />
        <span>
          {answered
            ? `${answered} detail${answered === 1 ? "" : "s"} added — these help me route you`
            : "Add a few details (optional) — age, how long, how bad"}
        </span>
        <Icon name="chevron" size={14} />
      </button>
    );
  }

  return (
    <section className="intake-panel" aria-label="Optional questions before triage">
      <header>
        <div>
          <strong>A few optional questions</strong>
          <p>They make the suggestion more accurate. Skip any, or all of them.</p>
        </div>
        <button type="button" className="text-link" onClick={onSkip}>
          Skip
        </button>
      </header>

      <ChoiceRow
        legend="Who is this for?"
        hint="Age group"
        options={AGE_BANDS}
        value={intake.ageBand}
        onSelect={set("ageBand")}
      />

      <ChoiceRow
        legend="How long has it been going on?"
        options={DURATION_BANDS}
        value={intake.durationBand}
        onSelect={set("durationBand")}
      />

      <ChoiceRow
        legend="How bad is it?"
        options={SEVERITY_BANDS}
        value={intake.severity}
        onSelect={set("severity")}
      />

      {/* Only offered where it can apply. Asking a 6-year-old's parent about
          pregnancy is noise; asking an adult is a question that changes the
          answer. */}
      {(intake.ageBand === "adult" || intake.ageBand === null) && (
        <fieldset className="intake-row">
          <legend>Pregnant, or possibly pregnant?</legend>
          <div className="intake-choices">
            <button
              type="button"
              className={`chip ${intake.pregnant === true ? "active" : ""}`}
              aria-pressed={intake.pregnant === true}
              onClick={() => set("pregnant")(intake.pregnant === true ? null : true)}
            >
              Yes
            </button>
            <button
              type="button"
              className={`chip ${intake.pregnant === false ? "active" : ""}`}
              aria-pressed={intake.pregnant === false}
              onClick={() => set("pregnant")(intake.pregnant === false ? null : false)}
            >
              No
            </button>
          </div>
        </fieldset>
      )}

      <fieldset className="intake-row">
        <legend>
          Any long-term conditions?
          <span>Choose any that apply</span>
        </legend>
        <div className="intake-choices">
          {CONDITIONS.map((condition) => {
            const active = intake.conditions.includes(condition.id);
            return (
              <button
                key={condition.id}
                type="button"
                className={`chip ${active ? "active" : ""}`}
                aria-pressed={active}
                onClick={() =>
                  set("conditions")(
                    active
                      ? intake.conditions.filter((c) => c !== condition.id)
                      : [...intake.conditions, condition.id],
                  )
                }
              >
                {condition.label}
              </button>
            );
          })}
        </div>
      </fieldset>

      <p className="intake-note">
        <Icon name="shield" size={12} />
        These answers are used to route you and are not stored with your
        description. Anything urgent is flagged whether you answer them or not.
      </p>
    </section>
  );
}
