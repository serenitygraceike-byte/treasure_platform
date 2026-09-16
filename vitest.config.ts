import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Integration tests need a live local Formance ledger (see
    // tests/integration/ledger.integration.test.ts) — excluded from the
    // default suite/CI, run explicitly via `pnpm test:integration`.
    exclude: ["node_modules/**", "tests/integration/**"],
  },
  resolve: {
    alias: {
      "@": root,
    },
  },
});
