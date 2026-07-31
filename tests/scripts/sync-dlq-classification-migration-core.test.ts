import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260731023000_classify_superseded_sync_jobs.sql",
  "utf8",
);

describe("superseded sync-job classification migration", () => {
  it("only resolves retryable dead letters after a newer successful window", () => {
    expect(migration).toContain("dead.status = 'dead_letter'");
    expect(migration).toContain(
      "coalesce(dead.payload -> 'failure' ->> 'kind', '') = 'retryable'",
    );
    expect(migration).toContain("newer.status = 'succeeded'");
    expect(migration).toContain("newer.date_end >= dead.date_end");
  });

  it("normalizes Meta profile suffixes by account id", () => {
    expect(migration).toContain("dead.payload ->> 'account_id'");
    expect(migration).toContain(
      "pg_catalog.split_part(coalesce(dead.entity_id, ''), ':', 1)",
    );
  });

  it("keeps classification service-only", () => {
    expect(migration).toMatch(
      /revoke all on function public\.classify_superseded_sync_jobs\(uuid\)[\s\S]*from public, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.classify_superseded_sync_jobs\(uuid\)[\s\S]*to service_role;/,
    );
  });
});
