#!/usr/bin/env node
import { exitForResults, runStep, writeQaReport } from "./qa-common.mjs";

const results = [
  runStep("build", "npm", ["run", "build"]),
  runStep("lint", "npm", ["run", "lint"]),
  runStep("all unit tests", "npm", ["test"]),
  runStep("data QA gate", "npm", ["run", "qa:data"]),
  runStep("supabase function drift", "npm", ["run", "check:function-drift"]),
  runStep("dashboard QA gate", "npm", ["run", "qa:dashboard"]),
  runStep("production data QA gate", "npm", ["run", "qa:prod:data"]),
  runStep("production browser QA gate", "npm", ["run", "qa:prod"]),
];

writeQaReport("qa-release.json", {
  gate: "qa:release",
  generatedAt: new Date().toISOString(),
  results,
});

exitForResults(results);
