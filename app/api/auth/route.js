import { SESSION_COOKIE, destroySession, publicUser } from "../../../lib/auth.js";
import { boot, ok, cookie, sessionUser } from "../_lib.js";

export const dynamic = "force-dynamic";

/** GET /api/auth — who am I? Returns `{ user: null }` when signed out. */
export async function GET(request) {
  boot();
  return ok({ user: publicUser(sessionUser(request)) });
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
