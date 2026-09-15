/**
 * npm run secrets:check — refuse to commit a credential.
 *
 * The check that already existed in CI looked for four variable names in
 * `NAME=value` form. That misses the way a key usually escapes: pasted into a
 * comment, a doc, or a test fixture, where there is no `NAME=` anywhere near it.
 * It also ran only in CI — and on a PUBLIC repository a secret that reaches CI
 * has already been published. Force-pushing it away does not unpublish it:
 * GitHub keeps orphaned objects reachable for a while, forks and clones keep
 * their own copies, and scrapers watch the public event firehose in real time.
 * The only fix at that point is rotation.
 *
 * So this runs in two places: as a pre-commit hook, which is the last moment
 * anything can still be prevented, and in CI as a backstop for commits made
 * where the hook was not installed.
 *
 * Two kinds of match:
 *
 *   1. SHAPES issued by a provider — `sk-...`, `AIza...`, a PEM header. These
 *      are unambiguous: nothing innocent looks like one, so they are worth
 *      catching wherever they appear.
 *   2. ASSIGNMENTS of a variable known to be sensitive, to something that is not
 *      obviously a placeholder. Necessarily fuzzier, so the placeholder list
 *      below is deliberately generous — a false positive blocks a commit, and
 *      the fastest way to make someone disable a hook is to have it cry wolf.
 */
import { execFileSync } from "node:child_process";

interface Rule {
  name: string;
  pattern: RegExp;
}

/** Provider-issued credential shapes. Nothing innocent looks like these. */
const SHAPES: Rule[] = [
  { name: "OpenAI API key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}/ },
  {
    name: "GitHub token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}/,
  },
  { name: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{33}/ },
  { name: "Google OAuth credential", pattern: /\bAQ\.Ab8[A-Za-z0-9_-]{20,}/ },
  { name: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { name: "AWS access key id", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "TextBee API key", pattern: /\btxb_[A-Za-z0-9]{20,}/ },
  { name: "Anthropic API key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "private key block", pattern: /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/ },
];

/**
 * Variables whose value is a credential. The app reads every one of these, and
 * every one has a real value sitting in an ignored file on somebody's machine —
 * which is exactly the value that gets pasted into the wrong place.
 */
const SENSITIVE = [
  "SESSION_SECRET",
  "CRON_SECRET",
  "NIRAMOY_ADMIN_CODE",
  "AI_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY_1",
  "GEMINI_API_KEY_2",
  "GEMINI_API_KEY_3",
  "EMAIL_API_KEY",
  "SMTP_PASSWORD",
  "TEXTBEE_API_KEY",
  "PAYMENT_API_KEY",
  "PAYMENT_API_SECRET",
  "PAYMENT_WEBHOOK_SECRET",
  "SSLCOMMERZ_STORE_ID",
  "SSLCOMMERZ_STORE_PASSWORD",
  "VIDEO_API_KEY",
  "VIDEO_API_SECRET",
  "RATE_LIMIT_STORE_TOKEN",
  "DATABASE_URL",
];

const ASSIGNMENT = new RegExp(`\\b(${SENSITIVE.join("|")})\\s*[=:]\\s*["']?([^\\s"'#,)}]{8,})`);

/**
 * Values that are documentation rather than credentials.
 *
 * Generous on purpose. Everything here is a template, a CI fixture, or a value
 * the repository deliberately publishes — and a scanner that blocks those is one
 * people learn to bypass with --no-verify, which costs more than it saves.
 */
const PLACEHOLDER =
  /^(?:<|\$|\{|your[-_]|my[-_]|the[-_]|some|xxx|x{4,}|changeme|replace|example|placeholder|dev-|test-|ci-|fake|dummy|null|none|undefined|todo)/i;

/** An elided value in prose: `postgresql://…`, `sk-...`, `<paste here>`. */
const ELIDED = /…|\.\.\.|<|\*{3,}/;

/**
 * A code expression rather than a value.
 *
 * Markdown quotes source — `SESSION_SECRET: z.string()` appears in SECURITY.md
 * describing this very scanner, and blocked the commit that added it. No
 * credential any provider issues contains a parenthesis, so treating one as
 * proof of code costs nothing and silences the whole class.
 */
const CODE = /\(|^(?:z|process|env|cfg|raw|config|options)\./;

/**
 * Where an ASSIGNMENT is worth flagging.
 *
 * Only config-shaped files. In TypeScript, `SESSION_SECRET: ...` is a zod schema
 * and `process.env.SMTP_PASSWORD = "app-password"` is a test fixture — scanning
 * those produced forty-one findings and zero secrets on this repository, which
 * is precisely the noise that gets a hook uninstalled.
 *
 * Source files are NOT unscanned: the SHAPES above still run over every file, so
 * a real key pasted into a .ts is still caught by looking like a real key, which
 * is the more reliable signal anyway.
 */
const ASSIGNMENT_SCOPE = /(?:^|\/)(?:\.env[\w.]*|[\w.-]+\.(?:txt|ya?ml|json|md|ini|conf|cfg|properties|sh))$/i;

/** Files that legitimately contain these words: the scanner, CI, and the template. */
const EXEMPT = ["scripts/secret-scan.ts", ".github/workflows/ci.yml", ".env.example"];

interface Finding {
  file: string;
  line: number;
  rule: string;
  excerpt: string;
}

function git(args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    // git's own stderr is discarded: asking for `HEAD:<path>` of a file that is
    // new in this commit legitimately fails, the caller handles it, and letting
    // the message through makes a passing run look like a broken one.
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** The files to look at, and how to read each one's content. */
function targets(staged: boolean): Array<{ path: string; read: () => string }> {
  const list = staged
    ? git(["diff", "--cached", "--name-only", "--diff-filter=ACM"])
    : git(["ls-files"]);

  return list
    .split("\n")
    .map((p) => p.trim())
    .filter(Boolean)
    .filter((p) => !EXEMPT.includes(p))
    .map((path) => ({
      path,
      /*
       * Staged CONTENT, not the working tree. The two differ whenever something
       * was added and then edited again, and the staged version is the one that
       * would actually ship.
       */
      read: () => {
        try {
          return staged ? git(["show", `:${path}`]) : git(["show", `HEAD:${path}`]);
        } catch {
          return "";
        }
      },
    }));
}

/** Binary content produces noise, not findings. A NUL byte is the giveaway. */
function isText(content: string): boolean {
  return !content.includes("\u0000");
}

/** Redacted evidence. A build log is not a safer home for a key than the file was. */
function excerptOf(value: string): string {
  return `${value.slice(0, 4)}…(${value.length} chars)`;
}

function scan(staged: boolean): Finding[] {
  const findings: Finding[] = [];

  for (const target of targets(staged)) {
    const content = target.read();
    if (!content || !isText(content)) continue;

    content.split("\n").forEach((line, index) => {
      for (const rule of SHAPES) {
        const hit = rule.pattern.exec(line);
        if (hit) {
          findings.push({
            file: target.path,
            line: index + 1,
            rule: rule.name,
            excerpt: excerptOf(hit[0]),
          });
        }
      }

      if (!ASSIGNMENT_SCOPE.test(target.path)) return;

      const assigned = ASSIGNMENT.exec(line);
      const value = assigned?.[2] ?? "";
      if (assigned && !PLACEHOLDER.test(value) && !ELIDED.test(value) && !CODE.test(value)) {
        findings.push({
          file: target.path,
          line: index + 1,
          rule: `${assigned[1]} has a value`,
          excerpt: excerptOf(value),
        });
      }
    });
  }

  return findings;
}

const staged = process.argv.includes("--staged");
const findings = scan(staged);

if (!findings.length) {
  console.log(`✓ no credentials in ${staged ? "the staged changes" : "the tracked tree"}`);
  process.exit(0);
}

console.error("");
console.error(`✗ ${findings.length} possible credential${findings.length === 1 ? "" : "s"}:`);
console.error("");
for (const finding of findings) {
  console.error(`  ${finding.file}:${finding.line}  ${finding.rule}  ${finding.excerpt}`);
}
console.error("");
console.error("  Move the value into an ignored file (.env.local) and read it by name.");
console.error("");
console.error("  If it is genuinely not a secret, add the file to EXEMPT in");
console.error("  scripts/secret-scan.ts and say why in the commit message.");
console.error("");
console.error("  If it IS a secret and has already been pushed to a public repo, removing");
console.error("  it now does not unpublish it. Rotate the credential.");
console.error("");
process.exit(1);
