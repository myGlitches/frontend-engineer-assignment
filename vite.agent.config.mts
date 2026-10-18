import { defineConfig } from "vite";

// The agent is injected into every preview page with one <script src="agent.js">.
// It is served by the pages server, so it is built straight into backend/pages.
export default defineConfig({
  publicDir: false,
  build: {
    outDir: "backend/pages",
    emptyOutDir: false,
    minify: false,
    sourcemap: false,
    lib: {
      entry: "frontend/src/agent/index.ts",
      formats: ["iife"],
      name: "FigrAgent",
      fileName: () => "agent.js",
    },
  },
});
