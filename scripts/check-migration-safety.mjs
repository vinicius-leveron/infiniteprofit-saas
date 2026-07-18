#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const migrationsDir = path.join(root, "supabase/migrations");
const onlineDir = path.join(root, "supabase/online-migrations");
const concurrentIndexPattern =
  /\bcreate\s+(?:unique\s+)?index\s+concurrently\b/gi;
const errors = [];

for (const file of sqlFiles(migrationsDir)) {
  const source = readFileSync(file, "utf8");
  if (concurrentIndexPattern.test(source)) {
    errors.push(
      `${relative(file)} contains CREATE INDEX CONCURRENTLY, but Supabase db push wraps migrations in an implicit transaction`,
    );
  }
  concurrentIndexPattern.lastIndex = 0;
}

for (const file of sqlFiles(onlineDir).filter((entry) =>
  /^\d+_.+\.sql$/.test(path.basename(entry)),
)) {
  const source = readFileSync(file, "utf8");
  const statements = [...source.matchAll(concurrentIndexPattern)];
  concurrentIndexPattern.lastIndex = 0;
  if (statements.length !== 1) {
    errors.push(
      `${relative(file)} must contain exactly one CREATE INDEX CONCURRENTLY statement`,
    );
  }
  if (/\b(?:begin|commit|rollback)\s*;/i.test(source)) {
    errors.push(`${relative(file)} must not open a transaction`);
  }
}

if (errors.length > 0) {
  console.error("Migration safety check failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  "Migration safety check passed: concurrent indexes are isolated from transactional migrations.",
);

function sqlFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => path.join(directory, entry.name));
}

function relative(file) {
  return path.relative(root, file);
}
