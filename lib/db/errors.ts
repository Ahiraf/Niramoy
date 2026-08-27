/**
 * PostgreSQL error classification.
 *
 * Drizzle wraps driver errors, so the SQLSTATE and the constraint name live on
 * `cause` rather than on the error you actually catch. Everything here walks the
 * chain; reading only the top-level message misses the constraint name entirely
 * and silently turns an expected 409 into a 500.
 */

export const PG_ERRORS = {
  UNIQUE_VIOLATION: "23505",
  EXCLUSION_VIOLATION: "23P01",
  FOREIGN_KEY_VIOLATION: "23503",
  CHECK_VIOLATION: "23514",
  RESTRICT_VIOLATION: "23001",
  SERIALIZATION_FAILURE: "40001",
  DEADLOCK_DETECTED: "40P01",
} as const;

const MAX_DEPTH = 8;

/** Walk an error and its causes, yielding each link. */
function* chain(error: unknown, depth = 0): Generator<Record<string, unknown>> {
  if (!error || typeof error !== "object" || depth > MAX_DEPTH) return;
  const node = error as Record<string, unknown>;
  yield node;
  if (node.cause) yield* chain(node.cause, depth + 1);
  if (node.originalError) yield* chain(node.originalError, depth + 1);
}

export function sqlState(error: unknown): string | null {
  for (const node of chain(error)) {
    const code = node.code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    if (typeof code === "number") return String(code);
  }
  return null;
}

/** The violated constraint's name, when the driver reports one. */
export function constraintName(error: unknown): string | null {
  for (const node of chain(error)) {
    if (typeof node.constraint === "string" && node.constraint) return node.constraint;
  }
  return null;
}

/** Every message in the chain, joined — the fallback when nothing is structured. */
function messages(error: unknown): string {
  const parts: string[] = [];
  for (const node of chain(error)) {
    if (typeof node.message === "string") parts.push(node.message);
    if (typeof node.detail === "string") parts.push(node.detail);
  }
  return parts.join(" | ");
}

/** Does this error name the given constraint, structurally or in a message? */
function mentions(error: unknown, pattern: RegExp): boolean {
  const name = constraintName(error);
  if (name && pattern.test(name)) return true;
  return pattern.test(messages(error));
}

/**
 * Did this error come from an appointment overlapping another?
 *
 * Both guards count. The exclusion constraint catches a partial overlap; the
 * partial unique index catches an exact duplicate. To a caller they are the
 * same outcome — the slot is taken.
 */
export function isAppointmentConflict(error: unknown): boolean {
  if (sqlState(error) === PG_ERRORS.EXCLUSION_VIOLATION) return true;
  return mentions(
    error,
    /ex_appointments_(patient_)?no_overlap|uq_appointments_doctor_start_live/,
  );
}

/** Specifically: the PATIENT is already booked, rather than the doctor. */
export function isPatientDoubleBooking(error: unknown): boolean {
  return mentions(error, /ex_appointments_patient_no_overlap/);
}

/** Transient failures that are correct to retry. */
export function isRetryable(error: unknown): boolean {
  const state = sqlState(error);
  return state === PG_ERRORS.SERIALIZATION_FAILURE || state === PG_ERRORS.DEADLOCK_DETECTED;
}

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  const isUnique =
    sqlState(error) === PG_ERRORS.UNIQUE_VIOLATION ||
    /duplicate key value/i.test(messages(error));
  if (!isUnique) return false;
  return constraint ? mentions(error, new RegExp(constraint)) : true;
}

export function isCheckViolation(error: unknown, constraint?: string): boolean {
  const isCheck =
    sqlState(error) === PG_ERRORS.CHECK_VIOLATION ||
    /violates check constraint/i.test(messages(error));
  if (!isCheck) return false;
  return constraint ? mentions(error, new RegExp(constraint)) : true;
}
