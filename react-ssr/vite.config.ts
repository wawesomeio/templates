import { reactRouter } from "@react-router/dev/vite";
import { defineConfig } from "vitest/config";

const workerConditions = ["worker", "browser"];

export default defineConfig(({ isSsrBuild }) => ({
  plugins: [reactRouter()],
  build: isSsrBuild ? { rollupOptions: { input: "./server.ts" } } : {},
  ssr: {
    noExternal: isSsrBuild ? true : undefined,
    resolve: { conditions: workerConditions, externalConditions: workerConditions },
  },
  test: {
    setupFiles: ["wawesome/vitest-setup"],
  },
}));
