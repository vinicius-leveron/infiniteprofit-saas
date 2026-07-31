#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  cleanupProductionAuthQaFixture,
  createProductionAuthQaFixture,
} from "./production-auth-qa-fixture.mjs";
import { writeQaReport } from "./qa-common.mjs";

let fixture = null;
let exitCode = 1;
let stdout = "";
let stderr = "";
const startedAt = new Date().toISOString();

try {
  fixture = await createProductionAuthQaFixture();
  const result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    [
      "playwright",
      "test",
      "e2e/production-authenticated-qa.spec.ts",
      "--project=chromium",
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        E2E_PRODUCTION_AUTH_QA: "true",
        E2E_PRODUCTION_FIXTURE_PATH: fixture.statePath,
        PLAYWRIGHT_BASE_URL: fixture.state.publicUrl,
      },
      encoding: "utf8",
      stdio: "pipe",
    },
  );
  exitCode = result.status ?? 1;
  stdout = result.stdout ?? "";
  stderr = result.stderr ?? "";
  process.stdout.write(stdout);
  process.stderr.write(stderr);
} catch (error) {
  stderr = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${stderr}\n`);
} finally {
  if (fixture) {
    try {
      await cleanupProductionAuthQaFixture(fixture);
    } catch (cleanupError) {
      exitCode = 1;
      const message = cleanupError instanceof Error
        ? cleanupError.stack ?? cleanupError.message
        : String(cleanupError);
      stderr = `${stderr}\nCleanup failure: ${message}`.trim();
      process.stderr.write(`Cleanup failure: ${message}\n`);
    }
  }
}

writeQaReport("qa-production-auth.json", {
  gate: "qa:production:auth",
  generatedAt: new Date().toISOString(),
  temporaryFixtureCleaned: Boolean(fixture),
  results: [
    {
      name: "production authenticated journeys",
      status: exitCode === 0 ? "pass" : "blocker",
      exitCode,
      command: "playwright test e2e/production-authenticated-qa.spec.ts",
      startedAt,
      finishedAt: new Date().toISOString(),
      stdout,
      stderr,
    },
  ],
});

process.exit(exitCode);
