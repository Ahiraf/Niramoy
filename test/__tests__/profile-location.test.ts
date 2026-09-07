/**
 * Where a patient says they are, read back.
 *
 * Division and district are stored on the patient row, but every response the
 * client renders its profile from is shaped from the user row. When the two
 * were not joined up, the settings screen read the fields back empty and the
 * selects fell through to whichever division sorts first — showing a patient
 * in Barishal because they had signed up in Chattogram. These tests pin the
 * round trip at each point the client reads a user: sign-up, the session
 * endpoint, and the profile edit itself.
 */
import { GET as authGet, PATCH as authPatch } from "../../app/api/auth/route";
import { POST as loginPost } from "../../app/api/auth/login/route";
import { setupWorld, teardownWorld, call } from "../harness";
import { requestAs, TEST_PASSWORD, type World } from "../fixtures";

const BASE = "http://localhost:3000";

type UserBody = { user: { division: string; district: string; name: string } };

let world: World;

beforeEach(async () => {
  world = await setupWorld();
});

afterEach(async () => {
  await teardownWorld(world);
});

/** Put the fixture patient somewhere specific, the way sign-up would have. */
const placeAt = (division: string, district: string) =>
  call<UserBody>(
    authPatch,
    requestAs(world.patientA, `${BASE}/api/auth`, {
      method: "PATCH",
      body: JSON.stringify({ division, district }),
    }),
  );

describe("a patient's division and district survive the round trip", () => {
  it("comes back on the response that saved it", async () => {
    const res = await placeAt("Chattogram", "Chattogram");

    expect(res.status).toBe(200);
    // The form re-renders from this body. An empty field here is the bug.
    expect(res.body.user).toMatchObject({ division: "Chattogram", district: "Chattogram" });
  });

  it("comes back from the session endpoint on the next page load", async () => {
    await placeAt("Chattogram", "Chattogram");

    const res = await call<UserBody>(authGet, requestAs(world.patientA, `${BASE}/api/auth`));

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ division: "Chattogram", district: "Chattogram" });
  });

  it("comes back on a fresh sign-in", async () => {
    await placeAt("Sylhet", "Sunamganj");

    const res = await call<UserBody>(
      loginPost,
      requestAs(null, `${BASE}/api/auth/login`, {
        method: "POST",
        body: JSON.stringify({ email: world.patientA.email, password: TEST_PASSWORD }),
      }),
    );

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ division: "Sylhet", district: "Sunamganj" });
  });

  it("does not invent a location for a patient who never gave one", async () => {
    // Empty is the honest answer; the form must not present a guess as stored.
    const res = await call<UserBody>(authGet, requestAs(world.patientB, `${BASE}/api/auth`));

    expect(res.body.user).toMatchObject({ division: "", district: "" });
  });
});
