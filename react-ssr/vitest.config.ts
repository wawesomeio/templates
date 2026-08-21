import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Your Function does not run on Node: no `Intl`, and a `toLocaleString`
    // that ignores the locale. This makes the suite meet that surface here
    // rather than in production, where the cost is a hydration mismatch.
    setupFiles: ["wawesome/vitest-setup"],
  },
});
