import { defineConfig } from "vitest/config";

// Unit tests run in Node by default; files that need a DOM opt in with
// a `// @vitest-environment jsdom` comment at the top.
export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.js"],
    environment: "node",
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["lib/**/*.js", "atlas/**/*.js", "scripts/**/*.mjs"],
      reporter: ["text", "html"],
    },
  },
});
