import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260730202000_fix_checkout_binding_project_id_ambiguity.sql",
  "utf8",
);

describe("checkout binding ambiguity migration", () => {
  it("targets the primary-key constraint instead of an ambiguous output column", () => {
    expect(migration).toContain(
      "on conflict on constraint project_checkout_bindings_pkey do update",
    );
    expect(migration).not.toContain("on conflict (project_id) do update");
  });

  it("preserves the service-role-only write boundary", () => {
    expect(migration).toMatch(
      /revoke all on function public\.save_checkout_binding\([\s\S]*from public, anon, authenticated;/,
    );
    expect(migration).toMatch(
      /grant execute on function public\.save_checkout_binding\([\s\S]*to service_role;/,
    );
  });
});
