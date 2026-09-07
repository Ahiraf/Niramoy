/**
 * Niramoy — structured logging
 * -----------------------------------------------------------------------------
 * JSON lines to stdout. No dependency, because a serverless function's stdout is
 * already collected by the platform and an extra transport is just cold-start
 * cost.
 *
 * The important part of this module is not the formatting — it is `redact()`.
 * Logs from a health application must never contain credentials, session
 * tokens, or patient content. Anything whose key looks sensitive is replaced
 * before serialisation, and free-text clinical fields are dropped entirely
 * rather than truncated.
 */

import { getEnv } from "../config/env";

export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Keys whose values are replaced with "[redacted]". Matched case-insensitively. */
const SECRET_KEYS = [
  "password", "passwordhash", "password_hash", "newpassword", "currentpassword",
  "token", "sessiontoken", "session_token", "accesstoken", "refreshtoken",
  "authorization", "cookie", "setcookie", "set-cookie", "secret", "apikey",
  "api_key", "privatekey", "signature", "csrf", "csrftoken", "invitecode",
  "otp", "resettoken", "verificationtoken",
];

/**
 * Keys whose values are dropped completely. These carry patient content, and
 * there is no version of them that is safe in an operational log.
 */
const PHI_KEYS = [
  "symptoms", "symptomtext", "message", "transcript", "note", "notes",
  "diagnosis", "advice", "summary", "aisummary", "prescription", "items",
  "medicalhistory", "record", "records", "comment", "bio", "reason",
  "bmdcnumber", "phone", "address", "dateofbirth", "dob", "nid",
];

const MAX_DEPTH = 6;
const MAX_STRING = 512;

const normalise = (key: string) => key.toLowerCase().replace(/[^a-z]/g, "");

export function redact(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (depth > MAX_DEPTH) return "[depth-limit]";

  if (typeof value === "string") {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…[truncated]` : value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: value.message, ...(getEnv().isProd ? {} : { stack: value.stack }) };
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      const k = normalise(key);
      if (SECRET_KEYS.includes(k)) out[key] = "[redacted]";
      else if (PHI_KEYS.includes(k)) out[key] = "[omitted:phi]";
      else out[key] = redact(v, depth + 1);
    }
    return out;
  }
  return "[unserialisable]";
}

export interface LogContext {
  requestId?: string;
  route?: string;
  method?: string;
  userId?: string;
  role?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  /** A logger that carries the given context on every subsequent call. */
  child(context: LogContext): Logger;
}

function emit(level: LogLevel, message: string, context: LogContext): void {
  const env = getEnv();
  if (ORDER[level] < ORDER[env.LOG_LEVEL]) return;

  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg: message,
    ...(redact(context) as Record<string, unknown>),
  });

  // stdout for everything below warn keeps error streams clean for alerting.
  if (level === "error" || level === "warn") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export function createLogger(base: LogContext = {}): Logger {
  const make = (level: LogLevel) => (message: string, context: LogContext = {}) =>
    emit(level, message, { ...base, ...context });

  return {
    debug: make("debug"),
    info: make("info"),
    warn: make("warn"),
    error: make("error"),
    child: (context: LogContext) => createLogger({ ...base, ...context }),
  };
}

export const logger = createLogger({ service: "niramoy" });

/** Correlates every log line and audit row produced by one request. */
export function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}
