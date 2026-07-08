import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4173";
const useLocalServer = !process.env.PLAYWRIGHT_BASE_URL;
const publicSupabaseEnv = {
  VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? "https://nztnctrkmfrgclrnflfa.supabase.co",
  VITE_SUPABASE_PUBLISHABLE_KEY:
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im56dG5jdHJrbWZyZ2Nscm5mbGZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc4NDEyNzEsImV4cCI6MjA5MzQxNzI3MX0.GpBf50JXc8sorlE29_W2ej0zNEeYpAuv3Fg3JiBQ-U4",
  VITE_SUPABASE_PROJECT_ID: process.env.VITE_SUPABASE_PROJECT_ID ?? "nztnctrkmfrgclrnflfa",
  VITE_ENABLE_GOOGLE_AUTH: process.env.VITE_ENABLE_GOOGLE_AUTH ?? "false",
};

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: useLocalServer
    ? {
        command: "npm run build && npm run preview -- --host 127.0.0.1 --port 4173",
        url: baseURL,
        env: publicSupabaseEnv,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
