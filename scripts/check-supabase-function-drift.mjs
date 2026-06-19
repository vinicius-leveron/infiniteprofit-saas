#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const localOnly = args.has("--local-only");
const manifestPath = valueArg("--manifest") ?? path.join(root, "supabase/functions/deploy-manifest.json");
const remoteJsonPath = valueArg("--remote-json");

const manifest = readJson(manifestPath);
const localFunctions = listLocalFunctions(path.join(root, "supabase/functions"));
const expectedRemote = sortedUnique(manifest.expectedRemoteFunctions ?? []);
const documentedExternal = sortedUnique((manifest.documentedExternalFunctions ?? []).map((item) => item.name));
const expectedRepoManaged = expectedRemote.filter((name) => !documentedExternal.includes(name));

const errors = [];
const warnings = [];

compareSets("local functions", localFunctions, "repo-managed manifest functions", expectedRepoManaged, errors);

for (const name of documentedExternal) {
  if (localFunctions.includes(name)) {
    warnings.push(`${name} is documented as external but now exists locally. Remove it from documentedExternalFunctions.`);
  }
  if (!expectedRemote.includes(name)) {
    errors.push(`${name} is documented as external but missing from expectedRemoteFunctions.`);
  }
}

if (!localOnly) {
  const remoteFunctions = remoteJsonPath
    ? parseRemoteFunctions(readFileSync(remoteJsonPath, "utf8"))
    : fetchRemoteFunctions(manifest.projectRef);
  compareSets("remote ACTIVE functions", remoteFunctions, "expected remote functions", expectedRemote, errors);
}

if (warnings.length) {
  console.warn("Supabase function drift warnings:");
  for (const warning of warnings) console.warn(`- ${warning}`);
}

if (errors.length) {
  console.error("Supabase function drift check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  localOnly
    ? `Supabase function manifest is consistent locally (${localFunctions.length} repo-managed functions).`
    : `Supabase function manifest matches local and remote inventory (${expectedRemote.length} expected remote functions).`,
);

function valueArg(name) {
  const exact = process.argv.indexOf(name);
  if (exact >= 0) return process.argv[exact + 1];
  const prefix = `${name}=`;
  const match = process.argv.find((arg) => arg.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read ${filePath}: ${error.message}`);
  }
}

function listLocalFunctions(functionsDir) {
  return sortedUnique(
    readdirSync(functionsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => existsSync(path.join(functionsDir, name, "index.ts"))),
  );
}

function fetchRemoteFunctions(projectRef) {
  const ref = process.env.SUPABASE_PROJECT_REF || projectRef;
  if (!ref) {
    throw new Error("Missing projectRef in manifest or SUPABASE_PROJECT_REF.");
  }
  const output = execFileSync("supabase", ["functions", "list", "--project-ref", ref, "-o", "json"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return parseRemoteFunctions(output);
}

function parseRemoteFunctions(raw) {
  const parsed = JSON.parse(extractJson(raw));
  const rows = Array.isArray(parsed) ? parsed : parsed.rows;
  if (!Array.isArray(rows)) {
    throw new Error("Remote functions JSON must be an array or contain a rows array.");
  }
  return sortedUnique(
    rows
      .filter((row) => !row.status || row.status === "ACTIVE")
      .map((row) => row.slug ?? row.name)
      .filter(Boolean),
  );
}

function extractJson(raw) {
  const trimmed = raw.trim();
  const firstArray = trimmed.indexOf("[");
  const firstObject = trimmed.indexOf("{");
  const start =
    firstArray === -1
      ? firstObject
      : firstObject === -1
        ? firstArray
        : Math.min(firstArray, firstObject);
  if (start < 0) throw new Error("No JSON payload found in Supabase CLI output.");

  const opener = trimmed[start];
  const closer = opener === "[" ? "]" : "}";
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let index = start; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (inString) {
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
    } else if (char === opener) {
      depth += 1;
    } else if (char === closer) {
      depth -= 1;
      if (depth === 0) return trimmed.slice(start, index + 1);
    }
  }

  throw new Error("Could not extract a complete JSON payload from Supabase CLI output.");
}

function compareSets(leftLabel, left, rightLabel, right, targetErrors) {
  const missingFromLeft = right.filter((item) => !left.includes(item));
  const missingFromRight = left.filter((item) => !right.includes(item));
  if (missingFromLeft.length) {
    targetErrors.push(`${leftLabel} missing entries from ${rightLabel}: ${missingFromLeft.join(", ")}`);
  }
  if (missingFromRight.length) {
    targetErrors.push(`${rightLabel} missing entries from ${leftLabel}: ${missingFromRight.join(", ")}`);
  }
}

function sortedUnique(values) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}
