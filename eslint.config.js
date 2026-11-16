import js from "@eslint/js";
import globals from "globals";

// Flat config (issue #12). Correctness rules from `recommended` stay errors;
// style is left to Prettier, and the few opinionated rules below are warnings
// so existing code passes while new code gets nudged.
export default [
  {
    ignores: ["dist/", "coverage/", "node_modules/", "playwright-report/", "test-results/", ".claude/", ".opencode/"],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: { ...globals.browser },
    },
    linterOptions: {
      reportUnusedDisableDirectives: "warn",
    },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "prefer-const": "warn",
      "no-var": "warn",
      eqeqeq: ["warn", "smart"],
      "no-useless-assignment": "warn",
    },
  },
  {
    // app.js is mid-refresh in parallel branches; flag dead code there as a
    // warning instead of failing CI on it.
    files: ["app.js"],
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
  {
    files: ["atlas/paint-worker.js"],
    languageOptions: { globals: { ...globals.worker } },
  },
  {
    files: ["scripts/**/*.mjs", "*.config.js", "tests/**/*.js"],
    languageOptions: { globals: { ...globals.node } },
  },
];
