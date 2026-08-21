/**
 * A Function never sees the address the caller typed: the platform strips the
 * **Mount** on the way in, so a URL built from `request.url` alone points at the
 * gateway's root rather than at this page. The stripped prefix comes back on the
 * header below, and every URL this application puts in the document is built
 * from it.
 *
 * That is why nothing here is decided at build time. One Function answers on its
 * App's hostname, on any older slug a rename left resolving, on a preview URL,
 * and on the path form when a deployment enables it — four prefixes, one build.
 * A base baked into the bundle would be wrong on three of them.
 *
 * Relative URLs are not the way out. They resolve against the *document's* path,
 * and a page with client-side routing is served at whatever depth the router
 * asks for. Nor is a `<base>` element: it captures every relative URL on the
 * page, including the router's own links and every form action.
 *
 * `x-wawesome-` is the platform's reserved namespace and is stripped off every
 * inbound request, so a caller cannot forge this one — which is what makes it
 * safe to build links from. A conventional `x-forwarded-prefix` would be
 * whatever the caller said it was.
 */

export const FORWARDED_PREFIX_HEADER = "x-wawesome-forwarded-prefix";

/** The prefix every URL in the document hangs off. Empty at the mount root. */
export function baseOf(request: Request): string {
  return request.headers.get(FORWARDED_PREFIX_HEADER) ?? "";
}

/** Where one of this project's own files answers, under whatever base is in play. */
export function assetUrl(base: string, file: string): string {
  return `${base}/${file.replace(/^\/+/, "")}`;
}

/** The address the caller typed, reassembled from the three pieces held here. */
export function callerUrl(request: Request): string {
  const { pathname, search } = new URL(request.url);
  return baseOf(request) + pathname + search;
}
