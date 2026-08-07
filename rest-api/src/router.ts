/**
 * Matching a request to one of this Function's routes.
 *
 * The platform mounts a Function at a prefix and strips that prefix before the
 * request arrives, so the path here is already relative to the mount: a call to
 * the Function's own address arrives as `/`, and everything beneath it arrives
 * with the prefix gone. Nothing in this file names the mount, and that is the
 * point — the same code answers under a Preview URL, which is a different
 * prefix, without a change. See the README.
 *
 * The platform also hands the path over exactly as the caller wrote it: no
 * percent-decoding, no collapsing of doubled separators, no trailing-slash
 * rewriting. Each of those is therefore a decision this router has to make, and
 * it makes them where you can see and change them.
 */

export type Params = Readonly<Record<string, string>>;

export interface Route<Handler> {
  method: string;
  /** A path relative to the mount, with `:name` for a captured segment. */
  pattern: string;
  handler: Handler;
}

export type RouteMatch<Handler> =
  | { outcome: "matched"; handler: Handler; params: Params }
  | { outcome: "wrong-method"; allow: string[] }
  | { outcome: "unmatched" }
  | { outcome: "undecodable" };

export function matchRoute<Handler>(
  routes: readonly Route<Handler>[],
  method: string,
  pathname: string,
): RouteMatch<Handler> {
  const segments = pathSegments(pathname);
  if (!segments) return { outcome: "undecodable" };

  // A resource that answers GET answers HEAD, so HEAD is looked up as GET and
  // the response body is dropped by the caller. Refusing it would be a claim
  // about the resource that is not true.
  const wanted = method === "HEAD" ? "GET" : method;

  const allow: string[] = [];
  let matched: RouteMatch<Handler> | undefined;

  for (const route of routes) {
    const params = bind(route.pattern, segments);
    if (!params) continue;

    allow.push(route.method);
    matched ??= route.method === wanted ? { outcome: "matched", handler: route.handler, params } : undefined;
  }

  if (matched) return matched;
  return allow.length > 0 ? { outcome: "wrong-method", allow } : { outcome: "unmatched" };
}

/** Bind one pattern to a path, or report that it does not describe this path. */
function bind(pattern: string, segments: readonly string[]): Params | null {
  const expected = pattern.split("/").slice(1);
  if (expected.length !== segments.length) return null;

  const params: Record<string, string> = {};

  for (const [index, part] of expected.entries()) {
    const segment = segments[index]!;

    if (!part.startsWith(":")) {
      if (part !== segment) return null;
      continue;
    }

    // An empty segment is not an identifier. This is what turns the doubled
    // separator the platform preserved into a 404, rather than a lookup for the
    // resource whose id is the empty string.
    if (segment.length === 0) return null;
    params[part.slice(1)] = segment;
  }

  return params;
}

/**
 * The path split the way the router compares it: split raw, then decode.
 *
 * The order is load-bearing. Decoding first would let a `%2F` inside an
 * identifier become a separator and turn one segment into two, so an id like
 * `acme/eu` would be routed as if it were a nested resource.
 */
function pathSegments(pathname: string): string[] | null {
  const raw = pathname.split("/").slice(1);

  // `/customers/` names the same thing as `/customers`. Exactly one is dropped,
  // so an interior `//` stays the empty segment it is.
  if (raw.length > 1 && raw[raw.length - 1] === "") raw.pop();

  const decoded: string[] = [];
  for (const segment of raw) {
    try {
      decoded.push(decodeURIComponent(segment));
    } catch {
      return null;
    }
  }

  return decoded;
}
