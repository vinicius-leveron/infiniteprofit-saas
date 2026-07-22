import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HublaImportDialog } from "./HublaImportDialog";

const { readHublaImportFileMock, runHublaImportMock, successToastMock } = vi.hoisted(() => ({
  readHublaImportFileMock: vi.fn(),
  runHublaImportMock: vi.fn(),
  successToastMock: vi.fn(),
}));

vi.mock("@/lib/hublaImportFile", () => ({
  readHublaImportFile: readHublaImportFileMock,
}));

vi.mock("@/lib/hublaImport", () => ({
  runHublaImport: runHublaImportMock,
}));

vi.mock("sonner", () => ({
  toast: { success: successToastMock },
}));

describe("HublaImportDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readHublaImportFileMock.mockResolvedValue({
      csv: "ID da fatura;Status da fatura\nfat-1;Aprovada",
      kind: "csv",
    });
    runHublaImportMock.mockResolvedValue({
      imported: 1,
      skipped: 0,
      dates: ["2026-07-01"],
      warnings: [],
      headers: ["ID da fatura"],
      kind: "hubla_events",
    });
  });

  it("requires a current validation before importing", async () => {
    const onImported = vi.fn();
    render(<HublaImportDialog projectId="project-1" onImported={onImported} />);

    fireEvent.click(screen.getByRole("button", { name: "Importar histórico Hubla" }));
    fireEvent.change(screen.getByLabelText(/Selecionar CSV ou XLSX da Hubla/i), {
      target: { files: [new File(["csv"], "hubla.csv", { type: "text/csv" })] },
    });

    expect(await screen.findByText("hubla.csv")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Importar histórico" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Validar arquivo" }));
    expect(await screen.findByText(/1 evento\(s\) reconhecido\(s\)/i)).toBeInTheDocument();
    expect(runHublaImportMock).toHaveBeenCalledWith(
      "project-1",
      expect.stringContaining("fat-1"),
      true,
    );

    const importButton = screen.getByRole("button", { name: "Importar histórico" });
    await waitFor(() => expect(importButton).toBeEnabled());
    fireEvent.click(importButton);

    await waitFor(() => {
      expect(runHublaImportMock).toHaveBeenCalledWith(
        "project-1",
        expect.stringContaining("fat-1"),
        false,
      );
      expect(onImported).toHaveBeenCalledTimes(1);
    });
  });
});
