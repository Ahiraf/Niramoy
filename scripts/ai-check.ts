/**
 * Niramoy — are the configured AI credentials actually reachable?
 *
 *   npm run ai:check
 *
 * The triage pipeline fails SAFE: when no model answers it silently falls back
 * to the deterministic rule engine (lib/ai/triage.ts). That is the right
 * behaviour clinically and a poor one to discover during a demo, because a
 * wrong API key looks exactly like a working system.
 *
 * With a failover chain that is doubly true: if key 1 is dead the assistant
 * still works, on key 2, and nothing on screen says so. This script checks
 * EVERY credential in the chain independently and reports each — so a key that
 * quietly stopped working is visible before it is the last one left.
 *
 * No patient text is ever sent here.
 */
import "./_bootstrap";

import { getEnv } from "../lib/config/env";
import { credentialChain, type Credential } from "../lib/ai/providers";

interface Outcome {
  credential: Credential;
  ok: boolean;
  detail: string;
  jsonMode?: boolean;
  elapsedMs: number;
}

async function probe(credential: Credential): Promise<Outcome> {
  const started = Date.now();

  try {
    const response = await fetch(`${credential.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credential.apiKey}`,
      },
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: credential.model,
        temperature: 0,
        // Triage relies on JSON mode. A provider that ignores it is worth
        // knowing about now rather than when a patient's triage falls back.
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: 'Reply only with JSON of the shape {"ok": true}.' },
          { role: "user", content: "Respond with the JSON object." },
        ],
      }),
    });

    const elapsedMs = Date.now() - started;
    const body = await response.text();

    if (!response.ok) {
      return {
        credential,
        ok: false,
        elapsedMs,
        detail: `${response.status} ${response.statusText} — ${body.slice(0, 160).replace(/\s+/g, " ")}`,
      };
    }

    const parsed = JSON.parse(body) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = parsed.choices?.[0]?.message?.content ?? "";

    let jsonMode = false;
    try {
      JSON.parse(content);
      jsonMode = true;
    } catch {
      /* the provider returned prose despite response_format */
    }

    return { credential, ok: true, elapsedMs, jsonMode, detail: content.slice(0, 80) };
  } catch (err) {
    return {
      credential,
      ok: false,
      elapsedMs: Date.now() - started,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  const env = getEnv();
  const chain = credentialChain();

  if (env.aiProvider !== "openai-compatible" || !chain.length) {
    console.log(
      [
        "",
        "AI provider: rules (deterministic engine)",
        "",
        "  No model credentials are set, so triage runs on the rule engine alone.",
        "  That is a supported configuration, not an error — the rules are the",
        "  safety layer and a model only ever refines them.",
        "",
        "  To connect one, set GEMINI_API_KEY_1 (and optionally _2, _3 and",
        "  OPENAI_API_KEY) in .env.local. See .env.example.",
        "",
      ].join("\n"),
    );
    return;
  }

  console.log(`\n▸ checking ${chain.length} credential(s), in failover order\n`);

  // Sequentially, not in parallel: several of these are usually the same
  // provider, and firing four at once is a good way to be rate-limited by the
  // very check meant to tell you whether you are rate-limited.
  const outcomes: Outcome[] = [];
  for (const credential of chain) {
    outcomes.push(await probe(credential));
  }

  for (const [i, outcome] of outcomes.entries()) {
    const { credential } = outcome;
    console.log(`${i + 1}. ${credential.id}  (${credential.provider}, ${credential.model})`);

    if (outcome.ok) {
      const json = outcome.jsonMode
        ? "JSON mode honoured"
        : "JSON MODE IGNORED — triage will discard replies it cannot parse";
      console.log(`   ✓ reachable in ${outcome.elapsedMs} ms — ${json}`);
    } else {
      console.log(`   ✗ ${outcome.detail}`);
    }
    console.log("");
  }

  const working = outcomes.filter((o) => o.ok);

  if (!working.length) {
    console.error(
      [
        "✗ no credential answered. Triage and visit summaries will run on the",
        "  deterministic fallbacks until at least one does.",
        "",
        "  401/403 — the key is wrong, or not enabled for this endpoint.",
        "  404     — the base URL is wrong, or the model id does not exist.",
        "  429     — rate limit or spent quota. This is the case the chain is",
        "            for, so it is only a problem when every key says it.",
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `✓ ${working.length} of ${outcomes.length} credentials working. ` +
      `Requests will be served by ${working[0]!.credential.id} until it is exhausted.\n`,
  );

  if (working.length < outcomes.length) {
    // Not a failure — the chain is doing its job — but a dead key is one less
    // than you think you have, and worth fixing before it matters.
    console.log(
      "  Some credentials failed. The chain covers that, but the failed ones\n" +
        "  are not the safety margin you configured. See above.\n",
    );
  }
}

main().catch((err) => {
  console.error("✗ ai:check failed");
  console.error(err);
  process.exit(1);
});
