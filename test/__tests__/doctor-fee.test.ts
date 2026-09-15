import { PATCH as profilePatch } from "../../app/api/doctor/profile/route";
import { GET as doctorGet } from "../../app/api/doctors/[id]/route";
import { requestAs, type World } from "../fixtures";
import { call, params, setupWorld, teardownWorld } from "../harness";

const BASE = "http://localhost:3000";

let world: World;

beforeEach(async () => {
  world = await setupWorld();
});

afterEach(async () => {
  await teardownWorld(world);
});

describe("doctor consultation fee", () => {
  it("lets the owner update the fee and exposes it to patients", async () => {
    const update = await call<{ doctor: { id: string; fee: number; feeLabel: string } }>(
      profilePatch,
      requestAs(world.doctor, `${BASE}/api/doctor/profile`, {
        method: "PATCH",
        body: JSON.stringify({ fee: "1250" }),
      }),
    );

    expect(update.status).toBe(200);
    expect(update.body.doctor.fee).toBe(1250);
    expect(update.body.doctor.feeLabel).toContain("1,250");

    const patientView = await call<{ doctor: { fee: number; feeLabel: string } }>(
      doctorGet,
      requestAs(null, `${BASE}/api/doctors/${world.doctor.doctorId}`),
      params({ id: world.doctor.doctorId! }),
    );

    expect(patientView.status).toBe(200);
    expect(patientView.body.doctor.fee).toBe(1250);
    expect(patientView.body.doctor.feeLabel).toContain("1,250");
  });

  it("does not let patients or invalid values change the fee", async () => {
    const forbidden = await call(
      profilePatch,
      requestAs(world.patientA, `${BASE}/api/doctor/profile`, {
        method: "PATCH",
        body: JSON.stringify({ fee: "1250" }),
      }),
    );
    expect(forbidden.status).toBe(403);

    const invalid = await call(
      profilePatch,
      requestAs(world.doctor, `${BASE}/api/doctor/profile`, {
        method: "PATCH",
        body: JSON.stringify({ fee: "৳ 1,250" }),
      }),
    );
    expect(invalid.status).toBe(400);
  });
});
