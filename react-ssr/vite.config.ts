import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import wawesome from "wawesome/vite";

export default defineConfig({
  plugins: [react(), wawesome()],
});
