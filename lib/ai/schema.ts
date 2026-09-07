/**
 * Niramoy — AI output validation
 * -----------------------------------------------------------------------------
 * LLM output is UNTRUSTED INPUT. It arrives from a system we do not control,
 * shaped by text a patient supplied, and it is about to influence a health
 * decision. It gets the same scrutiny as a request body.
 *
 * Concretely: parsed as JSON, validated against a schema, every enum checked
 * against a closed set, every string length-capped. Nothing model-generated is
 * ever used as an identifier, a URL, or code.
 */

import { z } from "zod";

import { SPECIALTY_HINTS, type Urgency } from "./rules";

const URGENCIES = ["emergency", "urgent", "see_doctor_soon", "routine", "self_care"] as const;

/** The specialty ids a model is permitted to name. A value outside it is
 *  discarded rather than coerced — we do not guess what it meant. */
const SPECIALTY_IDS = [...SPECIALTY_HINTS.map((h) => h.id), "general", "surgery"] as const;

export const triageOutputSchema = z.object({
  urgency: z.enum(URGENCIES),
  /** Categories, never a diagnosis. Capped so a model cannot pad the UI. */
  possible_categories: z.array(z.string().max(120)).max(5).default([]),
  specialty_id: z.enum(SPECIALTY_IDS).optional(),
  reasons: z.array(z.string().max(400)).max(5).default([]),
  red_flags: z.array(z.string().max(200)).max(10).default([]),
  recommended_next_step: z.string().max(600),
  requires_human_review: z.boolean().default(true),
});

export type TriageOutput = z.infer<typeof triageOutputSchema>;

export const visitSummarySchema = z.object({
  summary: z.string().max(4000),
  diagnosis: z.string().max(600).default(""),
  advice: z.string().max(2000).default(""),
  follow_up: z.string().max(600).default(""),
  /**
   * Medication text a model produced is captured for the doctor to READ, and is
   * never accepted as a prescription item. Prescribing happens in
   * lib/services/prescriptions.ts, which a model cannot reach (brief §13).
   */
  medications_mentioned: z.array(z.string().max(200)).max(20).default([]),
});

export type VisitSummaryOutput = z.infer<typeof visitSummarySchema>;

export interface ParseResult<T> {
  ok: boolean;
  data?: T;
  /** A short reason for the safety log. Never the model's raw output. */
  reason?: string;
}

/**
 * Parse and validate a model response.
 *
 * Every failure path returns `ok: false` rather than throwing, because the
 * caller's response to bad output is always the same — fall back to the rules —
 * and that must not depend on catching the right exception type.
 */
export function parseModelJson<T>(raw: unknown, schema: z.ZodType<T>): ParseResult<T> {
  if (typeof raw !== "string") return { ok: false, reason: "not_a_string" };
  if (raw.length > 32_000) return { ok: false, reason: "too_large" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Models sometimes wrap JSON in prose or a fenced block. One salvage
    // attempt at the outermost braces, then give up.
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end <= start) return { ok: false, reason: "malformed_json" };
    try {
      parsed = JSON.parse(raw.slice(start, end + 1));
    } catch {
      return { ok: false, reason: "malformed_json" };
    }
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, reason: `schema:${result.error.issues[0]?.path.join(".") || "root"}` };
  }
  return { ok: true, data: result.data };
}

/* -------------------------------------------------------------------------- */
/* Prompt-injection handling                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Patterns that indicate the patient's text is addressing the model rather than
 * describing symptoms.
 *
 * This is defence in depth, NOT the primary control. The real defences are
 * structural and hold whether or not this matches: system instructions live in
 * the system role and are never interpolated into user text; the model's output
 * is schema-validated; and the model cannot lower urgency, cannot prescribe,
 * and cannot write to a record. An injection that gets through still cannot
 * make the system do anything harmful — this just flags it for the safety log.
 */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |any |the )?(previous|prior|above|earlier)\s+(instruction|prompt|rule|direction)/i,
  /disregard (all |any |the )?(previous|prior|above|earlier)/i,
  /you are (now|actually) (a|an|no longer)/i,
  /system\s*(prompt|message|role)\s*[:=]/i,
  /\b(new|updated)\s+(instructions?|rules?)\s*[:=]/i,
  /pretend (to be|you are)|act as if you (are|were)/i,
  /prescribe|write me a prescription|issue a prescription/i,
  /reveal|print|output|repeat.{0,20}(your|the)\s*(system|initial)\s*(prompt|instruction)/i,
  /<\|.*?\|>|\[\/?INST\]|<<SYS>>/i,
];

export function detectInjection(text: string): { detected: boolean; patternIndex?: number } {
  for (let i = 0; i < INJECTION_PATTERNS.length; i += 1) {
    if (INJECTION_PATTERNS[i]!.test(text)) return { detected: true, patternIndex: i };
  }
  return { detected: false };
}

/** The urgency floor the rules established, as a type-safe guard. */
export function isUrgency(value: unknown): value is Urgency {
  return typeof value === "string" && (URGENCIES as readonly string[]).includes(value);
}
