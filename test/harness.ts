/**
 * Route-level test harness.
 *
 * Calls the real exported handlers with real Request objects against a real
 * database. Nothing is mocked, because the properties under test — "is this
 * query scoped to the session?" — live in the SQL and the authorization
 * helpers, not in anything a mock would stand in for.
 */
import { __setTestDatabase, type Database } from "../lib/db/client";
import { buildWorld, type World } from "./fixtures";

export interface RouteResponse<T = Record<string, unknown>> {
  status: number;
  body: T & { ok?: boolean; error?: { code: string; message: string }; reason?: string };
}

export async function call<T = Record<string, unknown>>(
  handler: (request: Request, ...args: never[]) => Promise<Response>,
  request: Request,
  ...args: unknown[]
): Promise<RouteResponse<T>> {
  const response = await handler(request, ...(args as never[]));
  let body: unknown = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  return { status: response.status, body: body as RouteResponse<T>["body"] };
}

/** Route params, which Next passes as a promise in App Router. */
export const params = (values: Record<string, string>) => ({
  params: Promise.resolve(values),
});

export async function setupWorld(): Promise<World> {
  const world = await buildWorld();
  // The PGlite and node-postgres builders differ only in their result-row
  // wrapper type; the query surface the repositories use is identical. See the
  // note on `Database` in lib/db/client.ts.
  __setTestDatabase(world.h.db as unknown as Database);
  return world;
}

export async function teardownWorld(world: World): Promise<void> {
  __setTestDatabase(undefined);
  await world.h.close();
}
