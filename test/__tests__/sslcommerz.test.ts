/**
 * SSLCommerz provider tests.
 *
 * The gateway is never reached here: `fetch` is stubbed, because what needs
 * testing is what we BELIEVE, not what SSLCommerz says on a given afternoon.
 *
 * Three properties carry the integration:
 *
 *   1. Nothing in a callback body is trusted. Settlement comes from a
 *      server-to-server validation call keyed on `val_id`.
 *   2. A gateway we cannot reach settles nothing. Failure is never read as
 *      success.
 *   3. The validated AMOUNT must match the stored row. This is the control
 *      that catches a tampered or forged callback naming a real transaction.
 */
import { sslcommerzProvider, transactionId } from "../../lib/payments/sslcommerz";

const CONFIG = {
  storeId: "niramoytest",
  storePassword: "niramoytest@ssl",
  sandbox: true,
  appUrl: "https://niramoy.example",
};

const provider = sslcommerzProvider(CONFIG);

/** Replace global fetch for one call and record what it was asked. */
function stubFetch(responder: (url: string, init?: RequestInit) => unknown) {
  const calls: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    const payload = responder(url, init);
    if (payload instanceof Error) throw payload;
    return {
      ok: true,
      status: 200,
      json: async () => payload,
    } as Response;
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

describe("transaction ids", () => {
  it("stays inside the 30-character limit SSLCommerz enforces", () => {
    expect(transactionId("appt:9f1c6b6e-1f4a-4a1e-9a3c-2b7d1e0f5a44").length).toBeLessThanOrEqual(30);
  });

  it("is stable for the same idempotency key, so a retry reuses the transaction", () => {
    expect(transactionId("appt:abc")).toBe(transactionId("appt:abc"));
  });

  it("does not collide for keys that share a long prefix", () => {
    // The reason it is hashed rather than truncated: appointment ids differ
    // in their last characters, which is exactly what truncation throws away.
    const a = "appt:9f1c6b6e-1f4a-4a1e-9a3c-2b7d1e0f5a44";
    const b = "appt:9f1c6b6e-1f4a-4a1e-9a3c-2b7d1e0f5a45";
    expect(transactionId(a)).not.toBe(transactionId(b));
  });
});

describe("opening a session", () => {
  it("asks for the sandbox gateway and returns the hosted page url", async () => {
    const stub = stubFetch(() => ({
      status: "SUCCESS",
      GatewayPageURL: "https://sandbox.sslcommerz.com/EasyCheckOut/testcde123",
    }));
    try {
      const intent = await provider.createPayment({
        amount: 500,
        currency: "BDT",
        reference: "NIR-1",
        description: "Consultation",
        method: "bkash",
        returnUrl: `${CONFIG.appUrl}/`,
        idempotencyKey: "appt:one",
      });

      expect(stub.calls[0]).toContain("sandbox.sslcommerz.com");
      expect(intent.redirectUrl).toContain("EasyCheckOut");
      // The gateway page having opened is not payment.
      expect(intent.status).toBe("pending");
      expect(intent.isMock).toBe(false);
    } finally {
      stub.restore();
    }
  });

  it("refuses to invent a session when SSLCommerz declines", async () => {
    const stub = stubFetch(() => ({ status: "FAILED", failedreason: "Invalid store credential" }));
    try {
      await expect(
        provider.createPayment({
          amount: 500,
          currency: "BDT",
          reference: "NIR-2",
          description: "Consultation",
          method: "bkash",
          returnUrl: `${CONFIG.appUrl}/`,
          idempotencyKey: "appt:two",
        }),
      ).rejects.toThrow(/couldn't start/i);
    } finally {
      stub.restore();
    }
  });
});

describe("believing a callback", () => {
  it("validates against the API rather than the posted body", async () => {
    const stub = stubFetch(() => ({
      status: "VALID",
      val_id: "2409101200",
      tran_id: "nmyabc",
      amount: "500.00",
      currency: "BDT",
    }));
    try {
      // The body claims a different amount than the validation API reports.
      // The API's answer is the one that survives.
      const result = await provider.verifyWebhook({
        rawBody: "val_id=2409101200&tran_id=nmyabc&amount=1.00&status=VALID",
        headers: new Headers(),
      });

      expect(stub.calls[0]).toContain("validationserverAPI.php");
      expect(result.valid).toBe(true);
      expect(result.status).toBe("succeeded");
      expect(result.amount).toBe(500);
      expect(result.eventId).toBe("2409101200");
    } finally {
      stub.restore();
    }
  });

  it("treats VALIDATED as settled, so an IPN/return race is not a failure", async () => {
    const stub = stubFetch(() => ({
      status: "VALIDATED",
      val_id: "v2",
      tran_id: "nmyabc",
      amount: "500.00",
      currency: "BDT",
    }));
    try {
      const result = await provider.verifyWebhook({
        rawBody: "val_id=v2",
        headers: new Headers(),
      });
      expect(result.status).toBe("succeeded");
    } finally {
      stub.restore();
    }
  });

  it("does not settle when the gateway cannot be reached", async () => {
    const stub = stubFetch(() => new Error("ECONNRESET"));
    try {
      const result = await provider.verifyWebhook({
        rawBody: "val_id=whatever",
        headers: new Headers(),
      });
      // Silence from the gateway is not consent.
      expect(result.valid).toBe(false);
      expect(result.status).toBeNull();
      expect(result.reason).toBe("validation_unreachable");
    } finally {
      stub.restore();
    }
  });

  it("does not settle on a status it does not recognise", async () => {
    const stub = stubFetch(() => ({ status: "SOMETHING_NEW", val_id: "v3" }));
    try {
      const result = await provider.verifyWebhook({
        rawBody: "val_id=v3",
        headers: new Headers(),
      });
      expect(result.valid).toBe(false);
      expect(result.status).toBeNull();
    } finally {
      stub.restore();
    }
  });

  it("never calls the validation API for a body with no val_id", async () => {
    const stub = stubFetch(() => ({ status: "VALID", val_id: "forged", amount: "500.00" }));
    try {
      const result = await provider.verifyWebhook({
        rawBody: "tran_id=nmyabc&status=FAILED",
        headers: new Headers(),
      });
      // Nothing to ask about, so nothing was asked — and a failed IPN is a
      // legitimate event rather than an authentication failure.
      expect(stub.calls).toHaveLength(0);
      expect(result.status).toBe("failed");
      expect(result.amount).toBeNull();
    } finally {
      stub.restore();
    }
  });
});

describe("the redirect flow has no confirm step", () => {
  it("declares itself a redirect provider", () => {
    expect(provider.flow).toBe("redirect");
    // Real gateway, unreal money — the UI needs to be able to say exactly that.
    expect(provider.isMock).toBe(false);
    expect(provider.sandbox).toBe(true);
  });

  it("refuses an execute call rather than inventing a status", async () => {
    await expect(
      provider.executePayment({ providerPaymentId: "nmyabc", walletNumber: "01712345678" }),
    ).rejects.toThrow(/confirmed by bKash/i);
  });
});
