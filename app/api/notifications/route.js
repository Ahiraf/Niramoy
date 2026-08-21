import { listNotifications, markNotificationsRead, CURRENT_PATIENT } from "../../../lib/store.js";
import { boot, ok, query } from "../_lib.js";

export const dynamic = "force-dynamic";

/** GET /api/notifications */
export async function GET(request) {
  boot();
  const userId = query(request).userId ?? CURRENT_PATIENT.id;
  const notifications = listNotifications(userId);
  return ok({ notifications, unread: notifications.filter((n) => !n.read).length });
}

/** POST /api/notifications — mark all read. */
export async function POST(request) {
  boot();
  const body = await request.json().catch(() => ({}));
  return ok(markNotificationsRead(body.userId ?? CURRENT_PATIENT.id));
}
