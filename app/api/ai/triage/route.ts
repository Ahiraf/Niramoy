/**
 * POST /api/ai/triage
 *
 * Rate limited per caller: each request may cost inference money, so an
 * unbounded triage endpoint is a billing denial-of-service as well as an abuse
 * surface. Anonymous callers are limited by IP — triage should be reachable
 * without an account, since someone frightened at 2am should not have to sign up
 * first.
 */
import { json, ok, withRoute } from "../../../../lib/api/respond";
import { getEnv } from "../../../../lib/config/env";
import { AppError } from "../../../../lib/errors";
import * as directory from "../../../../lib/repositories/doctors";
import { clientIp, getPrincipal } from "../../../../lib/security/authz";
import { enforceRateLimit } from "../../../../lib/security/rate-limit";
import { matchDoctors, runTriage } from "../../../../lib/services/ai";
import { MAX_INPUT_CHARS } from "../../../../lib/ai/triage";
import {
  AGE_BANDS, CONDITIONS, DURATION_BANDS, SEVERITY_BANDS, type Intake,
} from "../../../../lib/ai/rules";

export const dynamic = "force-dynamic";

/**
 * The optional intake answers, reduced to the closed vocabulary the rules
 * understand.
 *
 * Anything unrecognised is dropped rather than rejected: these are optional
 * questions, and failing a triage request — the thing someone frightened at 2am
 * is trying to do — because a client sent an unknown age band would be the
 * wrong trade. What must not happen is an unvalidated value reaching the rule
 * engine or the model prompt, and that is what this prevents.
 */
function readIntake(raw: unknown): Intake {
  if (!raw || typeof raw !== "object") return {};
  const input = raw as Record<string, unknown>;

  const pick = <T extends string>(value: unknown, allowed: readonly T[]): T | null => {
    const candidate = String(value ?? "");
    return (allowed as readonly string[]).includes(candidate) ? (candidate as T) : null;
  };

  const conditions = Array.isArray(input.conditions)
    ? [...new Set(input.conditions.map(String))].filter((c) =>
        (CONDITIONS as readonly string[]).includes(c),
      )
    : [];

  return {
    ageBand: pick(input.ageBand, AGE_BANDS),
    durationBand: pick(input.durationBand, DURATION_BANDS),
    severity: pick(input.severity, SEVERITY_BANDS),
    // Only an explicit true is a claim. Undefined means "not answered", which
    // is not the same as "no" and must not be recorded as one.
    pregnant: input.pregnant === true ? true : null,
    conditions,
    language: pick(input.language, ["bn", "en"] as const),
  };
}

export const POST = withRoute("POST /api/ai/triage", async (request, { requestId }) => {
  const principal = await getPrincipal(request);
  await enforceRateLimit("ai-triage", principal?.userId ?? clientIp(request) ?? "unknown");

  const body = await json<Record<string, unknown>>(request, 16 * 1024);
  const message = String(body.message ?? "");

  if (message.length > MAX_INPUT_CHARS) {
    throw new AppError("INPUT_TOO_LARGE", {
      message: "Please describe your symptoms more briefly.",
    });
  }

  const { result, sessionId } = await runTriage(principal, message, {
    requestId,
    intake: readIntake(body.intake),
  });

  /**
   * An emergency gets advice, not a booking funnel. Showing a list of
   * bookable appointments to someone describing a heart attack is an
   * invitation to wait, which is the harm the red-flag path exists to prevent.
   */
  const matches = result.redFlag
    ? []
    : matchDoctors(
        result,
        (await directory.searchDoctors({ sort: "best", perPage: 40 })).doctors,
        {
          district: body.district ? String(body.district) : null,
          division: body.division ? String(body.division) : null,
          ...(body.maxFee ? { maxFee: Number(body.maxFee) } : {}),
        },
      );

  return ok({
    sessionId,
    triage: {
      urgency: result.urgency,
      urgencyLabel: result.urgencyLabel,
      specialtyId: result.specialtyId,
      reasoning: result.reasons.join(" "),
      reasons: result.reasons,
      possibleCategories: result.possibleCategories,
      recommendedNextStep: result.recommendedNextStep,
      redFlag: result.redFlag,
      disclaimer: result.disclaimer,
      requiresHumanReview: result.requiresHumanReview,
      source: result.source,
      isChild: result.isChild,
    },
    reply: result.redFlag
      ? `${result.reasons[0]} ${result.recommendedNextStep}`
      : `${result.reasons.join(" ")} I've marked this as "${result.urgencyLabel.toLowerCase()}" ` +
        `and pulled up matching doctors below. Remember I can't diagnose — a doctor still needs ` +
        `to confirm this.`,
    matches,
    emergencyNumber: getEnv().EMERGENCY_NUMBER,
  });
});
