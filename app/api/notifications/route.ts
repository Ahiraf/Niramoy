/**
 * /api/notifications — the in-app bell.
 *
 * Scoped to the session's user. The prototype accepted `?userId=` and preferred
 * it over the session, so anyone could read anyone's notifications — which leak
 * doctor names, appointment times and prescription events (finding S1).
 */
import { json, ok, withRoute } from "../../../lib/api/respond";
import * as clinical from "../../../lib/repositories/clinical";
import { requireUser } from "../../../lib/security/authz";

export const dynamic = "force-dynamic";

export const GET = withRoute("GET /api/notifications", async (request) => {
  const principal = await requireUser(request);
  const notifications = await clinical.listNotifications(principal.userId);
  return ok({ notifications, unread: notifications.filter((n) => !n.read).length });
});

export const POST = withRoute("POST /api/notifications", async (request) => {
  const principal = await requireUser(request);
  await json(request, 1024); // drain the body; nothing in it is used
  const marked = await clinical.markNotificationsRead(principal.userId);
  return ok({ marked });
});
