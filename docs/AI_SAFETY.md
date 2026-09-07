# AI safety

## Principle

**AI assists. AI does not make final clinical decisions.**

Not as a slogan — as a set of properties that are enforced in code, in the
schema, and in tests, and that hold even if a model behaves adversarially.

## The five layers

| Layer | What it does | Where |
|---|---|---|
| 1. Deterministic rules | Red flags, specialty routing, urgency | `lib/ai/rules.ts`, `lib/ai/triage.ts` |
| 2. Optional LLM | Only for non-emergencies, only when configured | `lib/ai/triage.ts` |
| 3. Output validation | Schema, closed enums, length caps | `lib/ai/schema.ts` |
| 4. Safety policy | The urgency floor | `lib/ai/triage.ts` + `ck_triage_no_downgrade` |
| 5. Human escalation | Every result routes to a doctor | services + UI |

## The two invariants

**An emergency never reaches a model.** Red-flag patterns match, emergency advice
is returned, and the patient's text is never transmitted anywhere. There is no
prompt-injection payload that can defeat a request that was never made.

**The model can raise urgency and can never lower it.** Enforced three times:
in the service (`moreSevere`), by a CHECK constraint on `ai_triage_sessions`, and
by a test that feeds a downgrade attempt through the whole path. Once is a
convention; three times is a property.

## What is NOT claimed

The rule set is a **versioned engineering artefact, not a clinical one**. It
covers the conditions the brief enumerates. It has **not been reviewed by a
clinician**, and it is not claimed to be medically complete.

Clinical review is a separate requirement from legal review and is not satisfied
by it. See `REGULATORY_ASSUMPTIONS.md` A9.

## Language

Bangla, Banglish and code-switched input are supported, and there is a test
proving it rather than a list of terms that never fire.

The prototype listed one transliterated Bangla term and used `\b` word
boundaries throughout. `\b` is defined by ASCII word characters and never
matches inside Bangla script, so **no Bangla pattern could ever have matched**,
however many were written. Substring matching is used instead — blunter, but it
works, and over-triage is the acceptable direction here.

Text is normalised for matching only: case-folded and whitespace-collapsed,
never transliterated between scripts and never translated. A lossy conversion of
a symptom description is how "chest discomfort" becomes "chest pain".

## Prompt injection

The **structural** defences are the real ones, and they hold whether or not a
pattern matches:

- System instructions live in the system role and are never interpolated into
  patient text. Patient text goes in the user role, delimited.
- Output is schema-validated against closed enums.
- The model cannot lower urgency, cannot prescribe, and cannot write to a record.

Pattern detection exists to flag attempts for the safety log. It is defence in
depth, not the control.

## Prescribing

**AI cannot prescribe.** Medication text a model produces is captured under
`medications_mentioned` for the doctor to read, and is never accepted as a
prescription item. Prescribing lives in `lib/services/prescriptions.ts`, which
requires a doctor principal and a treatment relationship, and which no AI code
path can reach.

## Visit summaries

```
consultation → notes → AI draft → doctor reviews → doctor edits → doctor confirms → record
```

A draft is never a record. `requires_review` is pinned true by a CHECK
constraint, not a default — a default can be overridden by an INSERT. The only
path to the record is `approveSummary()`, which demands a named reviewer, and
`ck_ai_summary_publish_needs_approval` refuses a published record id without an
approved status.

The resulting record is **authored by the doctor**. Their name is on it, because
they confirmed it.

## Privacy

With no model credentials configured — the default — **no patient text leaves
the system.** The rule engine is local.

When an LLM is enabled, what leaves is: the symptom text or clinical notes, and
nothing else. No name, no patient id, no appointment id, no contact details.

### More than one credential

Credentials are tried in order — three Gemini keys, then OpenAI — and the first
that answers serves the request (`lib/ai/providers.ts`). This changes *which*
provider sees the text, so it is a privacy fact as much as an availability one:
enabling the OpenAI key means that on a day when the Gemini quota is spent, the
symptom text goes to OpenAI instead of Google. Configure only the providers you
are willing to send text to.

It does not change *what* is sent, or what comes back into a clinical answer.
Every credential is called with the same prompt, and whichever one answers, the
reply goes through the same schema validation and the same urgency floor. When
all of them fail the layer reports that nothing answered, and triage keeps its
deterministic result — the chain cannot fail open, because there is no path
from "no model answered" to a clinical claim.

What is **retained**: a SHA-256 hash, a character count, and a detected language.
Not the description itself. That is enough to reproduce a safety investigation
without keeping a patient's account of their symptoms in an operational table.

Safety events carry rule ids, versions and counts — never symptom text. There
are tests asserting a name in the input appears in neither.

Medical records are never used for model training.

Cross-border transfer to an LLM provider is unresolved — `REGULATORY_ASSUMPTIONS.md` A4.

## Provenance

Every AI output records its rule-set version, provider, model, prompt version,
whether the model was invoked, whether it failed, whether its output was
rejected, and whether a downgrade was blocked. Without that, an AI-assisted
clinical record cannot be audited after the fact.

## Safety events

`safety_events` records: triage emergencies and non-emergencies, rule-engine
activations, LLM invocations, failures, rejected output, blocked downgrades,
doctor overrides, and rejected or corrected summaries. Severity 1–5.

`detail` carries identifiers and counts only, so a safety dashboard can be built
without exposing anyone's medical information.

## Evaluation

`lib/ai/__tests__/triage.test.ts` is a fixed vignette suite: emergency,
non-emergency, ambiguous, Bangla, Banglish, code-switched, paediatric,
geriatric, pregnancy, self-harm, prompt injection, malformed model output.

Writing it found two real coverage gaps — "face **is** drooping" and "throat
**is** closing" did not match patterns written as "face droop" and "throat
closing". That is what a vignette suite is for.

**What it does not do:** establish clinical adequacy. It tests the engineering.
