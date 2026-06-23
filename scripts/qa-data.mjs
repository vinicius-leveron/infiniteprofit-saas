#!/usr/bin/env node
import { bin, exitForResults, runStep, writeQaReport } from "./qa-common.mjs";

const vitestTargets = [
  "src/lib/hublaImportFile.test.ts",
  "src/lib/dashboardRows.test.ts",
  "src/lib/dashboardFilters.test.ts",
  "src/lib/dashboardCoverage.test.ts",
  "src/lib/metaAccountFilter.test.ts",
  "tests/edge/hubla-csv-import-core.test.ts",
  "tests/edge/webhook-gateway-core.test.ts",
  "tests/edge/aggregate-daily-core.test.ts",
  "tests/edge/creative-jobs-admin-core.test.ts",
];

const results = [
  runStep("data contracts and edge parsers", bin("npx"), ["vitest", "run", ...vitestTargets]),
  runStep("supabase local function manifest", "npm", ["run", "check:function-manifest"]),
];

writeQaReport("qa-data.json", {
  gate: "qa:data",
  generatedAt: new Date().toISOString(),
  results,
});

exitForResults(results);
