import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

// Separate from vitest.config.ts (which excludes this directory) so
// `pnpm test`/CI never picks these up — they need a live local Formance
// ledger. Run explicitly via `pnpm test:integration`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": root,
    },
  },
});
