/**
 * Niramoy — BM&DC registration verification
 * -----------------------------------------------------------------------------
 * This is how a REAL doctor gets onto Niramoy. There is no bulk import.
 *
 * Background
 * ----------
 * The Bangladesh Medical & Dental Council publishes a verification service at
 * https://verify.bmdc.org.bd/ . It answers exactly one question — "is
 * registration number X valid, and who does it belong to?" — one lookup at a
 * time, behind a captcha. There is no official API, no bulk export, and no
 * public list of all registered practitioners.
 *
 * Consequently Niramoy verifies *pull*, not *push*:
 *
 *    doctor registers  →  submits BM&DC no. + scanned certificate
 *                      →  status: pending
 *                      →  admin opens verify.bmdc.org.bd, checks the number,
 *                         records what the register said
 *                      →  status: verified  →  profile goes live & bookable
 *
 * On automation
 * -------------
 * We deliberately do NOT ship a captcha-solving scraper against BM&DC. The
 * captcha is an access control, and defeating it to harvest the register would
 * be both a terms violation and a privacy problem for practitioners who never
 * agreed to be listed on a third-party platform. If BM&DC (or an institution
 * with a data-sharing agreement) provides a real endpoint, set BMDC_API_URL and
 * `verifyRegistration` will use it; otherwise the flow stays human-in-the-loop,
 * which is exactly what the admin verification queue in the app is for.
 */

export const VERIFICATION_STATUS = {
  UNSUBMITTED: "unsubmitted",
  PENDING: "pending",
  VERIFIED: "verified",
  REJECTED: "rejected",
  EXPIRED: "expired",
};

export const REGISTRATION_TYPES = [
  { id: "mbbs", label: "MBBS (Medical)", prefix: "A" },
  { id: "bds", label: "BDS (Dental)", prefix: "D" },
  { id: "mat", label: "Medical Assistant (MAT)", prefix: "M" },
];

/**
 * Structural validation of a BM&DC registration number.
 *
 * BM&DC numbers are issued as a letter-prefixed serial (e.g. "A-45312" for a
 * medical registration, "D-8842" for dental). A bare serial is also accepted
 * and normalised. This checks SHAPE ONLY — a well-formed number is not a
 * verified number, and the UI must never present it as one.
 *
 * @returns {{ok: boolean, normalised?: string, type?: string, reason?: string}}
 */
export function validateRegistrationNumber(raw, declaredType) {
  if (raw == null) return { ok: false, reason: "missing" };
  const value = String(raw).trim().toUpperCase().replace(/\s+/g, "");
  if (!value) return { ok: false, reason: "missing" };

  const match = /^([ADM])?[-/]?(\d{3,7})$/.exec(value);
  if (!match) return { ok: false, reason: "malformed" };

  const [, prefixFromValue, serial] = match;
  const known = REGISTRATION_TYPES.find((t) => t.id === declaredType);
  const prefix = prefixFromValue || known?.prefix;
  if (!prefix) return { ok: false, reason: "type_required" };

  if (prefixFromValue && known && prefixFromValue !== known.prefix) {
    return { ok: false, reason: "type_mismatch" };
  }

  const type = REGISTRATION_TYPES.find((t) => t.prefix === prefix);
  if (!type) return { ok: false, reason: "unknown_prefix" };

  return { ok: true, normalised: `${prefix}-${serial}`, type: type.id };
}

/**
 * Look up a registration number.
 *
 * If BMDC_API_URL is configured (a real agreement-backed endpoint, or an
 * institutional proxy), it is called. Otherwise this returns `manual_required`,
 * which routes the application into the admin verification queue rather than
 * silently approving or silently failing.
 *
 * @returns {Promise<{status: string, source: string, record?: object, reason?: string}>}
 */
export async function verifyRegistration(registrationNumber, type) {
  const shape = validateRegistrationNumber(registrationNumber, type);
  if (!shape.ok) {
    return { status: VERIFICATION_STATUS.REJECTED, source: "format", reason: shape.reason };
  }

  const endpoint = process.env.BMDC_API_URL;
  if (!endpoint) {
    return {
      status: VERIFICATION_STATUS.PENDING,
      source: "manual_required",
      record: { registrationNumber: shape.normalised, type: shape.type },
      reason:
        "No BM&DC data-sharing endpoint is configured. An admin must confirm this " +
        "number against verify.bmdc.org.bd before the profile goes live.",
    };
  }

  try {
    const res = await fetch(
      `${endpoint}?reg=${encodeURIComponent(shape.normalised)}&type=${shape.type}`,
      { headers: { Accept: "application/json" }, cache: "no-store" }
    );
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const body = await res.json();
    return {
      status: body.valid ? VERIFICATION_STATUS.VERIFIED : VERIFICATION_STATUS.REJECTED,
      source: "bmdc_api",
      record: {
        registrationNumber: shape.normalised,
        type: shape.type,
        name: body.name ?? null,
        validTill: body.valid_till ?? null,
      },
    };
  } catch (err) {
    // Never fail open. An unreachable registry means "not yet verified".
    return {
      status: VERIFICATION_STATUS.PENDING,
      source: "manual_required",
      record: { registrationNumber: shape.normalised, type: shape.type },
      reason: `BM&DC lookup unavailable (${err.message}). Falling back to admin review.`,
    };
  }
}

/** The URL an admin opens to check a number by hand. */
export function bmdcVerifyUrl() {
  return "https://verify.bmdc.org.bd/";
}
