import { z } from "zod";
import { created, json, ok, withRoute } from "../../../lib/api/respond";
import { requireUser } from "../../../lib/security/authz";
import { enforceRateLimit } from "../../../lib/security/rate-limit";
import { audit } from "../../../lib/audit";
import { AppError } from "../../../lib/errors";
import * as messaging from "../../../lib/services/messaging";

export const dynamic = "force-dynamic";
const uuid = z.string().uuid();
function validate<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new AppError("VALIDATION_FAILED", { message: "Check the conversation and enter a message of 1–2000 characters." });
  return parsed.data;
}
const privateHeaders = { "Cache-Control": "private, no-store" };

export const GET = withRoute("GET /api/messages", async (request, { requestId }) => {
  const principal = await requireUser(request);
  const query = new URL(request.url).searchParams;
  const id = query.get("appointmentId");
  if (!id) return ok({ conversations: await messaging.inbox(principal) }, { headers: privateHeaders });
  const appointmentId = validate(uuid, id);
  const before = query.has("before") ? validate(uuid, query.get("before")) : undefined;
  const result = await messaging.history(principal, appointmentId, before);
  await audit({ action: "care_message.read", actorUserId: principal.userId, actorRole: principal.role,
    requestId, resourceType: "appointment", resourceId: appointmentId });
  return ok(result, { headers: privateHeaders });
});

export const POST = withRoute("POST /api/messages", async (request, { requestId }) => {
  const principal = await requireUser(request);
  const input = validate(z.object({ appointmentId: uuid, clientId: uuid, body: z.string().trim().min(1).max(2000) })
    .strict(), await json(request, 16384));
  await enforceRateLimit("care-message", principal.userId);
  const message = await messaging.send(principal, input);
  await audit({ action: "care_message.send", actorUserId: principal.userId, actorRole: principal.role,
    requestId, resourceType: "appointment", resourceId: input.appointmentId });
  return created({ message });
});

export const PATCH = withRoute("PATCH /api/messages", async (request) => {
  const principal = await requireUser(request);
  const input = validate(z.object({ appointmentId: uuid, ids: z.array(uuid).min(1).max(50) }).strict(),
    await json(request, 8192));
  await messaging.markRead(principal, input.appointmentId, input.ids);
  return ok({ read: true });
});
