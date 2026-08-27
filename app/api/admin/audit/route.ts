/**
 * GET /api/admin/audit — the audit trail.
 *
 * Read-only by construction: the table rejects UPDATE and DELETE at the
 * database, so there is no write path to expose here even if someone added one.
 * Rows carry actors, resources and outcomes — never clinical content.
 */
import { ok, query, withRoute } from "../../../../lib/api/respond";
import { requireAdmin } from "../../../../lib/security/authz";
import { adminAuditLog, adminSafetyEvents } from "../../../../lib/repositories/admin";

export const dynamic = "force-dynamic";

export const GET = withRoute("GET /api/admin/audit", async (request) => {
  await requireAdmin(request);
  const q = query(request);

  const [entries, safetyEvents] = await Promise.all([
    adminAuditLog({ action: q.action, limit: Number(q.limit ?? 100) }),
    adminSafetyEvents({ limit: 50 }),
  ]);

  return ok({ entries, safetyEvents });
});
