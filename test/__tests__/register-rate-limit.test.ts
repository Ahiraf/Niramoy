/**
 * What the sign-up limit is counting.
 *
 * `register:ip` exists to stop one address creating accounts in bulk. It is
 * not a typing test: an attempt rejected for a short password creates nothing,
 * costs nothing, and must not spend the address's allowance — five slips in a
 * row used to lock everyone behind that address out for the rest of the hour,
 * which on a Bangladeshi mobile network can be a great many real people. So
 * the bucket is charged for accounts made, and these tests pin both halves of
 * that: rejections are free, and successes still count.
 */
import { POST as register } from "../../app/api/auth/register/route";
import { PATCH as confirmOtp, POST as sendOtp } from "../../app/api/auth/signup-otp/route";
import { RATE_LIMITS } from "../../lib/security/rate-limit";
import { resetEnvCache } from "../../lib/config/env";
import { resetSmsProvider } from "../../lib/notifications/sms";
import { setupWorld, teardownWorld, call } from "../harness";
import type { World } from "../fixtures";

let world: World;
let sent: string[] = [];
const realFetch = globalThis.fetch;

const LIMIT = RATE_LIMITS["register:ip"].limit;

const anon = (url: string, body: unknown, method: string) =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify(body),
  });

const lastCode = () => /(\d{6})/.exec(sent.at(-1) ?? "")?.[1] ?? "";

/** A fresh proved number, since a ticket is good for one sign-up only. */
const verifiedTicket = async (phone: string): Promise<string> => {
  await call(sendOtp, anon("http://localhost:3000/api/auth/signup-otp", { phone }, "POST"));
  const res = await call<{ phoneVerification: { ticket: string } }>(
    confirmOtp,
    anon("http://localhost:3000/api/auth/signup-otp", { phone, code: lastCode() }, "PATCH"),
  );
  return res.body.phoneVerification.ticket;
};

const signUp = <T = Record<string, unknown>>(extra: Record<string, unknown>) =>
  call<T>(
    register,
    anon(
      "http://localhost:3000/api/auth/register",
      {
        name: "Nabila Begum",
        email: `nabila-${Math.random().toString(36).slice(2, 10)}@example.com`,
        password: "correct-horse-9",
        role: "patient",
        ...extra,
      },
      "POST",
    ),
  );

/** The nth distinct Bangladeshi number, so each sign-up gets its own ticket. */
const phoneNo = (n: number) => `018812${String(n).padStart(5, "0")}`;

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

/* -------------------------------------------------------------------------- */

describe("the sign-up limit counts accounts, not attempts", () => {
  it("does not spend the allowance on attempts that fail validation", async () => {
    // Comfortably more slips than the limit, none of which creates anything.
    for (let i = 0; i < LIMIT + 3; i += 1) {
      const res = await signUp({ password: "short", phone: phoneNo(1) });
      expect(res.status).toBe(400);
    }

    // The address must still be able to sign up for real afterwards.
    const ticket = await verifiedTicket(phoneNo(1));
    const res = await signUp({ phone: phoneNo(1), verificationTicket: ticket });

    expect(res.status).toBe(201);
  });

  it("still stops one address creating accounts in bulk", async () => {
    for (let i = 0; i < LIMIT; i += 1) {
      const phone = phoneNo(i + 10);
      const res = await signUp({ phone, verificationTicket: await verifiedTicket(phone) });
      expect(res.status).toBe(201);
    }

    const phone = phoneNo(99);
    const res = await signUp({ phone, verificationTicket: await verifiedTicket(phone) });

    expect(res.status).toBe(429);
  });

  it("says how long the wait actually is", async () => {
    for (let i = 0; i < LIMIT; i += 1) {
      const phone = phoneNo(i + 30);
      await signUp({ phone, verificationTicket: await verifiedTicket(phone) });
    }

    const phone = phoneNo(98);
    const res = await signUp<{ message: string }>({
      phone,
      verificationTicket: await verifiedTicket(phone),
    });

    // "Wait a moment" would be false for a window measured in tens of minutes.
    expect(res.status).toBe(429);
    expect(res.body.message).not.toMatch(/a moment/);
    expect(res.body.message).toMatch(/try again in/i);
  });
});
