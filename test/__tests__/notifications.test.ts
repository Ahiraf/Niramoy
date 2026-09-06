/**
 * Where a notification goes.
 *
 * The property under test is that the account's stored preference decides, and
 * that a channel with no provider behind it never claims to have delivered
 * anything. Both of those used to be untrue in different ways: the settings
 * toggles persisted nothing, and every notification was written as `in_app`
 * whatever the patient had asked for.
 */
import { eq } from "drizzle-orm";

import * as t from "../../lib/db/schema";
import { resetEnvCache } from "../../lib/config/env";
import { resetSmsProvider } from "../../lib/notifications/sms";
import { notify } from "../../lib/repositories/clinical";
import * as users from "../../lib/repositories/users";
import { setupWorld, teardownWorld } from "../harness";
import type { World } from "../fixtures";

let world: World;

beforeEach(async () => {
  world = await setupWorld();
});

afterEach(async () => {
  await teardownWorld(world);
});

/** Every notification row written for an actor, newest last. */
async function channelsFor(userId: string): Promise<Array<{ channel: string; status: string }>> {
  const { rows } = await world.h.client.query<{ channel: string; status: string }>(
    `SELECT channel, status FROM notifications WHERE user_id = $1 ORDER BY created_at`,
    [userId],
  );
  return rows;
}

const send = (userId: string, dedupeKey: string) =>
  notify({
    userId,
    type: "appointment_reminder",
    title: "Tomorrow's consultation",
    body: "Your consultation is tomorrow at 5:20 PM.",
    dedupeKey,
  });

describe("notification delivery honours the account's channels", () => {
  it("always writes the in-app record, whatever the preference", async () => {
    await users.updateProfile(world.patientA.userId, { notificationChannels: [] });

    await send(world.patientA.userId, "test:in-app-only");

    const rows = await channelsFor(world.patientA.userId);
    // The in-app row is the record that the patient was told. It is not a
    // preference and cannot be switched off.
    expect(rows.filter((r) => r.channel === "in_app")).toHaveLength(1);
    expect(rows.filter((r) => r.channel === "email")).toHaveLength(0);
  });

  it("sends an email copy when the account asks for one", async () => {
    await users.updateProfile(world.patientA.userId, { notificationChannels: ["email"] });

    await send(world.patientA.userId, "test:with-email");

    const rows = await channelsFor(world.patientA.userId);
    expect(rows.map((r) => r.channel).sort()).toEqual(["email", "in_app"]);
    // The console provider "delivers", so the attempt is recorded as sent
    // rather than assumed.
    expect(rows.find((r) => r.channel === "email")?.status).toBe("sent");
  });

  it("stores sms and whatsapp but never claims to have sent them", async () => {
    await users.updateProfile(world.patientA.userId, {
      notificationChannels: ["sms", "whatsapp"],
    });

    await send(world.patientA.userId, "test:no-provider");

    const stored = await users.findById(world.patientA.userId);
    expect(stored?.notificationChannels).toEqual(["sms", "whatsapp"]);

    // No provider exists for either, so no row asserts a delivery that did not
    // happen. A reminder that appears to send and does not is a missed visit.
    const rows = await channelsFor(world.patientA.userId);
    expect(rows.map((r) => r.channel)).toEqual(["in_app"]);
  });

  it("does not send a second copy when the same event is deduped", async () => {
    await users.updateProfile(world.patientA.userId, { notificationChannels: ["email"] });

    await send(world.patientA.userId, "test:once");
    await send(world.patientA.userId, "test:once");

    const rows = await channelsFor(world.patientA.userId);
    expect(rows.filter((r) => r.channel === "email")).toHaveLength(1);
  });

  /**
   * SMS is deliverable only where two things are true at once: a gateway is
   * configured, and the number was proved. Either one missing means the
   * preference is stored and nothing is sent — and no row claims otherwise.
   */
  describe("with an SMS gateway configured", () => {
    const realFetch = globalThis.fetch;
    let texts: string[] = [];

    beforeEach(() => {
      texts = [];
      process.env.SMS_PROVIDER = "textbee";
      process.env.TEXTBEE_API_KEY = "test-gateway-key";
      process.env.TEXTBEE_BASE_URL = "https://sms.invalid/api/v1";
      resetEnvCache();
      resetSmsProvider();

      globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? "{}")) as { message?: string };
        texts.push(body.message ?? "");
        return Response.json({ data: { smsBatchId: "batch-1" } });
      }) as typeof fetch;
    });

    afterEach(() => {
      globalThis.fetch = realFetch;
      delete process.env.SMS_PROVIDER;
      delete process.env.TEXTBEE_API_KEY;
      delete process.env.TEXTBEE_BASE_URL;
      resetEnvCache();
      resetSmsProvider();
    });

    it("texts a confirmed number", async () => {
      await world.h.client.query(
        `UPDATE users SET phone = $2, phone_verified_at = now() WHERE id = $1`,
        [world.patientA.userId, "+8801712345678"],
      );
      await users.updateProfile(world.patientA.userId, { notificationChannels: ["sms"] });

      await send(world.patientA.userId, "test:sms-verified");

      expect(texts).toHaveLength(1);
      expect(texts[0]).toContain("Tomorrow's consultation");
      const rows = await channelsFor(world.patientA.userId);
      expect(rows.find((r) => r.channel === "sms")?.status).toBe("sent");
    });

    it("will not text a number nobody proved", async () => {
      await world.h.client.query(`UPDATE users SET phone = $2 WHERE id = $1`, [
        world.patientA.userId,
        "+8801712345678",
      ]);
      await users.updateProfile(world.patientA.userId, { notificationChannels: ["sms"] });

      await send(world.patientA.userId, "test:sms-unverified");

      // The number might belong to whoever owns the digits that were mistyped.
      expect(texts).toHaveLength(0);
      const rows = await channelsFor(world.patientA.userId);
      expect(rows.map((r) => r.channel)).toEqual(["in_app"]);
    });
  });

  it("rejects a channel the system does not know", async () => {
    await expect(
      world.h.client.query(
        `UPDATE users SET notification_channels = '["telepathy"]'::jsonb WHERE id = $1`,
        [world.patientA.userId],
      ),
    ).rejects.toThrow();
  });
});
