import { hydrateRoot } from "react-dom/client";
import { base } from "virtual:wawesome/base";
import { loadActivity } from "./Activity.js";
import { App } from "./App.js";

/**
 * The base comes from the document the server rendered, not from the current
 * URL — a page with client-side routing is served at whatever depth the router
 * asks for, and `location.pathname` would give a different answer at each one.
 */
hydrateRoot(
  document.getElementById("root")!,
  <App base={base} address={base + location.pathname + location.search} activity={loadActivity()} />,
);
