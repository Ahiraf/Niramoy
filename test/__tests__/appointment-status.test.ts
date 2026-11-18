import { appointmentStatus } from "../../lib/scheduling/appointment-status";
import * as appointments from "../../lib/repositories/appointments";
import { seedAppointment } from "../fixtures";
import { setupWorld, teardownWorld } from "../harness";

const now = Date.parse("2026-11-18T05:30:00Z");

describe("appointment history", () => {
  it.each(["pending", "confirmed"])("expires %s at the end, including Dhaka offsets", (status) => {
    expect(appointmentStatus({ status, endUtc: "2026-11-18T11:30:00+06:00" }, now - 1)).toBe(status);
    expect(appointmentStatus({ status, endUtc: "2026-11-18T11:30:00+06:00" }, now)).toBe("no_show");
  });

  it.each(["completed", "cancelled", "no_show", "in_progress"])("preserves %s instead of inferring attendance", (status) => {
    expect(appointmentStatus({ status, endUtc: "2026-09-11T06:45:00Z" }, now)).toBe(status);
  });

  it("returns missed and consulted history without requiring the cleanup job", async () => {
    const world = await setupWorld();
    try {
      const missed = await seedAppointment(world, { doctor: world.doctor, patient: world.patientA,
        startUtc: "2020-09-11T06:45:00Z", status: "confirmed" });
      const consulted = await seedAppointment(world, { doctor: world.doctor, patient: world.patientA,
        startUtc: "2020-09-12T06:45:00Z", status: "completed" });
      const future = await seedAppointment(world, { doctor: world.doctor, patient: world.patientA,
        startUtc: new Date(Date.now() + 86_400_000).toISOString(), status: "confirmed" });
      const rows = await appointments.list({ patientId: world.patientA.patientId! });
      expect(rows.find((a) => a.id === missed)?.status).toBe("no_show");
      expect(rows.find((a) => a.id === consulted)?.status).toBe("completed");
      expect(rows.filter((a) => a.status === "confirmed").map((a) => a.id)).toEqual([future]);
      expect(await appointments.list({ patientId: world.patientB.patientId! })).toEqual([]);
    } finally {
      await teardownWorld(world);
    }
  });
});
