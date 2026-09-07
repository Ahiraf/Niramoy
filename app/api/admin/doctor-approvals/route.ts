/**
 * /api/admin/doctor-approvals — who may register as a doctor.
 *
 * An admin checks a registration number against the BM&DC register by hand and
 * records it here with the mobile number that doctor will sign up on. Nothing
 * in this file talks to the register: there is no bulk feed to query and
 * scraping the public lookup is not something this platform does, so the
 * check is a person's, and this endpoint only records that they made it.
 *
 * Admin-only throughout. An approval names a clinician and a mobile number
 * before that person has an account, which is exactly the sort of list that
 * must not be readable by whoever asks.
 */
import { created, json, ok, withRoute } from "../../../../lib/api/respond";
import { AppError } from "../../../../lib/errors";
import { normalisePhone } from "../../../../lib/auth/phone";
import { requireAdmin } from "../../../../lib/security/authz";
import { enforceRateLimit } from "../../../../lib/security/rate-limit";
import * as approvals from "../../../../lib/repositories/doctor-approvals";
import { isUniqueViolation } from "../../../../lib/db/errors";
import { audit } from "../../../../lib/audit";
import { validateRegistrationNumber } from "../../../../lib/bmdc.js";

export const dynamic = "force-dynamic";

export const GET = withRoute("GET /api/admin/doctor-approvals", async (request) => {
  await requireAdmin(request);
  return ok({ approvals: await approvals.listApprovals() });
});

export const POST = withRoute("POST /api/admin/doctor-approvals", async (request, { requestId }) => {
  const admin = await requireAdmin(request);
  await enforceRateLimit("admin-action", admin.userId);

  const body = await json<Record<string, unknown>>(request, 8192);

  const shape = validateRegistrationNumber(body.registrationNumber, body.registrationType) as {
    ok: boolean;
    normalised?: string;
    type?: string;
    reason?: string;
  };
  if (!shape.ok) {
    throw new AppError("BMDC_INVALID", { meta: { reason: shape.reason } });
  }

  const phone = normalisePhone(body.phone);
  if (!phone) {
    throw new AppError("VALIDATION_FAILED", {
      details: {
        phone: [
          "Enter the Bangladeshi mobile number this doctor will sign up with, like 01712 345678.",
        ],
      },
    });
  }

  try {
    const approval = await approvals.createApproval({
      registrationNumber: shape.normalised!,
      registrationType: shape.type!,
      phone: phone.e164,
      registerName: body.registerName ? String(body.registerName).slice(0, 200) : null,
      note: body.note ? String(body.note).slice(0, 2000) : null,
      createdByUserId: admin.userId,
    });

    await audit({
      action: "doctor.approval_create",
      actorUserId: admin.userId,
      actorRole: admin.role,
      requestId,
      resourceType: "doctor_approval",
      resourceId: approval.id,
      metadata: { registrationNumber: approval.registrationNumber },
    });

    return created({ approval });
  } catch (err) {
    // The partial unique index is the real guard against two live approvals
    // for one registration number; this check would race against itself.
    if (isUniqueViolation(err, "uq_doctor_approvals_open_number")) {
      throw new AppError("ALREADY_EXISTS", {
        message: "That registration number already has an approval waiting to be used.",
      });
    }
    throw err;
  }
});

/** PATCH — withdraw an approval that has not been used. */
export const PATCH = withRoute("PATCH /api/admin/doctor-approvals", async (request, { requestId }) => {
  const admin = await requireAdmin(request);
  await enforceRateLimit("admin-action", admin.userId);

  const body = await json<Record<string, unknown>>(request, 4096);
  const id = String(body.id ?? "");
  if (!id) throw new AppError("VALIDATION_FAILED", { details: { id: ["Which approval?"] } });

  const revoked = await approvals.revokeApproval({ id, adminUserId: admin.userId });
  if (!revoked) {
    // Either it never existed or it has already produced an account. Neither
    // is something to undo here: an account, once made, is revoked by
    // suspending the doctor, not by rewriting how they got in.
    throw new AppError("NOT_ELIGIBLE", {
      message: "That approval is not open — it has already been used or withdrawn.",
    });
  }

  await audit({
    action: "doctor.approval_revoke",
    actorUserId: admin.userId,
    actorRole: admin.role,
    requestId,
    resourceType: "doctor_approval",
    resourceId: revoked.id,
  });

  return ok({ approval: revoked });
});
