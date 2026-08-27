/**
 * POST /api/appointments/:id/video — get a join token for this consultation.
 *
 * POST rather than GET because it mints a credential and records an audit
 * event; that is not a safe, cacheable read.
 */
import { ok, withRoute } from "../../../../../lib/api/respond";
import { requireUser } from "../../../../../lib/security/authz";
import { enforceRateLimit } from "../../../../../lib/security/rate-limit";
import { getJoinGrant } from "../../../../../lib/services/video";

export const dynamic = "force-dynamic";

export const POST = withRoute(
  "POST /api/appointments/[id]/video",
  async (request, { requestId }, { params }: { params: Promise<{ id: string }> }) => {
    const principal = await requireUser(request);
    await enforceRateLimit("video-token", principal.userId);

    const { id } = await params;
    return ok({ call: await getJoinGrant(principal, id, { requestId }) });
  },
);
