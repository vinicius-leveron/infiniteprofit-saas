import { describe, expect, it } from "vitest";
import {
  buildSafeVaultStatements,
  buildStagingRuntimeInstallSql,
} from "../../scripts/staging-runtime-core.mjs";

describe("staging runtime SQL boundaries", () => {
  it("escapes values before they enter a management SQL query", () => {
    expect(buildSafeVaultStatements({
      projectUrl: "https://staging-ref.supabase.co",
      automationKey: "key'with-quote",
    })).toEqual({
      projectUrlLiteral: "'https://staging-ref.supabase.co'",
      automationKeyLiteral: "'key''with-quote'",
    });
  });

  it("rejects empty or null-byte values", () => {
    expect(() => buildSafeVaultStatements({
      projectUrl: "",
      automationKey: "key",
    })).toThrow(/must not be empty/i);
    expect(() => buildSafeVaultStatements({
      projectUrl: "https://staging-ref.supabase.co",
      automationKey: "bad\0key",
    })).toThrow(/null byte/i);
  });

  it("reapplies worker capacity tuning after reinstalling staging cron jobs", () => {
    const sql = buildStagingRuntimeInstallSql();

    expect(sql).toContain("install_sync_cron_jobs");
    expect(sql).toContain("tune_sync_worker_cron");
    expect(sql).toContain("install_backend_canary_cron");
  });
});
