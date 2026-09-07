/**
 * The gate in front of doctor sign-up.
 *
 * A doctor account is a claim to be a registered clinician, and the platform
 * has no way to check that claim automatically — there is no bulk BM&DC feed.
 * So an admin checks the register by hand and approves a registration number
 * together with the mobile number that doctor will use, and only that pair can
 * complete a sign-up.
 *
 * These are mostly tests of what must NOT happen: no approval, a number
 * approved for somebody else's phone, a phone approved for somebody else's
 * number, and one approval used twice. Each of those was an account that should
 * not exist.
 */
import { POST as register } from "../../app/api/auth/register/route";
import { PATCH as confirmOtp, POST as sendOtp } from "../../app/api/auth/signup-otp/route";
import {
  GET as approvalsGet,
  PATCH as approvalsPatch,
  POST as approvalsPost,
} from "../../app/api/admin/doctor-approvals/route";
import { apply } from "../../lib/services/verification";
import { eq } from "drizzle-orm";
import * as t from "../../lib/db/schema";
import { resetEnvCache } from "../../lib/config/env";
import { resetSmsProvider } from "../../lib/notifications/sms";
import { setupWorld, teardownWorld, call } from "../harness";
import { requestAs, type World } from "../fixtures";

const BASE = "http://localhost:3000";
const NUMBER = "A-45312";
const PHONE = "01712345678";
const E164 = "+8801712345678";

let world: World;
let sent: string[] = [];
const realFetch = globalThis.fetch;

const anon = (url: string, body: unknown, method: string) =>
  new Request(url, {
    method,
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify(body),
  });

const lastCode = () => /(\d{6})/.exec(sent.at(-1) ?? "")?.[1] ?? "";

/** Prove a number the way the sign-up form does, and keep the ticket. */
const verifiedTicket = async (phone: string): Promise<string> => {
  await call(sendOtp, anon(`${BASE}/api/auth/signup-otp`, { phone }, "POST"));
  const res = await call<{ phoneVerification: { ticket: string } }>(
    confirmOtp,
    anon(`${BASE}/api/auth/signup-otp`, { phone, code: lastCode() }, "PATCH"),
  );
  return res.body.phoneVerification.ticket;
};

const approve = (body: Record<string, unknown>) =>
  call<{ approval: { id: string; registrationNumber: string; phone: string } }>(
    approvalsPost,
    requestAs(world.admin, `${BASE}/api/admin/doctor-approvals`, {
      method: "POST",
      body: JSON.stringify({
        registrationNumber: NUMBER,
        registrationType: "mbbs",
        phone: PHONE,
        ...body,
      }),
    }),
  );

const signUpAsDoctor = async (extra: Record<string, unknown> = {}) => {
  const phone = String(extra.phone ?? PHONE);
  const ticket = await verifiedTicket(phone);
  return call<{ user?: { id: string } }>(
    register,
    anon(
      `${BASE}/api/auth/register`,
      {
        name: "Rayhan Uddin",
        email: `doctor-${Math.random().toString(36).slice(2, 10)}@example.com`,
        password: "correct-horse-9",
        role: "doctor",
        bmdcNumber: NUMBER,
        registrationType: "mbbs",
        specialty: "cardiology",
        ...extra,
        phone,
        verificationTicket: ticket,
      },
      "POST",
    ),
  );
};

const doctorAccounts = async () =>
  world.h.db.select({ id: t.users.id }).from(t.users).where(eq(t.users.role, "doctor"));

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

describe("a doctor cannot sign up without an admin approval", () => {
  it("refuses a registration nobody approved", async () => {
    const before = (await doctorAccounts()).length;

    const res = await signUpAsDoctor();

    expect(res.status).toBe(422);
    // The account must not survive the refusal.
    expect(await doctorAccounts()).toHaveLength(before);
  });

  it("refuses an approved number quoted from a different phone", async () => {
    await approve({});
    const before = (await doctorAccounts()).length;

    // The number is approved; this handset is not the one it was approved for.
    const res = await signUpAsDoctor({ phone: "01812345678" });

    expect(res.status).toBe(422);
    expect(await doctorAccounts()).toHaveLength(before);
  });

  it("refuses an approved phone quoting a different number", async () => {
    await approve({});
    const before = (await doctorAccounts()).length;

    const res = await signUpAsDoctor({ bmdcNumber: "A-99999" });

    expect(res.status).toBe(422);
    expect(await doctorAccounts()).toHaveLength(before);
  });

  it("refuses a doctor who gives no registration number at all", async () => {
    await approve({});

    const res = await signUpAsDoctor({ bmdcNumber: "" });

    expect(res.status).toBe(400);
  });
});

describe("an approval lets exactly one doctor in", () => {
  it("accepts the pair the admin approved", async () => {
    await approve({});

    const res = await signUpAsDoctor();

    expect(res.status).toBe(201);
    expect(res.body.user?.id).toBeTruthy();
  });

  it("spends the approval, so it cannot be used twice", async () => {
    await approve({});
    const before = (await doctorAccounts()).length;
    expect((await signUpAsDoctor()).status).toBe(201);

    // Same number, same phone, second account.
    const replay = await signUpAsDoctor();

    expect(replay.status).toBe(422);
    // Exactly one account came out of one approval.
    expect(await doctorAccounts()).toHaveLength(before + 1);
  });

  it("records which account claimed it", async () => {
    await approve({});
    const res = await signUpAsDoctor();

    const rows = await world.h.db
      .select({
        status: t.doctorApprovals.status,
        claimedByUserId: t.doctorApprovals.claimedByUserId,
      })
      .from(t.doctorApprovals);

    expect(rows[0]).toMatchObject({
      status: "claimed",
      claimedByUserId: res.body.user!.id,
    });
  });

  it("cannot be used once withdrawn", async () => {
    const { body } = await approve({});

    const revoked = await call(
      approvalsPatch,
      requestAs(world.admin, `${BASE}/api/admin/doctor-approvals`, {
        method: "PATCH",
        body: JSON.stringify({ id: body.approval.id }),
      }),
    );
    expect(revoked.status).toBe(200);

    expect((await signUpAsDoctor()).status).toBe(422);
  });
});

describe("the approval is the BM&DC check, so it is not asked for twice", () => {
  it("publishes a pre-approved doctor's profile without a second admin decision", async () => {
    await approve({ registerName: "Dr. Rayhan Uddin" });
    const signUp = await signUpAsDoctor();
    expect(signUp.status).toBe(201);

    const [account] = await world.h.db
      .select({ id: t.users.id, name: t.users.name, email: t.users.email, phone: t.users.phone })
      .from(t.users)
      .where(eq(t.users.id, signUp.body.user!.id));

    // Filing the profile is the doctor's own action, so it runs as them.
    const { application } = await apply(
      {
        userId: account!.id,
        role: "doctor",
        name: account!.name,
        email: account!.email,
        phone: account!.phone,
      } as never,
      {
        bmdcNumber: NUMBER,
        registrationType: "mbbs",
        name: "Dr. Rayhan Uddin",
        specialtyId: "cardiology",
      },
      {},
    );

    // No admin touched this: the approval was the check.
    expect(application.status).toBe("verified");

    const [doctor] = await world.h.db
      .select({ status: t.doctors.verificationStatus })
      .from(t.doctors)
      .where(eq(t.doctors.userId, account!.id));
    expect(doctor!.status).toBe("verified");
  });

  it("still queues a doctor who applies with a number nobody approved", async () => {
    await approve({});
    const signUp = await signUpAsDoctor();

    const [account] = await world.h.db
      .select({ id: t.users.id, name: t.users.name, email: t.users.email, phone: t.users.phone })
      .from(t.users)
      .where(eq(t.users.id, signUp.body.user!.id));

    // Approved for A-45312, applying as A-99999. The approval says nothing
    // about this number, so it goes to the admin queue like any unchecked one.
    const { application } = await apply(
      {
        userId: account!.id,
        role: "doctor",
        name: account!.name,
        email: account!.email,
        phone: account!.phone,
      } as never,
      { bmdcNumber: "A-99999", registrationType: "mbbs", name: "Dr. Rayhan Uddin" },
      {},
    );

    expect(application.status).toBe("pending");
  });
});

describe("the approval list is admin-only", () => {
  it("refuses a patient reading who has been approved", async () => {
    const res = await call(
      approvalsGet,
      requestAs(world.patientA, `${BASE}/api/admin/doctor-approvals`),
    );
    expect(res.status).toBe(403);
  });

  it("refuses a doctor approving themselves", async () => {
    const res = await call(
      approvalsPost,
      requestAs(world.doctor, `${BASE}/api/admin/doctor-approvals`, {
        method: "POST",
        body: JSON.stringify({
          registrationNumber: "A-11111",
          registrationType: "mbbs",
          phone: PHONE,
        }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("refuses an anonymous caller", async () => {
    const res = await call(approvalsGet, requestAs(null, `${BASE}/api/admin/doctor-approvals`));
    expect(res.status).toBe(401);
  });
});
