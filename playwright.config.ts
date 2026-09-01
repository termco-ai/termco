import { defineConfig } from "@playwright/test";

// E2E drives the *real* built Electron app (dist/ + dist-electron/). Run `pnpm
// build` first (the test:e2e script does this). Electron apps are launched one
// at a time — no parallelism across files — to avoid GPU/PTY resource contention.
// macOS eventually stops presenting a first window when roughly eighty fresh
// Electron apps are launched through one long-lived Playwright worker. Four
// disjoint serial projects recycle that worker before the launch-service state
// degrades while preserving the suite's one-app-at-a-time contract.
export default defineConfig({
  testDir: "./e2e",
  testIgnore: "**/_*.spec.ts",
  outputDir: "./e2e/.output",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 1,
  projects: [
    {
      name: "shell-and-ai",
      testMatch:
        /(?:^|\/)(?:agents|ai-|app-|blocks|coding|command|containers|control|core|final|infrastructure|session).*\.spec\.ts$/,
    },
    {
      name: "workspace-and-integrations",
      testMatch:
        /(?:^|\/)(?:editor|explorer|files|git|header|lsp|markdown|mcp).*\.spec\.ts$/,
    },
    {
      name: "product-workflows",
      testMatch:
        /(?:^|\/)(?:onboarding|per-rig|perf|popup|ports|preview|profile|rig|search|settings|shortcuts|skills|source).*\.spec\.ts$/,
    },
    {
      name: "terminal-and-surfaces",
      testMatch:
        /(?:^|\/)(?:ssh|status|tabs|terminal|theme|trace|trajectory|web|workflows|zz).*\.spec\.ts$/,
    },
  ],
  reporter: [["list"], ["html", { outputFolder: "e2e/.report", open: "never" }]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
