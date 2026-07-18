#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const sourceRoot = path.join(root, "src");
const secretTables = [
  "workspace_integrations",
  "workspace_meta_accounts",
  "project_checkout_bindings",
];
const directAccessPattern = new RegExp(
  String.raw`\.from\s*\(\s*["'](${secretTables.join("|")})["']\s*\)`,
  "g",
);
const projectSyncTokenPattern =
  /\.from\s*\(\s*["']projects["']\s*\)\s*\.select\s*\(\s*["'`][^"'`]*\bsync_token\b[^"'`]*["'`]/gs;
const violations = [];

for (const filePath of listSourceFiles(sourceRoot)) {
  const source = readFileSync(filePath, "utf8");
  for (const match of source.matchAll(directAccessPattern)) {
    const index = match.index ?? 0;
    violations.push({
      file: path.relative(root, filePath),
      line: source.slice(0, index).split("\n").length,
      table: match[1],
    });
  }
  for (const match of source.matchAll(projectSyncTokenPattern)) {
    const index = match.index ?? 0;
    violations.push({
      file: path.relative(root, filePath),
      line: source.slice(0, index).split("\n").length,
      table: "projects.sync_token",
    });
  }
}

if (violations.length > 0) {
  console.error(
    "Secret boundary check failed. Browser code must use authorized RPCs or Edge Functions:",
  );
  for (const violation of violations) {
    console.error(
      `- ${violation.file}:${violation.line} directly accesses ${violation.table}`,
    );
  }
  process.exit(1);
}

console.log(
  "Secret boundary check passed: browser code has no direct access to credential tables.",
);

function listSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(entryPath);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [entryPath] : [];
  });
}
