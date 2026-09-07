# Clinical safety

## Status

**This system has not been reviewed by a clinician, and is not safe for real
patients.** Everything below describes engineering controls. Engineering
controls are necessary and are not sufficient.

## Controls that are implemented

| Control | Mechanism |
|---|---|
| Emergencies never reach a model | Rules run first; on a red flag the text is never transmitted |
| AI cannot lower urgency | Service floor + `ck_triage_no_downgrade` + a test |
| AI cannot prescribe | Prescribing requires a doctor principal and a treatment relationship |
| AI cannot write to a record | Only `approveSummary()` can, and it demands a named reviewer |
| A summary cannot claim to need no review | `ck_ai_summary_requires_review` |
| Only verified doctors are bookable | One definition, in the repository; enforced by `ck_doctors_verified_has_evidence` |
| Clinical history cannot be rewritten | Trigger freezes content; corrections are amendments |
| Double-booking is impossible | `btree_gist` exclusion constraint |
| A patient cannot be in two consultations at once | A second exclusion constraint |

## Escalation

Every triage result routes to a human. An emergency result deliberately offers
**no booking options** — showing a list of appointments to someone describing a
heart attack is an invitation to wait, which is the harm the red-flag path
exists to prevent. It shows the emergency number instead.

## The disclaimer is not the control

The UI states that triage is assistive and not a diagnosis. That is necessary
and it is **not** a safety mechanism. What constrains behaviour is the layered
architecture: the rules, the floor, the schema constraints, the human approval
step. A disclaimer informs; it does not prevent.

## Monitoring

`safety_events` records every triage emergency, rule activation, LLM invocation,
failure, rejected output, blocked downgrade, doctor override, and rejected or
corrected summary, with severity 1–5. `/api/admin/audit` surfaces them.

Signals worth watching:

- **Blocked downgrades** rising — the model is systematically under-triaging.
- **Corrected summaries** rising — drafts are not fit for purpose.
- **Rejected output** rising — the model or the prompt has drifted.
- **Emergency rate** moving sharply — either a real event, or a rule regression.

## Known clinical gaps

1. **The rule set has not been clinically reviewed.** It is versioned
   engineering work covering the conditions the brief enumerates. It is not
   claimed to be complete, and completeness is not something engineering can
   assert.
2. **No paediatric dosing or weight-based logic.** Vulnerable-group markers
   raise the urgency floor; they do not adjust anything clinical.
3. **No drug interaction checking.** Prescriptions are recorded, not validated.
4. **No allergy checking.** There is no structured allergy field.
5. **No controlled-substance handling.** Deliberately absent, and no claim is
   made that the system is suitable for it.
6. **Triage sensitivity is unmeasured.** No vignette set with clinician-assigned
   ground truth exists, so the false-negative rate for emergent conditions is
   unknown. This is the single most important missing measurement.

## What a clinical review should cover

- Red-flag completeness for the Bangladesh disease burden — dengue, typhoid,
  tuberculosis and obstetric emergencies are all common and only partially
  covered.
- Whether the Bangla and Banglish surface forms match how patients actually
  describe symptoms, which is a question for people who hear it daily.
- Whether `requiresReview` is a real control or becomes a rubber stamp in
  practice under time pressure.
- Target sensitivity for emergent conditions, and an acceptable over-triage rate
  to buy it.
