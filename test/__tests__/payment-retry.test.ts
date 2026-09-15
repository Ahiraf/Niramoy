/**
 * Resuming and retrying a bKash payment.
 *
 * This is the file that pins the bug the deployed app actually had. Starting a
 * payment worked; every subsequent attempt on the same appointment returned a
 * payment with no gateway link, and the checkout sheet fell back to a confirm
 * form that a redirect provider refuses by design. So the tests here are less
 * about the happy path than about the second click:
 *
 *   - a live payment resumed must come back with somewhere to send the payer;
 *   - a spent one must open a genuinely new gateway transaction;
 *   - and neither must ever become a second charge for a payment that already
 *     went through.
 */
import { POST as paymentsPost } from "../../app/api/payments/route";
import { resetPaymentProvider } from "../../lib/payments/provider";
import { resetEnvCache } from "../../lib/config/env";
import { PAYMENT_SESSION_MINUTES } from "../../lib/services/payments";
import { requestAs, seedAppointment, type World } from "../fixtures";
import { call, setupWorld, teardownWorld } from "../harness";

const BASE = "http://localhost:3000";

let world: World;

beforeEach(async () => {
  world = await setupWorld();
  resetPaymentProvider();
});

afterEach(async () => {
  await teardownWorld(world);
  resetPaymentProvider();
});

/** Point the process at SSLCommerz for the duration of one test. */
function useSslcommerz(): () => void {
  const before = { ...process.env };
  process.env.PAYMENT_PROVIDER = "sslcommerz";
  process.env.SSLCOMMERZ_STORE_ID = "niramoytest";
  process.env.SSLCOMMERZ_STORE_PASSWORD = "niramoytest@ssl";
  /*
   * APP_URL is left at the harness default. These requests carry an Origin of
   * http://localhost:3000 and no Host header, so naming a different APP_URL
   * here would fail the CSRF origin check before any payment logic ran — a
   * confusing 403 that says nothing about the thing under test.
   */
  resetEnvCache();
  resetPaymentProvider();

  return () => {
    process.env = before;
    resetEnvCache();
    resetPaymentProvider();
  };
}

/**
 * Stand in for SSLCommerz.
 *
 * Records every URL asked for, so a test can tell a session request from a
 * status lookup, and answers each with whatever the test wants it to say.
 */
function stubGateway(options: {
  session?: Record<string, unknown>;
  status?: Record<string, unknown>;
} = {}): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);

    const payload = url.includes("merchantTransIDvalidationAPI")
      ? (options.status ?? { element: [{ status: "INVALID_TRANSACTION" }] })
      : (options.session ?? {
          status: "SUCCESS",
          GatewayPageURL: `https://sandbox.sslcommerz.com/EasyCheckOut/${calls.length}`,
        });

    return { ok: true, status: 200, json: async () => payload } as Response;
  }) as typeof fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

interface StartedPayment {
  id: string;
  status: string;
  flow: string;
  redirectUrl: string | null;
}

async function start(appointmentId: string, actor = world.patientA) {
  return call<{ payment: StartedPayment }>(
    paymentsPost,
    requestAs(actor, `${BASE}/api/payments`, {
      method: "POST",
      body: JSON.stringify({ appointmentId, method: "bkash" }),
    }),
  );
}

async function upcoming(): Promise<string> {
  return seedAppointment(world, {
    doctor: world.doctor,
    patient: world.patientA,
    startUtc: "2027-06-01T10:00:00Z",
    status: "confirmed",
  });
}

/** How many payment rows exist for an appointment. */
async function paymentCount(appointmentId: string): Promise<number> {
  const { rows } = await world.h.client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM payments WHERE appointment_id = '${appointmentId}'`,
  );
  return rows[0]!.n;
}

describe("resuming a live redirect payment", () => {
  it("returns somewhere to send the payer, not an empty link", async () => {
    const restoreEnv = useSslcommerz();
    const gateway = stubGateway();
    try {
      const appointmentId = await upcoming();

      const first = await start(appointmentId);
      expect(first.status).toBe(201);
      expect(first.body.payment.flow).toBe("redirect");
      expect(first.body.payment.redirectUrl).toMatch(/^https:\/\/sandbox\.sslcommerz\.com\//);

      // The second click. This is the one that used to come back with
      // redirectUrl: null and strand the payer on a form that could not submit.
      const second = await start(appointmentId);
      expect(second.body.payment.id).toBe(first.body.payment.id);
      expect(second.body.payment.redirectUrl).toMatch(/^https:\/\/sandbox\.sslcommerz\.com\//);
    } finally {
      gateway.restore();
      restoreEnv();
    }
  });

  it("reopens the same gateway transaction rather than a second one", async () => {
    const restoreEnv = useSslcommerz();
    const gateway = stubGateway();
    try {
      const appointmentId = await upcoming();
      await start(appointmentId);
      await start(appointmentId);

      // One row, so one transaction id, so one thing the payer can pay.
      expect(await paymentCount(appointmentId)).toBe(1);

      const { rows } = await world.h.client.query<{ provider_payment_id: string }>(
        `SELECT provider_payment_id FROM payments WHERE appointment_id = '${appointmentId}'`,
      );
      expect(rows[0]!.provider_payment_id).toMatch(/^nmy/);
    } finally {
      gateway.restore();
      restoreEnv();
    }
  });
});

describe("retrying after the session lapses", () => {
  /** Age the payment past its confirmable window. */
  async function expireSession(appointmentId: string): Promise<void> {
    await world.h.client.exec(
      `UPDATE payments SET created_at = now() - interval '${PAYMENT_SESSION_MINUTES + 5} minutes'
       WHERE appointment_id = '${appointmentId}'`,
    );
  }

  it("opens a new attempt with its own transaction id", async () => {
    const restoreEnv = useSslcommerz();
    const gateway = stubGateway();
    try {
      const appointmentId = await upcoming();
      const first = await start(appointmentId);
      await expireSession(appointmentId);

      const second = await start(appointmentId);
      expect(second.status).toBe(201);
      expect(second.body.payment.id).not.toBe(first.body.payment.id);
      expect(second.body.payment.redirectUrl).toBeTruthy();

      // Two rows: the lapsed one is kept, because the gateway may still have an
      // opinion about it, and a new one the payer can actually use.
      expect(await paymentCount(appointmentId)).toBe(2);

      const { rows } = await world.h.client.query<{ status: string; provider_payment_id: string }>(
        `SELECT status, provider_payment_id FROM payments
         WHERE appointment_id = '${appointmentId}' ORDER BY created_at`,
      );
      expect(rows[0]!.status).toBe("cancelled");
      expect(rows[0]!.provider_payment_id).not.toBe(rows[1]!.provider_payment_id);
    } finally {
      gateway.restore();
      restoreEnv();
    }
  });

  it("refuses a second attempt when the gateway says the first one was paid", async () => {
    const restoreEnv = useSslcommerz();
    const gateway = stubGateway({ status: { element: [{ status: "VALID" }] } });
    try {
      const appointmentId = await upcoming();
      await start(appointmentId);
      await expireSession(appointmentId);

      /*
       * The dangerous case: our row says pending because the IPN never arrived,
       * but the money moved. Opening a second session here is how a patient
       * pays twice.
       */
      const retry = await start(appointmentId);
      expect(retry.status).toBe(409);
      expect(await paymentCount(appointmentId)).toBe(1);
    } finally {
      gateway.restore();
      restoreEnv();
    }
  });

  it("does not reopen a payment that already succeeded", async () => {
    const restoreEnv = useSslcommerz();
    const gateway = stubGateway();
    try {
      const appointmentId = await upcoming();
      const first = await start(appointmentId);
      await world.h.client.exec(
        `UPDATE payments SET status = 'succeeded', webhook_verified_at = now()
         WHERE appointment_id = '${appointmentId}'`,
      );

      const again = await start(appointmentId);
      expect(again.body.payment.id).toBe(first.body.payment.id);
      expect(again.body.payment.status).toBe("succeeded");
      // Nothing was asked of the gateway the second time round.
      expect(await paymentCount(appointmentId)).toBe(1);
    } finally {
      gateway.restore();
      restoreEnv();
    }
  });
});

describe("an idempotency key is not a capability", () => {
  it("does not hand one patient another patient's payment", async () => {
    const mine = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: "2027-06-01T10:00:00Z",
      status: "confirmed",
    });
    const theirs = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientB,
      startUtc: "2027-06-02T10:00:00Z",
      status: "confirmed",
    });

    const first = await call<{ payment: { id: string } }>(
      paymentsPost,
      requestAs(world.patientA, `${BASE}/api/payments`, {
        method: "POST",
        body: JSON.stringify({ appointmentId: mine, idempotencyKey: "shared-key" }),
      }),
    );

    // Patient B guesses the key. They must get their own payment for their own
    // appointment, never a view of someone else's row.
    const second = await call<{ payment: { id: string } }>(
      paymentsPost,
      requestAs(world.patientB, `${BASE}/api/payments`, {
        method: "POST",
        body: JSON.stringify({ appointmentId: theirs, idempotencyKey: "shared-key" }),
      }),
    );

    expect(second.body.payment?.id).not.toBe(first.body.payment.id);
  });
});

/**
 * The browser return.
 *
 * SSLCommerz posts the payer back to /api/payments/return/<outcome>. The path
 * segment decides where they LAND; it decides nothing about whether they paid.
 * These tests exist because that distinction is the whole security of the
 * endpoint: anyone can open the success URL in a tab.
 */
describe("the payer coming back from the gateway", () => {
  const returnRoute = async (outcome: string, body?: string) => {
    const { POST } = await import("../../app/api/payments/return/[outcome]/route");
    return POST(
      new Request(`${BASE}/api/payments/return/${outcome}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: body ?? "",
      }),
      { params: Promise.resolve({ outcome }) } as never,
    );
  };

  /** Where the redirect sends them, as a query param the page reads on mount. */
  const outcomeOf = (res: Response) =>
    new URL(res.headers.get("location") ?? "http://x/").searchParams.get("payment");

  it("does not believe a success it cannot validate", async () => {
    const restoreEnv = useSslcommerz();
    try {
      // No val_id in the body: there is nothing to ask SSLCommerz about, so
      // there is nothing that could make this a settlement.
      const res = await returnRoute("success");
      expect(res.status).toBe(303);
      expect(outcomeOf(res)).toBe("unconfirmed");
    } finally {
      restoreEnv();
    }
  });

  it("does not settle on a val_id the gateway does not recognise", async () => {
    const restoreEnv = useSslcommerz();
    const gateway = stubGateway({ session: { status: "INVALID_TRANSACTION" } });
    try {
      const res = await returnRoute("success", "val_id=made-up&tran_id=nmytxn999");
      expect(outcomeOf(res)).toBe("unconfirmed");
    } finally {
      gateway.restore();
      restoreEnv();
    }
  });

  it("reports a cancellation without asking the gateway anything", async () => {
    const restoreEnv = useSslcommerz();
    const gateway = stubGateway();
    try {
      const res = await returnRoute("cancel", "tran_id=nmytxn001");
      expect(res.status).toBe(303);
      expect(outcomeOf(res)).toBe("cancel");
      // The payer backed out. There is no settlement to validate, and calling
      // the gateway about one would be asking a question with no answer.
      expect(gateway.calls).toHaveLength(0);
    } finally {
      gateway.restore();
      restoreEnv();
    }
  });

  it("reports a failure the same way", async () => {
    const restoreEnv = useSslcommerz();
    const gateway = stubGateway();
    try {
      expect(outcomeOf(await returnRoute("fail", "tran_id=nmytxn001"))).toBe("fail");
      expect(gateway.calls).toHaveLength(0);
    } finally {
      gateway.restore();
      restoreEnv();
    }
  });

  it("ignores an outcome that is not one of the three", async () => {
    const restoreEnv = useSslcommerz();
    try {
      const res = await returnRoute("succeeded-honest");
      expect(res.status).toBe(303);
      expect(outcomeOf(res)).toBeNull();
    } finally {
      restoreEnv();
    }
  });
});
