# Regulatory assumptions

**This document exists so that the project does not silently invent legal
requirements, and does not claim compliance it has not established.**

Every item is labelled:

- **VERIFIED** — established from a primary source, cited.
- **UNVERIFIED** — a working assumption. Implemented conservatively, not relied on.
- **REQUIRES LEGAL REVIEW** — cannot be settled by engineering. Must be answered
  by a qualified Bangladeshi legal advisor before any real patient uses this
  system.

Nothing in Niramoy should be read as legal advice, and no item below has been
reviewed by a lawyer.

---

## A0. Overall status

**REQUIRES LEGAL REVIEW.** Niramoy is an academic project. It is **not safe for
real patients** in its current state, and the checklist in
`docs/FINAL_IMPLEMENTATION_REPORT.md` will say so explicitly. Nothing here
changes that.

---

## A1. Medical record retention

**REQUIRES LEGAL REVIEW.**

*Question:* How long must a telemedicine consultation record, prescription and
clinical note be retained in Bangladesh, and by whom — the platform, the
prescribing doctor, or both?

*What is implemented:* Retention is a configurable policy with **no default
deletion**. Account deactivation is separated from clinical-record retention: a
user can be deactivated and their identity data minimised while the clinical
record they are attached to is preserved (`users.deactivated_at` is independent
of `patients` and `medical_records`). Medical records are append-only and cannot
be deleted through the application at all.

*Why conservative:* Destroying a clinical record that law required be kept is
irreversible; keeping one longer than necessary is a privacy problem that can be
corrected later. The failure modes are not symmetric.

*Open:* the actual retention period, and whether a patient's erasure request can
ever reach a clinical record.

---

## A2. Is AI triage a regulated medical device?

**REQUIRES LEGAL REVIEW.**

*Question:* Does symptom triage that outputs an urgency level and a specialty
suggestion constitute Software as a Medical Device under any framework
Bangladesh applies or may adopt (DGDA, or an imported IMDRF/EU MDR-style
classification)?

*What is implemented, regardless of the answer:*
- A deterministic, versioned, inspectable rule engine runs **before** any model.
- Emergency red flags short-circuit to emergency advice and are **never sent to
  a model**.
- No code path can lower the urgency the rules produced — enforced in the
  service *and* by a database CHECK constraint (`ck_triage_no_downgrade`).
- Output is calibrated: categories and next steps, never "you have disease X".
- Every session records its rule-set version, provider, model and prompt version,
  so any output can be reconstructed after the fact.

*Why this is not a substitute:* A disclaimer is not a safety control. The design
above is what actually constrains behaviour; the disclaimer only informs.

*Open:* classification, and what conformity evidence would be required.

---

## A3. Remote prescribing

**REQUIRES LEGAL REVIEW.**

*Question:* May a BM&DC-registered practitioner lawfully issue a prescription
after a video-only consultation, without a prior in-person examination? What
must the prescription carry to be dispensable? Are there categories of drug that
may not be prescribed remotely?

*What is implemented:*
- Only a doctor may create a prescription. Enforced server-side and asserted by
  the security test suite.
- AI **cannot** issue a prescription. AI-generated medication text is not
  accepted into `prescription_items` at all; an AI draft lives in
  `ai_visit_summaries` until a doctor reviews and confirms it.
- Prescription items carry medicine, strength, dose, route, frequency, duration,
  quantity and instructions.

*What is deliberately NOT implemented:* **no controlled-substance handling.**
Scheduling, quantity limits and reporting for controlled drugs are not built,
and no claim is made that the system is suitable for them.

---

## A4. Data protection and cross-border transfer

**REQUIRES LEGAL REVIEW.**

*Question:* Under Bangladesh's data protection regime as currently enacted, what
lawful basis is required to process health data; is there a data-localisation
requirement; and may patient-derived text be transmitted to an LLM provider
outside Bangladesh?

*What is implemented:*
- **With no `AI_API_KEY` configured — the default — no patient text leaves the
  system at all.** The rule engine is local. This is the shipped configuration.
- When an LLM is enabled, data minimisation applies: raw symptom text is not
  retained in `ai_triage_sessions` (a hash, a length and a detected language
  are), and identifiers are not sent with it.
- `docs/AI_SAFETY.md` will document exactly what fields leave the system when
  an LLM is enabled.
- Medical records are never used for model training.

*Open:* lawful basis, consent wording, localisation, and whether a processor
agreement with an LLM provider is sufficient.

---

## A5. Video consultation modality

**UNVERIFIED — no claim made.**

Video is implemented as video. **No claim is made** that a video consultation is
legally equivalent to any particular telemedicine modality, or that it satisfies
any specific guideline's requirements for a valid consultation.

An audio/phone fallback exists for low-bandwidth users (brief §43). It is a
degradation path for connectivity, **not** an assertion that audio-only
consultation is legally interchangeable with video.

---

## A6. BM&DC verification

**VERIFIED (factual, not legal).**

*Established:*
- BM&DC operates a verification service at <https://verify.bmdc.org.bd/> that
  answers one registration number at a time, behind a captcha.
- There is no official public API and no bulk export.
- The data.gov.bd "Doctor Directory" dataset advertises 5,369 rows but serves a
  truncated file (199 rows, Rajshahi division only, last updated January 2017)
  containing doctors' personal mobile numbers.

*What is implemented:* doctor self-registration → `pending` → an admin confirms
the number by hand against the register → `verified` → the profile becomes
bookable. If `BMDC_API_URL` is configured, it is called; if it is unreachable,
the application falls back to manual review. **It never fails open.**

*What is deliberately NOT implemented:* no captcha-solving, no scraping, no
automated harvesting of the register. The captcha is an access control, and
harvesting would violate the service's terms and the privacy of practitioners
who never agreed to appear on a third-party platform.

**REQUIRES LEGAL REVIEW:** whether an admin recording the result of a manual
lookup constitutes adequate credential verification for a platform's liability
purposes, and what evidence must be retained.

---

## A7. Payments

**REQUIRES LEGAL REVIEW.**

*Question:* What Bangladesh Bank authorisation, MFS agreement or payment
aggregator licence is needed to collect consultation fees and pay out to
doctors? What tax is withheld on a doctor payout, and by whom?

*What is implemented:* a `PaymentProvider` abstraction with a **clearly-labelled
mock** as the default. Nothing is charged, no card data is stored, and the UI
says so. bKash/Nagad integration is scaffolded (webhook signature verification,
idempotency) but not connected.

---

## A8. E-signatures and prescription validity

**UNVERIFIED.**

*Question:* Is an electronically-issued prescription with a recorded doctor
identity legally valid for dispensing in Bangladesh, and does it require a
qualifying electronic signature?

*What is implemented:* every prescription records the issuing doctor, the
issuing account, and an immutable issue timestamp, and cannot be edited in place
— corrections supersede. Whether that constitutes a valid signature is not
established.

---

## A9. Emergency guidance

**UNVERIFIED — safety-critical.**

The emergency number is configurable (`EMERGENCY_NUMBER`, default `999`, the
Bangladesh national emergency line).

The red-flag list is **explicitly not claimed to be medically complete.** It is a
versioned engineering artefact covering the conditions in brief §15, and it is
documented as such everywhere it appears. It has **not** been reviewed by a
clinician, and it must be before any real patient depends on it.

**REQUIRES CLINICAL REVIEW**, which is a separate requirement from legal review
and is not satisfied by it.

---

## A10. Advertising and health claims

**UNVERIFIED.**

Doctor profiles display specialty, qualifications, experience and fees. No
outcome claims are made, and AI-assisted recommendation shows its explicit
reasons ("matches cardiology specialty", "speaks Bangla", "available today")
rather than an opaque score. Whether ranking doctors at all engages advertising
or consumer-protection rules is not established.

---

## Review log

| Date | Item | Reviewer | Outcome |
|---|---|---|---|
| — | — | — | *No item in this document has been reviewed by a qualified advisor.* |
