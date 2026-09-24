import { createRequestHandler } from "react-router";
import * as build from "virtual:react-router/server-build";

const handler = createRequestHandler(build);

export default {
  async fetch(request: Request): Promise<Response> {
    // The runtime traps on any read of `signal` on the incoming request, and
    // React Router reads it. A request built here has a working one.
    const { method, url, headers } = request;
    const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();
    return handler(new Request(url, { method, headers, body }));
  },
};
