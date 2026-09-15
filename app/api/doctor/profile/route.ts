/**
 * /api/doctor/profile — editable fields on the signed-in doctor's profile.
 *
 * The doctor id comes from the session's own profile. A request cannot name a
 * different doctor, so this endpoint cannot be used to alter somebody else's
 * public consultation fee.
 */
import { json, ok, withRoute } from "../../../../lib/api/respond";
import { AppError } from "../../../../lib/errors";
import * as directory from "../../../../lib/repositories/doctors";
import { requireVerifiedDoctor } from "../../../../lib/security/authz";
import { audit } from "../../../../lib/audit";

export const dynamic = "force-dynamic";

function parseFee(value: unknown): string {
  const raw = String(value ?? "").trim();

  // PostgreSQL numeric(10, 2) accepts at most eight whole-number digits. Keep
  // the same limit at the API boundary and reject exponent notation so the
  // value stored and displayed is always predictable.
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(raw) || Number(raw) > 99_999_999.99) {
    throw new AppError("VALIDATION_FAILED", {
      details: { fee: ["Enter a consultation fee from ৳ 0 to ৳ 99,999,999.99."] },
    });
  }

  return Number(raw).toFixed(2);
}

export const PATCH = withRoute("PATCH /api/doctor/profile", async (request, { requestId }) => {
  const profile = await requireVerifiedDoctor(request);
  const body = await json<Record<string, unknown>>(request, 8192);
  const feeAmount = parseFee(body.fee ?? body.feeAmount);

  const updated = await directory.updateFee(profile.id, feeAmount);
  if (!updated) throw new AppError("NOT_FOUND");

  const doctor = await directory.getDoctor(profile.id);
  if (!doctor) throw new AppError("NOT_FOUND");

  await audit({
    action: "profile.update",
    actorUserId: profile.userId,
    actorRole: "doctor",
    requestId,
    resourceType: "doctor",
    resourceId: profile.id,
    metadata: { fields: ["feeAmount"] },
  });

  return ok({ doctor });
});
