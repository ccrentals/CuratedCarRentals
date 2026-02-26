import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:4173";
const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  expect: { timeout: 10_000 },

  outputDir: ".artifacts/test-results",

  fullyParallel: true,

  // CI hardening
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,

  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: ".artifacts/playwright-report" }],
  ],

  use: {
    baseURL,

    // Observability
    trace: isCI ? "on-first-retry" : "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",

    // Optional: tighten timeouts per action/navigation if you want
    // actionTimeout: 15_000,
    // navigationTimeout: 30_000,
  },

  projects: [
    {
      name: "iphone",
      use: {
        ...devices["iPhone 13"],
        browserName: "chromium",
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "android",
      use: {
        ...devices["Pixel 5"],
        browserName: "chromium",
        viewport: { width: 360, height: 800 },
      },
    },
    {
      name: "ipad",
      use: {
        ...devices["iPad (gen 7)"],
        browserName: "chromium",
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        browserName: "chromium",
        viewport: { width: 1440, height: 900 },
      },
    },
  ],

  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: isCI
          ? "NEXT_PUBLIC_DISABLE_BREAKPOINT_OVERLAY=1 NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY=e2e-public-key npm run build && npm run start -- --port 4173"
          : "NEXT_PUBLIC_DISABLE_BREAKPOINT_OVERLAY=1 NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY=e2e-public-key npm run dev -- --port 4173",
        url: baseURL,
        reuseExistingServer: !isCI,
        timeout: 120_000,
      },
});