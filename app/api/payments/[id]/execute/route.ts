/**
 * POST /api/payments/[id]/execute — confirm a wallet payment.
 *
 * The second half of bKash's tokenized checkout: the payer authorises on the
 * wallet's side, then the merchant asks the wallet to execute. It is a separate
 * request because that is genuinely the shape of the flow — and because the
 * status comes back from the provider, a client cannot use this endpoint to
 * declare its own payment successful.
 */
import { json, ok, withRoute } from "../../../../../lib/api/respond";
import { requirePatient } from "../../../../../lib/security/authz";
import { enforceRateLimit } from "../../../../../lib/security/rate-limit";
import { executePayment } from "../../../../../lib/services/payments";

export const dynamic = "force-dynamic";

export const POST = withRoute(
  "POST /api/payments/[id]/execute",
  async (request, { requestId }, context: { params: Promise<{ id: string }> }) => {
    const principal = await requirePatient(request);
    await enforceRateLimit("payment-execute", principal.userId);

    const { id } = await context.params;
    const body = await json<Record<string, unknown>>(request, 1024);

    const payment = await executePayment(principal, id, body, { requestId });
    return ok({ payment });
  },
);
