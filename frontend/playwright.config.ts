import { defineConfig, devices } from "@playwright/test";

const storageState = process.env.E2E_STORAGE_STATE;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  outputDir: process.env.E2E_OUTPUT_DIR || "/tmp/ignite-playwright-results",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://127.0.0.1:4173",
    ...(storageState ? { storageState } : {}),
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "webkit-mobile",
      use: { ...devices["iPhone 13"], browserName: "webkit" },
    },
  ],
});