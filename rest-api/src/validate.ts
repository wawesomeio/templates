/**
 * Turning an untrusted request body into something worth storing, or into the
 * reason it will not be.
 *
 * The endpoint is public, so every field arriving here is attacker-controlled.
 * Deciding this with no network and no database involved is what makes each
 * refusal cheap to enforce and cheap to test — every path below is covered
 * without a single mock.
 */

import type { CustomerDraft } from "./store.js";

export const LIMITS = {
  /**
   * The raw body, checked before parsing, so a hostile caller cannot make the
   * Function parse megabytes of JSON only to be told a name was too long.
   */
  maxBodyChars: 8_000,
  maxNameChars: 200,
  maxEmailChars: 320,
} as const;

export type Parsed<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

/** Fields the server owns. Ignored on the way in so a read-modify-write works. */
const SERVER_OWNED = new Set(["id", "created_at", "self"]);

const deny = (status: number, error: string): Parsed<never> => ({ ok: false, status, error });

export function parseCustomerDraft(contentType: string | null, raw: string): Parsed<CustomerDraft> {
  if (!isJson(contentType)) {
    return deny(415, "Send this as application/json.");
  }

  if (raw.length > LIMITS.maxBodyChars) {
    return deny(413, `Request body is too large (limit ${LIMITS.maxBodyChars} characters).`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return deny(400, "Request body must be JSON.");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return deny(400, "Request body must be a JSON object.");
  }

  const unknown = Object.keys(parsed).filter((key) => !SERVER_OWNED.has(key) && key !== "name" && key !== "email");
  if (unknown.length > 0) {
    // Named generically rather than by echoing the keys back — see the tests.
    return deny(400, "Only 'name' and 'email' can be set on a customer.");
  }

  const { name, email } = parsed as { name?: unknown; email?: unknown };

  const checkedName = text(name, "name", LIMITS.maxNameChars);
  if (!checkedName.ok) return checkedName;

  const checkedEmail = text(email, "email", LIMITS.maxEmailChars);
  if (!checkedEmail.ok) return checkedEmail;

  // Deliberately the weakest check that is still true: an address either has a
  // local part and a domain or it does not. Everything past that belongs to a
  // confirmation mail, not to a regular expression.
  if (!/^[^@\s]+@[^@\s]+$/.test(checkedEmail.value)) {
    return deny(400, "'email' must be an email address.");
  }

  return { ok: true, value: { name: checkedName.value, email: checkedEmail.value } };
}

function text(value: unknown, field: string, limit: number): Parsed<string> {
  if (typeof value !== "string") {
    return deny(400, `'${field}' must be a string.`);
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return deny(400, `'${field}' cannot be empty.`);
  }
  if (trimmed.length > limit) {
    return deny(400, `'${field}' is too long (limit ${limit} characters).`);
  }

  return { ok: true, value: trimmed };
}

function isJson(contentType: string | null): boolean {
  return contentType !== null && contentType.split(";")[0]!.trim().toLowerCase() === "application/json";
}
