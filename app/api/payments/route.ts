/**
 * POST /api/payments — start a payment for a consultation.
 *
 * The amount is read from the appointment, never from the request body.
 */
import { created, json, withRoute } from "../../../lib/api/respond";
import { getEnv } from "../../../lib/config/env";
import { requirePatient } from "../../../lib/security/authz";
import { startPayment } from "../../../lib/services/payments";

export const dynamic = "force-dynamic";

export const POST = withRoute("POST /api/payments", async (request, { requestId }) => {
  const principal = await requirePatient(request);
  const body = await json<Record<string, unknown>>(request, 4096);

  const payment = await startPayment(principal, body, {
    requestId,
    appUrl: getEnv().APP_URL,
  });
  return created({ payment });
});
