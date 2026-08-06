import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260806140000_feedback_shadow_foundations.sql",
  "utf8",
);

describe("feedback shadow foundations migration", () => {
  it("keeps filtered dimension totals capped by the canonical daily total", () => {
    expect(migration).toContain("least(base.investimento");
    expect(migration).toContain("least(base.vendas_front");
    expect(migration).toContain("least(base.fat_bruto");
  });

  it("supports active-in-period dimensions and the unattributed bucket", () => {
    expect(migration).toContain("_activity = 'all' or metric.investimento > 0");
    expect(migration).toContain("_include_unattributed boolean default false");
    expect(migration).toContain("greatest(base.fat_bruto - coalesce(attributed.fat_bruto, 0), 0)");
  });

  it("keeps payment identities private and exposes only an admin summary", () => {
    expect(migration).toContain("revoke all on table public.payment_attempt_signals from public, anon, authenticated");
    expect(migration).toContain("create or replace function public.get_payment_attempt_shadow_summary");
    expect(migration).not.toContain("returns table (\n  email");
  });
});
