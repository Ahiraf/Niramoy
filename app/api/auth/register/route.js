import { registerUser, createSession, publicUser } from "../../../../lib/auth.js";
import { validateRegistrationNumber } from "../../../../lib/bmdc.js";
import { boot, ok, sessionCookie, explain } from "../../_lib.js";

export const dynamic = "force-dynamic";

const BMDC_STATUS = 422;

/**
 * POST /api/auth/register — { name, email, phone, password, role, ... }
 *
 * Doctors additionally send their BM&DC number so it can be shape-checked at
 * sign-up; the account is created straight away but stays unverified until the
 * doctor completes the application form and an admin confirms the number.
 * Admins must supply the staff invite code.
 */
export async function POST(request) {
  boot();
  const body = await request.json().catch(() => ({}));

  // Fail on a malformed registration number before creating anything.
  if (body.role === "doctor" && body.bmdcNumber) {
    const shape = validateRegistrationNumber(body.bmdcNumber, body.registrationType);
    if (!shape.ok) {
      return Response.json({ ok: false, reason: `bmdc_${shape.reason}` }, { status: BMDC_STATUS });
    }
    body.bmdcNumber = shape.normalised;
    body.registrationType = shape.type;
  }

  const result = registerUser(body);
  if (!result.ok) {
    return Response.json(
      { ok: false, reason: result.reason, message: explain(result.reason) },
      { status: result.reason === "email_taken" ? 409 : 400 }
    );
  }

  // Carry the sign-up details through to the BM&DC application form.
  if (result.user.role === "doctor") {
    result.user.pendingApplication = {
      bmdcNumber: body.bmdcNumber ?? "",
      registrationType: body.registrationType ?? "mbbs",
      specialty: body.specialty ?? "",
    };
  }

  const session = createSession(result.user.id);
  return ok(
    {
      user: publicUser(result.user),
      draft: result.user.pendingApplication ?? null,
    },
    { status: 201, headers: { "Set-Cookie": sessionCookie(session) } }
  );
}
