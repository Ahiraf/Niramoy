/**
 * Niramoy — typed application errors
 * -----------------------------------------------------------------------------
 * Services throw these; the route wrapper turns them into the HTTP response.
 * Nothing else decides status codes, and no stack trace ever reaches a user.
 *
 * The `code` is a stable machine-readable string. It is part of the API
 * contract: clients may branch on it, and it must not change casually.
 */

export type ErrorCode =
  /* 400 */
  | "VALIDATION_FAILED"
  | "INVALID_TIME"
  | "UNKNOWN_ACTION"
  | "INPUT_TOO_LARGE"
  /* 401 */
  | "UNAUTHENTICATED"
  | "BAD_CREDENTIALS"
  | "SESSION_EXPIRED"
  /* 403 */
  | "FORBIDDEN"
  | "WRONG_ROLE"
  | "NOT_VERIFIED"
  | "CSRF_FAILED"
  /* 404 */
  | "NOT_FOUND"
  | "DOCTOR_NOT_FOUND"
  /* 409 */
  | "APPOINTMENT_CONFLICT"
  | "SLOT_UNAVAILABLE"
  | "EMAIL_TAKEN"
  | "ALREADY_REVIEWED"
  | "ALREADY_EXISTS"
  /* 422 */
  | "BMDC_INVALID"
  | "CANCEL_WINDOW_CLOSED"
  | "BOOKING_TOO_SOON"
  | "BOOKING_IN_PAST"
  | "NOT_ELIGIBLE"
  /* 429 */
  | "RATE_LIMITED"
  /* 500 / 503 */
  | "INTERNAL"
  | "PROVIDER_UNAVAILABLE"
  | "DATABASE_UNAVAILABLE";

const STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  INVALID_TIME: 400,
  UNKNOWN_ACTION: 400,
  INPUT_TOO_LARGE: 413,

  UNAUTHENTICATED: 401,
  BAD_CREDENTIALS: 401,
  SESSION_EXPIRED: 401,

  FORBIDDEN: 403,
  WRONG_ROLE: 403,
  NOT_VERIFIED: 403,
  CSRF_FAILED: 403,

  NOT_FOUND: 404,
  DOCTOR_NOT_FOUND: 404,

  APPOINTMENT_CONFLICT: 409,
  SLOT_UNAVAILABLE: 409,
  EMAIL_TAKEN: 409,
  ALREADY_REVIEWED: 409,
  ALREADY_EXISTS: 409,

  BMDC_INVALID: 422,
  CANCEL_WINDOW_CLOSED: 422,
  BOOKING_TOO_SOON: 422,
  BOOKING_IN_PAST: 422,
  NOT_ELIGIBLE: 422,

  RATE_LIMITED: 429,

  INTERNAL: 500,
  PROVIDER_UNAVAILABLE: 503,
  DATABASE_UNAVAILABLE: 503,
};

/**
 * Default user-facing messages. Safe to show verbatim: no internal detail, no
 * hint about whether a resource exists, no field the caller did not send.
 */
const MESSAGES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: "Some of the details you entered aren't valid.",
  INVALID_TIME: "That doesn't look like a valid time.",
  UNKNOWN_ACTION: "That action isn't supported.",
  INPUT_TOO_LARGE: "That's too long. Please shorten it and try again.",

  UNAUTHENTICATED: "Please sign in to continue.",
  BAD_CREDENTIALS: "That email and password don't match an account.",
  SESSION_EXPIRED: "Your session has expired. Please sign in again.",

  FORBIDDEN: "Your account doesn't have access to that.",
  WRONG_ROLE: "That account exists, but not for this role.",
  NOT_VERIFIED: "This account is still being verified.",
  CSRF_FAILED: "That request couldn't be verified. Please refresh and try again.",

  NOT_FOUND: "We couldn't find that.",
  DOCTOR_NOT_FOUND: "We couldn't find that doctor.",

  APPOINTMENT_CONFLICT: "This appointment slot is no longer available.",
  SLOT_UNAVAILABLE: "That slot is no longer available.",
  EMAIL_TAKEN: "An account already uses that email.",
  ALREADY_REVIEWED: "You've already reviewed this consultation.",
  ALREADY_EXISTS: "That already exists.",

  BMDC_INVALID: "That doesn't look like a valid BM&DC registration number.",
  CANCEL_WINDOW_CLOSED: "Appointments can't be cancelled this close to the visit.",
  BOOKING_TOO_SOON: "Appointments must be booked further in advance.",
  BOOKING_IN_PAST: "That time has already passed.",
  NOT_ELIGIBLE: "You aren't eligible to do that yet.",

  RATE_LIMITED: "Too many attempts. Please wait a moment and try again.",

  INTERNAL: "Something went wrong. Please try again.",
  PROVIDER_UNAVAILABLE: "That service is temporarily unavailable. Please try again shortly.",
  DATABASE_UNAVAILABLE: "We're having trouble reaching our systems. Please try again shortly.",
};

export interface AppErrorOptions {
  /** Overrides the default user-facing message. Must stay safe to display. */
  message?: string;
  /** Field-level detail for VALIDATION_FAILED. Never contains PHI. */
  details?: Record<string, string[]>;
  /** Internal-only context for the log. NEVER serialised into the response. */
  meta?: Record<string, unknown>;
  cause?: unknown;
  /** Seconds until the caller may retry. Sets the Retry-After header. */
  retryAfter?: number;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: Record<string, string[]>;
  readonly meta?: Record<string, unknown>;
  readonly retryAfter?: number;
  /** True for errors that are part of normal operation, so they log at info. */
  readonly expected: boolean;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    super(options.message ?? MESSAGES[code], options.cause ? { cause: options.cause } : undefined);
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.details = options.details;
    this.meta = options.meta;
    this.retryAfter = options.retryAfter;
    this.expected = this.status < 500;
  }

  /** The wire shape. Deliberately excludes `meta`, `cause` and the stack. */
  toJSON(): { code: ErrorCode; message: string; details?: Record<string, string[]> } {
    return { code: this.code, message: this.message, ...(this.details ? { details: this.details } : {}) };
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;

/* -------------------------------------------------------------------------- */
/* Constructors for the codes used most often                                  */
/* -------------------------------------------------------------------------- */

export const unauthenticated = (meta?: Record<string, unknown>) => new AppError("UNAUTHENTICATED", { meta });
export const forbidden = (meta?: Record<string, unknown>) => new AppError("FORBIDDEN", { meta });
export const notFound = (what: ErrorCode = "NOT_FOUND", meta?: Record<string, unknown>) => new AppError(what, { meta });
export const conflict = (code: ErrorCode = "ALREADY_EXISTS", meta?: Record<string, unknown>) => new AppError(code, { meta });
export const internal = (cause: unknown, meta?: Record<string, unknown>) => new AppError("INTERNAL", { cause, meta });

export function validationFailed(details: Record<string, string[]>, message?: string): AppError {
  return new AppError("VALIDATION_FAILED", { details, ...(message ? { message } : {}) });
}

/**
 * Wrap anything thrown into an AppError. Unknown throws become INTERNAL so a
 * raw driver message or stack can never reach the client.
 */
export function toAppError(e: unknown): AppError {
  if (isAppError(e)) return e;
  return internal(e);
}

/* -------------------------------------------------------------------------- */
/* Legacy reason mapping                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The existing frontend branches on the prototype's `reason` strings. Responses
 * carry both shapes during the migration (see docs/IMPLEMENTATION_PLAN.md, D3),
 * so nothing in the UI breaks while the backend moves underneath it.
 */
export const LEGACY_REASON: Record<ErrorCode, string> = {
  VALIDATION_FAILED: "validation_failed",
  INVALID_TIME: "invalid_time",
  UNKNOWN_ACTION: "unknown_action",
  INPUT_TOO_LARGE: "input_too_large",
  UNAUTHENTICATED: "unauthenticated",
  BAD_CREDENTIALS: "bad_credentials",
  SESSION_EXPIRED: "session_expired",
  FORBIDDEN: "forbidden",
  WRONG_ROLE: "wrong_role",
  NOT_VERIFIED: "not_verified",
  CSRF_FAILED: "csrf_failed",
  NOT_FOUND: "not_found",
  DOCTOR_NOT_FOUND: "doctor_not_found",
  APPOINTMENT_CONFLICT: "slot_taken",
  SLOT_UNAVAILABLE: "slot_unavailable",
  EMAIL_TAKEN: "email_taken",
  ALREADY_REVIEWED: "already_reviewed",
  ALREADY_EXISTS: "already_exists",
  BMDC_INVALID: "bmdc_malformed",
  CANCEL_WINDOW_CLOSED: "cancel_window_closed",
  BOOKING_TOO_SOON: "too_soon",
  BOOKING_IN_PAST: "in_past",
  NOT_ELIGIBLE: "not_eligible",
  RATE_LIMITED: "rate_limited",
  INTERNAL: "internal",
  PROVIDER_UNAVAILABLE: "provider_unavailable",
  DATABASE_UNAVAILABLE: "database_unavailable",
};
