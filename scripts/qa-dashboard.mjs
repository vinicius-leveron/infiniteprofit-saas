#!/usr/bin/env node
import { bin, exitForResults, runStep, writeQaReport } from "./qa-common.mjs";

const requiredEnv = ["E2E_EMAIL", "E2E_PASSWORD", "E2E_PROJECT_ID"];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
const allowSkipped = process.env.QA_ALLOW_SKIPPED_E2E === "1";
const results = [];

if (missingEnv.length > 0 && !allowSkipped) {
  results.push({
    name: "dashboard authenticated env",
    command: `required env: ${requiredEnv.join(", ")}`,
    status: "blocker",
    exitCode: 1,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    stderr: `Missing ${missingEnv.join(", ")}. Set QA_ALLOW_SKIPPED_E2E=1 only for local smoke runs.`,
  });
} else {
  results.push(
    runStep("authenticated dashboard regression", bin("npx"), [
      "playwright",
      "test",
      "e2e/authenticated-smoke.spec.ts",
      "e2e/dashboard-data-regression.spec.ts",
    ]),
  );
}

writeQaReport("qa-dashboard.json", {
  gate: "qa:dashboard",
  generatedAt: new Date().toISOString(),
  baseUrl: process.env.PLAYWRIGHT_BASE_URL ?? "local preview",
  missingEnv,
  results,
});

exitForResults(results);
