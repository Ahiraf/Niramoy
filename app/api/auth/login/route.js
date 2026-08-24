import { authenticate, createSession, publicUser } from "../../../../lib/auth.js";
import { boot, ok, sessionCookie, explain } from "../../_lib.js";

export const dynamic = "force-dynamic";

/** POST /api/auth/login — { email, password, role? } */
export async function POST(request) {
  boot();
  const body = await request.json().catch(() => ({}));

  const result = authenticate({
    email: body.email,
    password: body.password,
    role: body.role,
  });

  if (!result.ok) {
    return Response.json(
      { ok: false, reason: result.reason, message: explain(result.reason), actualRole: result.actualRole },
      { status: 401 }
    );
  }

  const session = createSession(result.user.id);
  return ok(
    { user: publicUser(result.user) },
    { headers: { "Set-Cookie": sessionCookie(session) } }
  );
}
