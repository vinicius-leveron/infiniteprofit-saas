import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260806150000_fix_production_function_lint.sql",
  "utf8",
);

describe("production function lint fixes", () => {
  it("types operational alert resolution timestamps explicitly", () => {
    expect(migration).toContain("null::timestamptz");
  });

  it("deletes checkout secrets through the installed Vault table", () => {
    expect(migration).toContain("delete from vault.secrets");
    expect(migration).not.toContain("vault.delete_secret");
  });

  it("keeps both helpers restricted to the service role", () => {
    expect(migration).toContain("grant execute on function public.suspend_workspace_meta_sync(uuid, text)");
    expect(migration).toContain("grant execute on function public.delete_checkout_integration_secret(uuid, text)");
    expect(migration.match(/to service_role;/g)).toHaveLength(2);
  });
});
