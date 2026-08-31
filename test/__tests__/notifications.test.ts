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

  it("rejects a channel the system does not know", async () => {
    await expect(
      world.h.client.query(
        `UPDATE users SET notification_channels = '["telepathy"]'::jsonb WHERE id = $1`,
        [world.patientA.userId],
      ),
    ).rejects.toThrow();
  });
});
