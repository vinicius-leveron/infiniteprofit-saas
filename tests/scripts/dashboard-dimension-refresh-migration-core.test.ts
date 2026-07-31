import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260731023500_optimize_dashboard_dimension_refresh.sql",
  "utf8",
);

describe("dashboard dimension refresh optimization", () => {
  it("scopes checkout attribution to the requested dates", () => {
    expect(migration).toContain(
      "and (_dates is null or event.event_date = any(_dates))",
    );
  });

  it("does not run UTM matching when ad_id is already available", () => {
    expect(migration).toContain(
      "and nullif(event.payload->>'ad_id', '') is null",
    );
  });

  it("gives the service refresh enough time without allowing an unbounded query", () => {
    expect(migration).toContain("set statement_timeout to '35s'");
  });
});
