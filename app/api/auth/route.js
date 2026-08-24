import { SESSION_COOKIE, destroySession, publicUser, updateProfile } from "../../../lib/auth.js";
import { boot, ok, fail, cookie, sessionUser, explain } from "../_lib.js";

export const dynamic = "force-dynamic";

/** GET /api/auth — who am I? Returns `{ user: null }` when signed out. */
export async function GET(request) {
  boot();
  return ok({ user: publicUser(sessionUser(request)) });
}

/** PATCH /api/auth — edit your own profile. Never anyone else's. */
export async function PATCH(request) {
  boot();
  const me = sessionUser(request);
  if (!me) return fail("unauthenticated", 401);

  const body = await request.json().catch(() => ({}));
  const result = updateProfile(me.id, {
    name: body.name,
    phone: body.phone,
    district: body.district,
    division: body.division,
  });

  if (!result.ok) {
    return Response.json(
      { ok: false, reason: result.reason, message: explain(result.reason) },
      { status: 400 }
    );
  }
  return ok({ user: publicUser(result.user) });
}

/** DELETE /api/auth — sign out and clear the cookie. */
export async function DELETE(request) {
  boot();
  destroySession(cookie(request, SESSION_COOKIE));
  return Response.json(
    { ok: true },
    { headers: { "Set-Cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } }
  );
}
