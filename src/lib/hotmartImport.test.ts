import { beforeEach, describe, expect, it, vi } from "vitest";
import { runHotmartImport } from "./hotmartImport";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: invokeMock },
  },
}));

describe("runHotmartImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the protected historical importer with a Hotmart provider", async () => {
    invokeMock.mockResolvedValue({
      data: {
        imported: "2",
        excluded: 1,
        skipped: 0,
        dates: ["2026-07-26"],
        warnings: ["moeda excluída"],
        headers: ["codigo_da_transacao"],
        kind: "hotmart_sales_export",
      },
      error: null,
    });

    await expect(
      runHotmartImport("project-1", "csv-content", true),
    ).resolves.toEqual({
      imported: 2,
      excluded: 1,
      skipped: 0,
      dates: ["2026-07-26"],
      warnings: ["moeda excluída"],
      headers: ["codigo_da_transacao"],
      kind: "hotmart_sales_export",
    });
    expect(invokeMock).toHaveBeenCalledWith("hubla-csv-import", {
      body: {
        project_id: "project-1",
        provider: "hotmart",
        csv: "csv-content",
        dry_run: true,
      },
    });
  });
});
