/**
 * The code at the front of sign-up.
 *
 * This is the only endpoint in the application an anonymous caller can use to
 * make a real SMS reach a stranger's handset, and the only place a number is
 * proved before there is an account to attach it to. The properties that matter
 * are therefore about what CANNOT happen:
 *
 *   - no account exists until the code comes back;
 *   - a verification cannot be ridden by a browser that did not earn it;
 *   - a ticket works once, for one number;
 *   - nobody can be texted repeatedly, whatever address the requests come from.
 */
import { eq } from "drizzle-orm";

import { POST as register } from "../../app/api/auth/register/route";
import { PATCH as confirmOtp, POST as sendOtp } from "../../app/api/auth/signup-otp/route";
import { resetEnvCache } from "../../lib/config/env";
import * as t from "../../lib/db/schema";
import { resetSmsProvider } from "../../lib/notifications/sms";
import { setupWorld, teardownWorld, call } from "../harness";
import type { World } from "../fixtures";

let world: World;
let sent: string[] = [];
const realFetch = globalThis.fetch;

const PHONE = "01712345678";
const E164 = "+8801712345678";

const lastCode = () => /(\d{6})/.exec(sent.at(-1) ?? "")?.[1] ?? "";

/** Anonymous: no session cookie, no CSRF header, only an origin. */
const anon = (url: string, body: unknown, method: string) =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify(body),
  });

const send = (phone: string = PHONE) =>
  call(sendOtp, anon("http://localhost:3000/api/auth/signup-otp", { phone }, "POST"));

const confirm = (code: string, phone: string = PHONE) =>
  call<{ phoneVerification: { ticket: string; phone: string } }>(
    confirmOtp,
    anon("http://localhost:3000/api/auth/signup-otp", { phone, code }, "PATCH"),
  );

const signUp = (extra: Record<string, unknown>) =>
  call(
    register,
    anon(
      "http://localhost:3000/api/auth/register",
      {
        name: "Nabila Begum",
        email: `nabila-${Math.random().toString(36).slice(2, 8)}@example.com`,
        password: "correct-horse-9",
        role: "patient",
        phone: PHONE,
        ...extra,
      },
      "POST",
    ),
  );

const verifiedTicket = async (): Promise<string> => {
  await send();
  const res = await confirm(lastCode());
  return res.body.phoneVerification.ticket;
};

beforeEach(async () => {
  world = await setupWorld();
  sent = [];

  process.env.SMS_PROVIDER = "textbee";
  process.env.TEXTBEE_API_KEY = "test-gateway-key";
  process.env.TEXTBEE_BASE_URL = "https://sms.invalid/api/v1";
  resetEnvCache();
  resetSmsProvider();

  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { message?: string };
    sent.push(body.message ?? "");
    return Response.json({ data: { smsBatchId: "batch-1" } });
  }) as typeof fetch;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete process.env.SMS_PROVIDER;
  delete process.env.TEXTBEE_API_KEY;
  delete process.env.TEXTBEE_BASE_URL;
  resetEnvCache();
  resetSmsProvider();
  await teardownWorld(world);
});

const usersNamed = async (email: string) =>
  world.h.db.select({ id: t.users.id }).from(t.users).where(eq(t.users.email, email));

/* -------------------------------------------------------------------------- */

describe("sending the code", () => {
  it("texts the number without creating anything", async () => {
    const res = await send();

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(res.body.phoneVerification).toMatchObject({
      phone: "01712••••78",
      expiresInSeconds: 300,
      delivered: true,
    });

    // Nothing to clean up if the person walks away here.
    const { rows } = await world.h.client.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM users WHERE phone = $1",
      [E164],
    );
    expect(rows[0]!.n).toBe(0);
  });

  it("never returns the code", async () => {
    const res = await send();
    expect(JSON.stringify(res.body)).not.toContain(lastCode());
  });

  it("refuses a number no Bangladeshi network could deliver to", async () => {
    const res = await send("+14155550123");
    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("will not text one number more than three times an hour", async () => {
    await send();
    await send();
    await send();
    expect((await send()).status).toBe(429);
    expect(sent).toHaveLength(3);
  });
});

describe("confirming the code", () => {
  it("returns a ticket for the right code", async () => {
    await send();
    const res = await confirm(lastCode());

    expect(res.status).toBe(200);
    expect(res.body.phoneVerification.phone).toBe("01712••••78");
    expect(res.body.phoneVerification.ticket).toEqual(expect.any(String));
  });

  it("burns the code after five wrong guesses", async () => {
    await send();
    const right = lastCode();
    const wrong = right === "000000" ? "111111" : "000000";

    for (let i = 0; i < 5; i += 1) expect((await confirm(wrong)).status).toBe(400);

    // The code died; the number is not locked and a new one can be sent.
    expect((await confirm(right)).status).toBe(422);
    expect((await send()).status).toBe(200);
  });

  it("says the same thing for an expired code and one that never existed", async () => {
    const never = await confirm("123456");
    expect(never.status).toBe(422);
    expect(never.body.error?.message).toMatch(/expired/i);
  });
});

describe("registering with the ticket", () => {
  it("creates an account whose number is already proved", async () => {
    const ticket = await verifiedTicket();
    const email = `nabila-${Date.now()}@example.com`;

    const res = await signUp({ email, verificationTicket: ticket });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ phone: E164, phoneVerified: true });
    // No second code: the number was proved before the account existed.
    expect(sent).toHaveLength(1);
    expect(res.body.phoneVerification).toBeNull();
  });

  it("refuses a sign-up with no ticket", async () => {
    const email = `no-ticket-${Date.now()}@example.com`;
    const res = await signUp({ email });

    expect(res.status).toBe(422);
    expect(await usersNamed(email)).toHaveLength(0);
  });

  it("refuses a ticket issued for a different number", async () => {
    const ticket = await verifiedTicket();
    const email = `other-number-${Date.now()}@example.com`;

    const res = await signUp({ email, phone: "01812345678", verificationTicket: ticket });

    expect(res.status).toBe(422);
    expect(await usersNamed(email)).toHaveLength(0);
  });

  it("spends a ticket exactly once", async () => {
    const ticket = await verifiedTicket();
    const first = `first-${Date.now()}@example.com`;
    const second = `second-${Date.now()}@example.com`;

    expect((await signUp({ email: first, verificationTicket: ticket })).status).toBe(201);

    const replay = await signUp({ email: second, verificationTicket: ticket });
    expect(replay.status).toBe(422);
    expect(await usersNamed(second)).toHaveLength(0);
  });

  it("refuses a forged ticket", async () => {
    await send();
    await confirm(lastCode());
    const email = `forged-${Date.now()}@example.com`;

    const res = await signUp({ email, verificationTicket: "not-a-real-ticket" });

    expect(res.status).toBe(422);
    expect(await usersNamed(email)).toHaveLength(0);
  });
});
