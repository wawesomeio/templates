/**
 * A Function never sees the address the caller typed: the mount is stripped on
 * the way in, so a `Location` built from `request.url` alone would point at the
 * gateway's root rather than at the resource. The stripped mount comes back on
 * the header below, and origin plus mount plus the observed path reassembles
 * the caller's URL byte for byte.
 *
 * `x-wawesome-` is the platform's reserved namespace and is stripped from every
 * inbound request, so a caller cannot forge this one — which is what makes it
 * safe to build links from. A conventional `x-forwarded-prefix` would be
 * whatever the caller said it was.
 */

export const FORWARDED_PREFIX_HEADER = "x-wawesome-forwarded-prefix";

export function mountUrl(request: Request): string {
  const { origin } = new URL(request.url);
  return origin + (request.headers.get(FORWARDED_PREFIX_HEADER) ?? "");
}

export function resourceUrl(request: Request, id: string): string {
  // Encoded here, mirroring the router's decode, so an identifier carrying a
  // separator survives the round trip as a single segment.
  return `${mountUrl(request)}/${encodeURIComponent(id)}`;
}

export function callerUrl(request: Request): string {
  const { pathname, search } = new URL(request.url);
  // At the bare mount the observed path is `/`, because no URL can carry an
  // empty path — so this one address gains a slash the caller did not type.
  return mountUrl(request) + pathname + search;
}
