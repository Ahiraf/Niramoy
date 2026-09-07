/**
 * Payment tests.
 *
 * The property that matters: a payment cannot reach `succeeded` because a client
 * said so. Only a signature-verified webhook, or the clearly-labelled mock, can
 * move it there.
 */
import { createHmac } from "node:crypto";

import { POST as paymentsPost } from "../../app/api/payments/route";
import { POST as webhookPost } from "../../app/api/payments/webhook/route";
import { POST as executePost } from "../../app/api/payments/[id]/execute/route";
import { resetPaymentProvider, signatureMatches } from "../../lib/payments/provider";
import { PAYMENT_SESSION_MINUTES } from "../../lib/services/payments";
import { requestAs, seedAppointment, type World } from "../fixtures";
import { call, params, setupWorld, teardownWorld } from "../harness";

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

describe("starting a payment", () => {
  async function upcoming(): Promise<string> {
    return seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: "2027-06-01T10:00:00Z",
      status: "confirmed",
    });
  }

  it("labels the mock provider as a mock", async () => {
    const res = await call<{ payment: { isMock: boolean; provider: string } }>(
      paymentsPost,
      requestAs(world.patientA, `${BASE}/api/payments`, {
        method: "POST",
        body: JSON.stringify({ appointmentId: await upcoming() }),
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.payment.isMock).toBe(true);
    expect(res.body.payment.provider).toBe("mock");
  });

  it("starts a bKash payment pending, not succeeded", async () => {
    const res = await call<{ payment: { status: string; method: string } }>(
      paymentsPost,
      requestAs(world.patientA, `${BASE}/api/payments`, {
        method: "POST",
        body: JSON.stringify({ appointmentId: await upcoming(), method: "bkash" }),
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.payment.method).toBe("bkash");
    // The payer has not authorised anything yet. Jumping straight to succeeded
    // would be a code path the live tokenized-checkout flow does not have.
    expect(res.body.payment.status).toBe("pending");
  });

  it("records a cash consultation without involving a gateway", async () => {
    const res = await call<{ payment: { method: string; provider: string; status: string } }>(
      paymentsPost,
      requestAs(world.patientA, `${BASE}/api/payments`, {
        method: "POST",
        body: JSON.stringify({ appointmentId: await upcoming(), method: "cash" }),
      }),
    );
    expect(res.status).toBe(201);
    expect(res.body.payment.method).toBe("cash");
    expect(res.body.payment.provider).toBe("cash");
    expect(res.body.payment.status).toBe("pending");
  });

  it("rejects a payment method it does not offer", async () => {
    const res = await call(
      paymentsPost,
      requestAs(world.patientA, `${BASE}/api/payments`, {
        method: "POST",
        body: JSON.stringify({ appointmentId: await upcoming(), method: "card" }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("takes the amount from the appointment, not the request", async () => {
    const appointmentId = await upcoming();
    const res = await call<{ payment: { amount: number } }>(
      paymentsPost,
      requestAs(world.patientA, `${BASE}/api/payments`, {
        method: "POST",
        // A client trying to pay one taka for an 800-taka consultation.
        body: JSON.stringify({ appointmentId, amount: 1 }),
      }),
    );
    expect(res.body.payment.amount).toBe(800);
  });

  it("refuses to start a payment for someone else's appointment", async () => {
    const res = await call(
      paymentsPost,
      requestAs(world.patientB, `${BASE}/api/payments`, {
        method: "POST",
        body: JSON.stringify({ appointmentId: await upcoming() }),
      }),
    );
    expect(res.status).toBe(404);
  });

  it("is idempotent — a retry does not create a second payment", async () => {
    const appointmentId = await upcoming();
    const body = JSON.stringify({ appointmentId, idempotencyKey: "retry-me" });

    const first = await call<{ payment: { id: string } }>(
      paymentsPost,
      requestAs(world.patientA, `${BASE}/api/payments`, { method: "POST", body }),
    );
    const second = await call<{ payment: { id: string } }>(
      paymentsPost,
      requestAs(world.patientA, `${BASE}/api/payments`, { method: "POST", body }),
    );

    expect(second.body.payment.id).toBe(first.body.payment.id);

    const { rows } = await world.h.client.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM payments`,
    );
    expect(rows[0]!.n).toBe(1);
  });

  it("refuses payment for a cancelled consultation", async () => {
    const appointmentId = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: "2027-06-01T10:00:00Z",
      status: "cancelled",
    });
    const res = await call(
      paymentsPost,
      requestAs(world.patientA, `${BASE}/api/payments`, {
        method: "POST",
        body: JSON.stringify({ appointmentId }),
      }),
    );
    expect(res.status).toBe(422);
  });
});

describe("confirming a bKash payment", () => {
  async function startBkash(): Promise<string> {
    const appointmentId = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: "2027-06-01T10:00:00Z",
      status: "confirmed",
    });
    const res = await call<{ payment: { id: string } }>(
      paymentsPost,
      requestAs(world.patientA, `${BASE}/api/payments`, {
        method: "POST",
        body: JSON.stringify({ appointmentId, method: "bkash" }),
      }),
    );
    return res.body.payment.id;
  }

  const execute = (patient: World["patientA"], id: string, body: unknown) =>
    call<{ payment: { status: string } }>(
      executePost,
      requestAs(patient, `${BASE}/api/payments/${id}/execute`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
      params({ id }),
    );

  it("settles once the payer authorises with their wallet number", async () => {
    const id = await startBkash();
    const res = await execute(world.patientA, id, { walletNumber: "01712345678" });
    expect(res.status).toBe(200);
    expect(res.body.payment.status).toBe("succeeded");
  });

  it("stops accepting a confirmation once the session has expired", async () => {
    const id = await startBkash();

    // Age the row past the session window. The deadline is derived from
    // created_at, so moving it is the same as waiting.
    await world.h.client.query(
      `UPDATE payments SET created_at = created_at - ($1 || ' minutes')::interval WHERE id = $2`,
      [String(PAYMENT_SESSION_MINUTES + 1), id],
    );

    const res = await call<{ message?: string }>(
      executePost,
      requestAs(world.patientA, `${BASE}/api/payments/${id}/execute`, {
        method: "POST",
        body: JSON.stringify({ walletNumber: "01712345678" }),
      }),
      params({ id }),
    );
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/still booked/i);

    // The expired session is closed, not left pending for a later attempt.
    const { rows } = await world.h.client.query<{ status: string; failure_reason: string }>(
      `SELECT status, failure_reason FROM payments WHERE id = $1`,
      [id],
    );
    expect(rows[0]?.status).toBe("cancelled");
    expect(rows[0]?.failure_reason).toBe("session_expired");
  });

  it("leaves the appointment booked when the payment session expires", async () => {
    const appointmentId = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: "2027-06-02T10:00:00Z",
      status: "confirmed",
    });
    const started = await call<{ payment: { id: string } }>(
      paymentsPost,
      requestAs(world.patientA, `${BASE}/api/payments`, {
        method: "POST",
        body: JSON.stringify({ appointmentId, method: "bkash" }),
      }),
    );

    await world.h.client.query(
      `UPDATE payments SET created_at = created_at - ($1 || ' minutes')::interval WHERE id = $2`,
      [String(PAYMENT_SESSION_MINUTES + 1), started.body.payment.id],
    );
    await execute(world.patientA, started.body.payment.id, { walletNumber: "01712345678" });

    // The session expires. The slot does not — that distinction is the whole
    // reason the countdown is safe to show.
    const { rows } = await world.h.client.query<{ status: string }>(
      `SELECT status FROM appointments WHERE id = $1`,
      [appointmentId],
    );
    expect(rows[0]?.status).toBe("confirmed");
  });

  it("refuses a wallet number no bKash account could have", async () => {
    const id = await startBkash();
    const res = await execute(world.patientA, id, { walletNumber: "12345" });
    expect(res.status).toBe(400);
  });

  it("refuses to confirm someone else's payment", async () => {
    const id = await startBkash();
    const res = await execute(world.patientB, id, { walletNumber: "01712345678" });
    expect(res.status).toBe(404);
  });

  // A double tap on Confirm must not become a second execute call against the
  // wallet — on a live gateway that is a second charge.
  it("is idempotent once settled", async () => {
    const id = await startBkash();
    await execute(world.patientA, id, { walletNumber: "01712345678" });
    const again = await execute(world.patientA, id, { walletNumber: "01712345678" });
    expect(again.status).toBe(200);
    expect(again.body.payment.status).toBe("succeeded");
  });

  it("will not run the wallet flow for a cash consultation", async () => {
    const appointmentId = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: "2027-07-01T10:00:00Z",
      status: "confirmed",
    });
    const created = await call<{ payment: { id: string } }>(
      paymentsPost,
      requestAs(world.patientA, `${BASE}/api/payments`, {
        method: "POST",
        body: JSON.stringify({ appointmentId, method: "cash" }),
      }),
    );
    const res = await execute(world.patientA, created.body.payment.id, {
      walletNumber: "01712345678",
    });
    expect(res.status).toBe(422);
  });
});

describe("webhook signature verification", () => {
  const secret = "webhook-secret-value";
  const sign = (body: string) => createHmac("sha256", secret).update(body).digest("hex");

  it("accepts a correct signature and rejects a tampered body", () => {
    const body = JSON.stringify({ eventId: "e1", paymentID: "p1", transactionStatus: "Completed" });
    expect(signatureMatches(body, sign(body), secret)).toBe(true);
    expect(signatureMatches(`${body} `, sign(body), secret)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    const body = JSON.stringify({ eventId: "e1" });
    const wrong = createHmac("sha256", "not-the-secret").update(body).digest("hex");
    expect(signatureMatches(body, wrong, secret)).toBe(false);
  });

  it("accepts the sha256= prefix form", () => {
    const body = JSON.stringify({ eventId: "e1" });
    expect(signatureMatches(body, `sha256=${sign(body)}`, secret)).toBe(true);
  });

  /**
   * With the mock provider configured there are no genuine webhooks, so
   * anything claiming to be one is rejected. That is the correct default: an
   * endpoint that accepted unsigned callbacks would let anyone mark any
   * consultation paid.
   */
  it("refuses an unsigned webhook outright", async () => {
    const res = await call(
      webhookPost,
      new Request(`${BASE}/api/payments/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ eventId: "forged", paymentID: "x", transactionStatus: "Completed" }),
      }),
    );
    expect(res.status).toBe(403);
  });

  it("does not let a forged webhook mark a payment succeeded", async () => {
    const appointmentId = await seedAppointment(world, {
      doctor: world.doctor,
      patient: world.patientA,
      startUtc: "2027-06-01T10:00:00Z",
      status: "confirmed",
    });
    await call(
      paymentsPost,
      requestAs(world.patientA, `${BASE}/api/payments`, {
        method: "POST",
        body: JSON.stringify({ appointmentId }),
      }),
    );
    await world.h.client.exec(`UPDATE payments SET status = 'pending', is_mock = 'false';`);

    await call(
      webhookPost,
      new Request(`${BASE}/api/payments/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-signature": "deadbeef" },
        body: JSON.stringify({ eventId: "forged", paymentID: "x", transactionStatus: "Completed" }),
      }),
    );

    const { rows } = await world.h.client.query<{ status: string }>(
      `SELECT status FROM payments`,
    );
    expect(rows[0]!.status).toBe("pending");
  });
});

describe("schema-level payment guarantees", () => {
  it("refuses a non-mock payment marked succeeded without a verified webhook", async () => {
    await expect(
      world.h.client.exec(`
        INSERT INTO payments (provider, is_mock, amount, currency, status, idempotency_key)
        VALUES ('bkash', 'false', '800', 'BDT', 'succeeded', 'forged-key');
      `),
    ).rejects.toThrow(/ck_payments_succeeded_verified/);
  });

  it("allows it once a webhook has been verified", async () => {
    await expect(
      world.h.client.exec(`
        INSERT INTO payments (provider, is_mock, amount, currency, status, idempotency_key,
                              webhook_verified_at)
        VALUES ('bkash', 'false', '800', 'BDT', 'succeeded', 'verified-key', now());
      `),
    ).resolves.toBeDefined();
  });

  it("refuses a duplicate idempotency key", async () => {
    await world.h.client.exec(`
      INSERT INTO payments (provider, is_mock, amount, currency, status, idempotency_key)
      VALUES ('mock', 'true', '800', 'BDT', 'pending', 'dupe');
    `);
    await expect(
      world.h.client.exec(`
        INSERT INTO payments (provider, is_mock, amount, currency, status, idempotency_key)
        VALUES ('mock', 'true', '800', 'BDT', 'pending', 'dupe');
      `),
    ).rejects.toThrow(/uq_payments_idempotency/);
  });
});
