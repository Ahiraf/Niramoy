/**
 * The model credential chain.
 *
 * The chain exists because a free-tier quota is per key and runs out without
 * warning. What matters is the order it tries them in, that a spent key moves
 * the request on rather than failing it, and — the part that is a safety
 * property rather than a convenience — that running out of credentials
 * produces "nothing answered" and never an invented answer.
 */
import { chatJson, credentialChain, resetCredentialState } from "../providers";
import { resetEnvCache } from "../../config/env";

const realFetch = globalThis.fetch;

/** One recorded upstream call: which key was used, against which host. */
interface Call {
  url: string;
  key: string;
}

let calls: Call[] = [];

/**
 * Answer each request from a queue of statuses, so a test can say
 * "429, 429, 429, then 200" and assert where the request ended up.
 */
const respondWith = (statuses: Array<number | "network-error">, content = '{"ok":true}') => {
  let i = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({
      url: String(input),
      key: (headers.get("authorization") ?? "").replace("Bearer ", ""),
    });

    const status = statuses[Math.min(i, statuses.length - 1)];
    i += 1;

    if (status === "network-error") throw new Error("socket hang up");
    if (status !== 200) return new Response("upstream said no", { status });

    return Response.json({ choices: [{ message: { content } }] });
  }) as typeof fetch;
};

const setKeys = (env: Record<string, string | undefined>) => {
  for (const name of [
    "GEMINI_API_KEY_1", "GEMINI_API_KEY_2", "GEMINI_API_KEY_3",
    "OPENAI_API_KEY", "AI_API_KEY", "AI_BASE_URL", "AI_PROVIDER",
  ]) {
    delete process.env[name];
  }
  for (const [name, value] of Object.entries(env)) {
    if (value !== undefined) process.env[name] = value;
  }
  resetEnvCache();
};

const ask = () => chatJson([{ role: "user", content: "hello" }], { timeoutMs: 500 });

beforeEach(() => {
  calls = [];
  resetCredentialState();
  setKeys({
    GEMINI_API_KEY_1: "gem-one",
    GEMINI_API_KEY_2: "gem-two",
    GEMINI_API_KEY_3: "gem-three",
    OPENAI_API_KEY: "openai-key",
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setKeys({});
  resetCredentialState();
});

/* -------------------------------------------------------------------------- */

describe("the order keys are tried in", () => {
  it("puts the three Gemini keys first and OpenAI last", () => {
    expect(credentialChain().map((c) => c.id)).toEqual([
      "gemini-1", "gemini-2", "gemini-3", "openai",
    ]);
  });

  it("skips keys that are not configured", () => {
    setKeys({ GEMINI_API_KEY_2: "gem-two", OPENAI_API_KEY: "openai-key" });
    expect(credentialChain().map((c) => c.id)).toEqual(["gemini-2", "openai"]);
  });

  it("keeps a pre-existing single endpoint working, and tries it last", () => {
    setKeys({
      GEMINI_API_KEY_1: "gem-one",
      AI_API_KEY: "legacy",
      AI_BASE_URL: "https://llm.example.com/v1",
    });
    expect(credentialChain().map((c) => c.id)).toEqual(["gemini-1", "custom"]);
  });

  it("is empty when nothing is configured, so callers stay on their own logic", () => {
    setKeys({});
    expect(credentialChain()).toEqual([]);
  });
});

describe("falling through to the next key", () => {
  it("moves to the second Gemini key when the first is rate-limited", async () => {
    respondWith([429, 200]);

    const result = await ask();

    expect(result?.credentialId).toBe("gemini-2");
    expect(calls.map((c) => c.key)).toEqual(["gem-one", "gem-two"]);
  });

  it("reaches OpenAI once all three Gemini keys are spent", async () => {
    respondWith([429, 429, 429, 200]);

    const result = await ask();

    expect(result?.credentialId).toBe("openai");
    expect(result?.provider).toBe("openai");
    expect(result?.attempts).toBe(4);
    expect(calls.map((c) => c.key)).toEqual(["gem-one", "gem-two", "gem-three", "openai-key"]);
  });

  it("moves on when a key is rejected rather than limited", async () => {
    respondWith([401, 200]);
    expect((await ask())?.credentialId).toBe("gemini-2");
  });

  it("moves on when a provider is down", async () => {
    respondWith([503, 200]);
    expect((await ask())?.credentialId).toBe("gemini-2");
  });

  it("moves on when a provider cannot be reached at all", async () => {
    respondWith(["network-error", 200]);
    expect((await ask())?.credentialId).toBe("gemini-2");
  });

  it("stops on a malformed request instead of repeating it four times", async () => {
    // A 400 is our fault, not the key's. Every other key would say the same.
    respondWith([400, 200]);

    expect(await ask()).toBeNull();
    expect(calls).toHaveLength(1);
  });
});

describe("when every key is spent", () => {
  it("reports that nothing answered rather than inventing one", async () => {
    respondWith([429]);

    const result = await ask();

    // Null is what makes triage keep its rule-based answer and the summary
    // stay undrafted. Anything else here would be a clinical answer with no
    // model behind it.
    expect(result).toBeNull();
    expect(calls).toHaveLength(4);
  });
});

describe("remembering a key that reported a limit", () => {
  it("does not retry it on the next request", async () => {
    respondWith([429, 200]);
    expect((await ask())?.credentialId).toBe("gemini-2");

    calls = [];
    respondWith([200]);
    const second = await ask();

    // The first key said it was done; asking it again would waste the round
    // trip and spend another request against a quota already over.
    expect(second?.credentialId).toBe("gemini-2");
    expect(calls.map((c) => c.key)).toEqual(["gem-two"]);
  });

  it("honours a Retry-After that has already elapsed", async () => {
    // Counted outside `calls`, which each phase of the test resets.
    let firstKeyCalls = 0;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const key = (headers.get("authorization") ?? "").replace("Bearer ", "");
      calls.push({ url: String(input), key });

      // The first key is limited for a moment that is already over by the
      // time the second request arrives.
      if (key === "gem-one") {
        firstKeyCalls += 1;
        if (firstKeyCalls === 1) {
          return new Response("slow down", { status: 429, headers: { "retry-after": "0" } });
        }
      }
      return Response.json({ choices: [{ message: { content: "{}" } }] });
    }) as typeof fetch;

    expect((await ask())?.credentialId).toBe("gemini-2");

    calls = [];
    expect((await ask())?.credentialId).toBe("gemini-1");
  });
});

describe("what is sent upstream", () => {
  it("addresses Gemini's OpenAI-compatible endpoint", async () => {
    respondWith([200]);
    await ask();

    expect(calls[0]!.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
  });

  it("addresses OpenAI directly once the chain reaches it", async () => {
    respondWith([429, 429, 429, 200]);
    await ask();

    expect(calls[3]!.url).toBe("https://api.openai.com/v1/chat/completions");
  });
});
