/**
 * Proving a mobile number at sign-up.
 *
 * The properties under test are the ones that decide whether a reminder reaches
 * a patient or a stranger:
 *
 *   - the number is stored in one shape, whatever shape it was typed in;
 *   - the gateway is handed that shape, at the documented endpoint;
 *   - a six-digit code cannot be brute-forced;
 *   - editing the number takes the verification away with it.
 *
 * The gateway is the one thing stubbed, at the fetch boundary rather than by
 * mocking our own module: that way the request TextBee would actually receive
 * is asserted, and the stub is also how the test learns the code — which is the
 * only way to test confirming one without reading it out of the database.
 */
import { eq } from "drizzle-orm";

import { PATCH as patchProfile } from "../../app/api/auth/route";
import { PATCH as confirmPhone, POST as sendPhone } from "../../app/api/auth/verify-phone/route";
import { resetEnvCache } from "../../lib/config/env";
import * as t from "../../lib/db/schema";
import { maskPhone, normalisePhone } from "../../lib/auth/phone";
import { SMS_SEGMENT_LIMIT } from "../../lib/notifications";
import { resetSmsProvider } from "../../lib/notifications/sms";
import { PHONE_CODE_MAX_ATTEMPTS } from "../../lib/services/phone-verification";
import { requestAs, type World } from "../fixtures";
import { call, setupWorld, teardownWorld } from "../harness";

let world: World;

interface SentSms {
  url: string;
  apiKey: string | null;
  recipients: string[];
  message: string;
}

let sent: SentSms[] = [];
let gatewayFails = false;
const realFetch = globalThis.fetch;

/** The last code the gateway was asked to deliver. */
const lastCode = (): string => {
  const message = sent.at(-1)?.message ?? "";
  return /(\d{6})/.exec(message)?.[1] ?? "";
};

beforeEach(async () => {
  world = await setupWorld();

  sent = [];
  gatewayFails = false;

  // A configured gateway, pointed at nothing that exists.
  process.env.SMS_PROVIDER = "textbee";
  process.env.TEXTBEE_API_KEY = "test-gateway-key";
  process.env.TEXTBEE_DEVICE_ID = "test-device";
  process.env.TEXTBEE_BASE_URL = "https://sms.invalid/api/v1";
  resetEnvCache();
  resetSmsProvider();

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://sms.invalid")) {
      throw new Error(`unexpected outbound request in test: ${url}`);
    }
    if (gatewayFails) return new Response("device offline", { status: 502 });

    const headers = new Headers(init?.headers);
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      recipients?: string[];
      message?: string;
    };
    sent.push({
      url,
      apiKey: headers.get("x-api-key"),
      recipients: body.recipients ?? [],
      message: body.message ?? "",
    });
    return Response.json({ data: { smsBatchId: "batch-1" } });
  }) as typeof fetch;
});

afterEach(async () => {
  globalThis.fetch = realFetch;
  delete process.env.SMS_PROVIDER;
  delete process.env.TEXTBEE_API_KEY;
  delete process.env.TEXTBEE_DEVICE_ID;
  delete process.env.TEXTBEE_BASE_URL;
  resetEnvCache();
  resetSmsProvider();
  await teardownWorld(world);
});

const send = (phone?: string) =>
  call(
    sendPhone,
    requestAs(world.patientA, "http://localhost:3000/api/auth/verify-phone", {
      method: "POST",
      body: JSON.stringify(phone === undefined ? {} : { phone }),
    }),
  );

const confirm = (code: string) =>
  call(
    confirmPhone,
    requestAs(world.patientA, "http://localhost:3000/api/auth/verify-phone", {
      method: "PATCH",
      body: JSON.stringify({ code }),
    }),
  );

const storedUser = async () => {
  const rows = await world.h.db
    .select({ phone: t.users.phone, phoneVerifiedAt: t.users.phoneVerifiedAt })
    .from(t.users)
    .where(eq(t.users.id, world.patientA.userId));
  return rows[0]!;
};

/* -------------------------------------------------------------------------- */

describe("normalising a Bangladeshi mobile number", () => {
  it("accepts every shape a person types, and stores one", () => {
    for (const input of [
      "01712345678",
      "+8801712345678",
      "8801712345678",
      "01712-345678",
      "+880 1712 345 678",
      "1712345678",
      // A Bangla keyboard produces these, and they are the same number.
      "০১৭১২৩৪৫৬৭৮",
    ]) {
      expect(normalisePhone(input)?.e164).toBe("+8801712345678");
    }
  });

  it("refuses anything that is not one", () => {
    for (const input of ["", "0171234567", "017123456789", "01212345678", "+14155550123", "hello"]) {
      expect(normalisePhone(input)).toBeNull();
    }
  });

  it("shows enough of the number to recognise, not enough to learn", () => {
    const masked = maskPhone("+8801712345678");
    expect(masked).toBe("01712••••78");
    expect(masked).not.toContain("3456");
  });
});

describe("sending the code", () => {
  it("posts to the device endpoint with the key, in E.164", async () => {
    const res = await send("01712-345678");

    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("https://sms.invalid/api/v1/gateway/devices/test-device/send-sms");
    expect(sent[0]!.apiKey).toBe("test-gateway-key");
    expect(sent[0]!.recipients).toEqual(["+8801712345678"]);
    // The warning is in Bangla; the name, the code and the expiry are not, so
    // a handset that cannot render Bangla still shows something actionable.
    expect(sent[0]!.message).toContain("কোডটি কাউকে জানাবেন না");
    expect(sent[0]!.message).toContain("Niramoy");
    expect(lastCode()).toMatch(/^\d{6}$/);

    /**
     * One SMS segment. Bangla forces UCS-2, so the budget is 70 UTF-16 units,
     * not 160 — and a second segment is a second billed message out of the
     * handset and a second chance to deliver half a code.
     */
    expect(sent[0]!.message.length).toBeLessThanOrEqual(SMS_SEGMENT_LIMIT);

    // Stored normalised, whatever was typed.
    expect((await storedUser()).phone).toBe("+8801712345678");
  });

  it("never returns the number or the code to the caller", async () => {
    const res = await send("01712345678");
    const serialised = JSON.stringify(res.body);

    expect(serialised).not.toContain("8801712345678");
    expect(serialised).not.toContain(lastCode());
    expect(res.body.phoneVerification).toMatchObject({ verified: false, delivered: true });
  });

  it("refuses a number no Bangladeshi network could deliver to", async () => {
    const res = await send("+14155550123");

    expect(res.status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("leaves no live code behind when the gateway fails", async () => {
    gatewayFails = true;
    const failed = await send("01712345678");
    expect(failed.status).toBe(503);

    gatewayFails = false;
    await send("01712345678");
    const rows = await world.h.client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM auth_tokens
        WHERE user_id = $1 AND purpose = 'phone_verification' AND consumed_at IS NULL`,
      [world.patientA.userId],
    );
    expect(rows.rows[0]!.n).toBe(1);
  });

  it("stops after three sends in an hour", async () => {
    await send("01712345678");
    await send("01712345678");
    await send("01712345678");
    const fourth = await send("01712345678");

    expect(fourth.status).toBe(429);
    expect(sent).toHaveLength(3);
  });
});

describe("confirming the code", () => {
  it("records the number as proved", async () => {
    await send("01712345678");

    const res = await confirm(lastCode());

    expect(res.status).toBe(200);
    expect(res.body.phoneVerification).toMatchObject({ verified: true, phone: "01712••••78" });
    expect((await storedUser()).phoneVerifiedAt).toBeInstanceOf(Date);
  });

  it("burns the code after five wrong guesses", async () => {
    await send("01712345678");
    const correct = lastCode();
    const wrong = correct === "000000" ? "111111" : "000000";

    for (let attempt = 1; attempt <= PHONE_CODE_MAX_ATTEMPTS; attempt += 1) {
      const res = await confirm(wrong);
      expect(res.status).toBe(400);
    }

    // The right code no longer works: the code died, not the account.
    const afterBurn = await confirm(correct);
    expect(afterBurn.status).toBe(422);
    expect((await storedUser()).phoneVerifiedAt).toBeNull();
  });

  it("kills the previous code when a new one is sent", async () => {
    await send("01712345678");
    const first = lastCode();

    await send("01712345678");
    const second = lastCode();
    expect(second).not.toBe(first);

    expect((await confirm(first)).status).toBe(400);
    expect((await confirm(second)).status).toBe(200);
  });

  it("cannot be spent twice", async () => {
    await send("01712345678");
    const code = lastCode();

    expect((await confirm(code)).status).toBe(200);
    // Already verified: the second call is a no-op, not a second proof.
    const again = await confirm(code);
    expect(again.status).toBe(200);
    expect(again.body.phoneVerification).toMatchObject({ verified: true });
  });
});

describe("editing the number", () => {
  it("takes the verification with it", async () => {
    await send("01712345678");
    await confirm(lastCode());
    expect((await storedUser()).phoneVerifiedAt).toBeInstanceOf(Date);

    const res = await call(
      patchProfile,
      requestAs(world.patientA, "http://localhost:3000/api/auth", {
        method: "PATCH",
        body: JSON.stringify({ phone: "01812345678" }),
      }),
    );

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ phoneVerified: false });
    expect((await storedUser()).phoneVerifiedAt).toBeNull();
  });

  it("keeps it when the same number is saved again", async () => {
    await send("01712345678");
    await confirm(lastCode());

    await call(
      patchProfile,
      requestAs(world.patientA, "http://localhost:3000/api/auth", {
        method: "PATCH",
        // Typed differently, but the same SIM — normalisation must see that.
        body: JSON.stringify({ phone: "+880 1712 345 678" }),
      }),
    );

    expect((await storedUser()).phoneVerifiedAt).toBeInstanceOf(Date);
  });
});
