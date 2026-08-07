/**
 * Building links that point back at this Function.
 *
 * A Function never sees the address the caller typed. It is mounted at a prefix,
 * the platform strips that prefix on the way in, and what arrives is a path
 * relative to the mount — so a `Location` built from `request.url` alone would
 * point at the gateway's root rather than at the resource.
 *
 * The stripped prefix comes back on a header, and origin plus prefix plus the
 * observed path reassembles the caller's URL byte for byte. The header sits in
 * the platform's reserved namespace, which is stripped from every inbound
 * request before the guest sees it: a caller cannot write it, which is what
 * makes it safe to build links from. A conventional `x-forwarded-prefix` would
 * be whatever the caller said it was.
 *
 * The one shape worth knowing: at the bare mount the observed path is `/`,
 * because no URL can carry an empty path. A link rebuilt for that request gains
 * a trailing slash that the caller did not type.
 */

export const FORWARDED_PREFIX_HEADER = "x-wawesome-forwarded-prefix";

/** This Function's public base — everything before the paths it routes on. */
export function mountUrl(request: Request): string {
  const { origin } = new URL(request.url);
  return origin + (request.headers.get(FORWARDED_PREFIX_HEADER) ?? "");
}

/**
 * An absolute link to one of this Function's resources.
 *
 * Segments are encoded here, mirroring the router's decode, so an identifier
 * carrying a separator survives the round trip as a single segment.
 */
export function resourceUrl(request: Request, ...segments: string[]): string {
  return mountUrl(request) + segments.map((segment) => `/${encodeURIComponent(segment)}`).join("");
}

/** The URL the caller reached this Function at, reassembled. */
export function callerUrl(request: Request): string {
  const { pathname, search } = new URL(request.url);
  return mountUrl(request) + pathname + search;
}
