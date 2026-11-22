/**
 * POST|GET /api/payments/return/[outcome] — where the gateway sends the payer back.
 *
 * SSLCommerz redirects the BROWSER here (as a form POST) after the payer is
 * done on its hosted page, with `success`, `fail` or `cancel` in the path.
 *
 * Two things this endpoint deliberately does not do:
 *
 *   - It does not believe the outcome in the URL. Anyone can open
 *     /api/payments/return/success in a tab. The path only decides where the
 *     payer is sent next; whether the payment settled is decided by a
 *     server-to-server validation call using the gateway validation or
 *     transaction reference.
 *   - It does not require a session. The payer is arriving mid-redirect from a
 *     third party, and their cookies may not survive a cross-site POST. There
 *     is nothing here worth protecting with one: the endpoint reveals nothing
 *     and can only ever cause a validated settlement.
 *
 * It always ends in a redirect, never JSON — a human is looking at this.
 */
import { NextResponse } from "next/server";

import { withRoute } from "../../../../../lib/api/respond";
import { getEnv } from "../../../../../lib/config/env";
import { logger } from "../../../../../lib/observability/logger";
import { settleFromReturn } from "../../../../../lib/services/payments";

export const dynamic = "force-dynamic";

const OUTCOMES = new Set(["success", "fail", "cancel"]);

/** Gateways post form-encoded; some configurations send the payer back by GET. */
async function readGatewayReferences(request: Request): Promise<{ valId: string | null; providerPaymentId: string | null }> {
  const query = new URL(request.url).searchParams;
  let valId = query.get("val_id");
  let providerPaymentId = query.get("tran_id");
  if (request.method !== "POST") return { valId, providerPaymentId };
  try {
    const body = new URLSearchParams(await request.text());
    valId ??= body.get("val_id");
    providerPaymentId ??= body.get("tran_id");
  } catch {
    // With no readable form body, only query values can be verified.
  }
  return { valId, providerPaymentId };
}

async function handle(
  request: Request,
  requestId: string | undefined,
  context: { params: Promise<{ outcome: string }> },
): Promise<Response> {
  const { outcome } = await context.params;
  /*
   * The workspace is a single client-rendered page at "/" whose views are React
   * state, not routes — there is no /appointments URL to land on. The query
   * param is the handoff: the page reads it on mount, opens the appointments
   * view and reports the outcome, then strips it from the address bar so a
   * refresh does not re-announce a payment.
   */
  const destination = new URL("/", getEnv().APP_URL);

  if (!OUTCOMES.has(outcome)) return NextResponse.redirect(destination, 303);

  if (outcome !== "success") {
    // Nothing to validate: the payer backed out, or the gateway declined. The
    // appointment is still booked, and the page it lands on says so.
    destination.searchParams.set("payment", outcome);
    return NextResponse.redirect(destination, 303);
  }

  const references = await readGatewayReferences(request);
  if (!references.valId && !references.providerPaymentId) {
    // A success return carrying no gateway reference is not a success. Most likely
    // someone opened the URL by hand.
    logger.warn("payment return claimed success with no gateway reference", { requestId });
    destination.searchParams.set("payment", "unconfirmed");
    return NextResponse.redirect(destination, 303);
  }

  const result = await settleFromReturn(references, { requestId });

  // `duplicate_event` means the IPN got here first and already settled it,
  // which is a success from the payer's point of view rather than a problem.
  const settled = result.handled || result.reason === "duplicate_event";
  destination.searchParams.set("payment", settled ? "success" : "unconfirmed");
  return NextResponse.redirect(destination, 303);
}

export const POST = withRoute(
  "POST /api/payments/return/[outcome]",
  async (request, { requestId }, context: { params: Promise<{ outcome: string }> }) =>
    handle(request, requestId, context),
);

export const GET = withRoute(
  "GET /api/payments/return/[outcome]",
  async (request, { requestId }, context: { params: Promise<{ outcome: string }> }) =>
    handle(request, requestId, context),
);
