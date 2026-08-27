/**
 * POST /api/auth/verify-email — consume an email verification token.
 */
import { json, ok, withRoute } from "../../../../lib/api/respond";
import { verifyEmail } from "../../../../lib/services/auth";

export const dynamic = "force-dynamic";

export const POST = withRoute("POST /api/auth/verify-email", async (request, { requestId }) => {
  const body = await json<{ token?: unknown }>(request, 2048);
  await verifyEmail(body.token, { requestId });
  return ok({ message: "Your email address is confirmed." });
});
