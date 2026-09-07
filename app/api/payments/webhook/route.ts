/**
 * POST /api/payments/webhook — provider callback.
 *
 * Deliberately NOT behind session auth: the caller is a payment gateway, not a
 * user. Its signature is the credential, and it is verified before anything in
 * the body is believed.
 *
 * The raw body text is read before parsing, because the signature is computed
 * over the exact bytes — re-serialising parsed JSON would change them.
 */
import { ok, withRoute } from "../../../../lib/api/respond";
import { AppError } from "../../../../lib/errors";
import { handleWebhook } from "../../../../lib/services/payments";

export const dynamic = "force-dynamic";

const MAX_WEBHOOK_BYTES = 64 * 1024;

export const POST = withRoute("POST /api/payments/webhook", async (request, { requestId }) => {
  const rawBody = await request.text();
  if (rawBody.length > MAX_WEBHOOK_BYTES) throw new AppError("INPUT_TOO_LARGE");

  const result = await handleWebhook(rawBody, request.headers, { requestId });

  // 200 even for a duplicate or unknown payment: the gateway has delivered it
  // correctly and should stop retrying. Only a signature failure is an error.
  return ok(result);
});
