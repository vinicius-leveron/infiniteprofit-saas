#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

export function runStep(name, command, args, options = {}) {
  const startedAt = new Date().toISOString();
  console.log(`\n[qa] ${name}`);
  console.log(`[qa] $ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
  const finishedAt = new Date().toISOString();
  const passed = result.status === 0;
  return {
    name,
    command: [command, ...args].join(" "),
    status: passed ? "pass" : "blocker",
    exitCode: result.status,
    startedAt,
    finishedAt,
    stdout: options.capture ? result.stdout : undefined,
    stderr: options.capture ? result.stderr : undefined,
  };
}

export function writeQaReport(fileName, payload) {
  const dir = path.join(process.cwd(), "qa-reports");
  mkdirSync(dir, { recursive: true });
  const out = path.join(dir, fileName);
  writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`[qa] relatório: ${out}`);
  return out;
}

export function exitForResults(results) {
  const failed = results.filter((result) => result.status === "blocker");
  if (failed.length > 0) {
    console.error(`[qa] ${failed.length} blocker(s): ${failed.map((item) => item.name).join(", ")}`);
    process.exit(1);
  }
}

export function bin(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}
