import { beforeEach, describe, expect, it, vi } from "vitest";
import { runHublaImport } from "./hublaImport";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: invokeMock },
  },
}));

describe("runHublaImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends a dry run without mutating the requested payload", async () => {
    invokeMock.mockResolvedValue({
      data: {
        imported: "3",
        skipped: 1,
        dates: ["2026-07-01"],
        warnings: ["linha ignorada"],
        headers: ["ID da fatura"],
        kind: "hubla_events",
      },
      error: null,
    });

    await expect(runHublaImport("project-1", "csv-content", true)).resolves.toEqual({
      imported: 3,
      skipped: 1,
      dates: ["2026-07-01"],
      warnings: ["linha ignorada"],
      headers: ["ID da fatura"],
      kind: "hubla_events",
    });
    expect(invokeMock).toHaveBeenCalledWith("hubla-csv-import", {
      body: {
        project_id: "project-1",
        csv: "csv-content",
        dry_run: true,
      },
    });
  });

  it("surfaces importer errors", async () => {
    invokeMock.mockResolvedValue({
      data: { error: "CSV Hubla inválido" },
      error: null,
    });

    await expect(runHublaImport("project-1", "invalid", false)).rejects.toThrow(
      "CSV Hubla inválido",
    );
  });
});
