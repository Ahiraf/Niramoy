/**
 * Niramoy — is the configured AI provider actually reachable?
 *
 *   npm run ai:check
 *
 * The triage pipeline fails SAFE: when the model is unreachable it silently
 * falls back to the deterministic rule engine (lib/ai/triage.ts). That is the
 * right behaviour clinically and a poor one to discover during a demo, because
 * a wrong API key looks exactly like a working system. This script makes the
 * difference visible: it calls the provider the way triage does, with a benign
 * non-clinical prompt, and reports what came back.
 *
 * No patient text is ever sent here.
 */
import "./_bootstrap";

import { getEnv } from "../lib/config/env";

async function main(): Promise<void> {
  const env = getEnv();

  if (env.aiProvider !== "openai-compatible") {
    console.log(
      [
        "",
        "AI provider: rules (deterministic engine)",
        "",
        "  No AI_API_KEY / AI_BASE_URL is set, so triage runs on the rule engine",
        "  alone. That is a supported configuration, not an error — the rules are",
        "  the safety layer and the model only ever refines them.",
        "",
        "  To connect a model, set AI_BASE_URL, AI_API_KEY and AI_MODEL in",
        "  .env.local. See .env.example for a Gemini example.",
        "",
      ].join("\n"),
    );
    return;
  }

  const url = `${env.AI_BASE_URL!.replace(/\/$/, "")}/chat/completions`;
  const model = env.AI_MODEL ?? "gpt-4o-mini";

  console.log(`\n▸ calling ${url}\n  model: ${model}`);

  const started = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.AI_API_KEY}`,
    },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      model,
      temperature: 0,
      // Triage relies on JSON mode. A provider that ignores it is worth knowing
      // about now rather than when a patient's triage silently falls back.
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: 'Reply only with JSON of the shape {"ok": true}.' },
        { role: "user", content: "Respond with the JSON object." },
      ],
    }),
  });

  const elapsed = Date.now() - started;
  const body = await response.text();

  if (!response.ok) {
    console.error(`\n✗ ${response.status} ${response.statusText} after ${elapsed} ms\n`);
    console.error(body.slice(0, 600));
    console.error(
      [
        "",
        "  401/403 — the key is wrong, or not enabled for this endpoint.",
        "  404     — AI_BASE_URL is wrong. It must end at the path that has",
        "            /chat/completions under it, with no trailing slash.",
        "  429     — free-tier rate limit. Wait, or use a smaller model.",
        "",
      ].join("\n"),
    );
    process.exitCode = 1;
    return;
  }

  const parsed = JSON.parse(body) as {
    model?: string;
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

  console.log(
    [
      "",
      `✓ reachable — ${elapsed} ms`,
      `  model returned: ${parsed.model ?? "(unreported)"}`,
      `  JSON mode: ${jsonMode ? "honoured" : "IGNORED — triage will discard replies it cannot parse"}`,
      `  reply: ${content.slice(0, 120)}`,
      "",
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error("✗ ai:check failed");
  console.error(err);
  process.exit(1);
});
