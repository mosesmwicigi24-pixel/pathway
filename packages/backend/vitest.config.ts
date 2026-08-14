import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    globalSetup: ["./test/helpers/globalSetup.ts"],
    // Embedded Postgres takes a few seconds to boot; allow headroom.
    hookTimeout: 60_000,
    testTimeout: 30_000,
    // ...and its shutdown checkpoint grows with the run (a full suite truncates
    // every table ~1100 times, churning relfilenodes). At the 10s default the
    // teardown was abandoned mid-stop, orphaning the cluster on the fixed port
    // and breaking the NEXT run.
    teardownTimeout: 180_000,
    // One Postgres instance is shared, so run files serially to keep test
    // isolation deterministic (each test calls resetDb()).
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
