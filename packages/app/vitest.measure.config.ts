import { defineConfig } from "vitest/config";

/** Measurement runs on the real Built-in model (`pnpm measure:import`, `pnpm measure:chat`); never part of `pnpm test`. */
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify("0.0.0-measure") },
  test: {
    include: ["scripts/measure/*.measure.ts"],
    testTimeout: 0,
    hookTimeout: 0,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
  },
});
