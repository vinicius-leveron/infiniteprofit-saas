import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HotmartImportDialog } from "./HotmartImportDialog";

const { readFileMock, runImportMock, successToastMock } = vi.hoisted(() => ({
  readFileMock: vi.fn(),
  runImportMock: vi.fn(),
  successToastMock: vi.fn(),
}));

vi.mock("@/lib/hotmartImportFile", () => ({
  readHotmartImportFile: readFileMock,
}));

vi.mock("@/lib/hotmartImport", () => ({
  runHotmartImport: runImportMock,
}));

vi.mock("sonner", () => ({
  toast: { success: successToastMock },
}));

describe("HotmartImportDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    readFileMock.mockResolvedValue({
      csv: "Código da transação;Status da transação\nHP-1;Aprovado",
      kind: "xlsx",
      sheetName: "Report",
      discardedColumns: 34,
    });
    runImportMock.mockResolvedValue({
      imported: 1,
      excluded: 0,
      skipped: 0,
      dates: ["2026-07-29"],
      warnings: [],
      headers: ["codigo_da_transacao"],
      kind: "hotmart_sales_export",
    });
  });

  it("requires a green preview before importing", async () => {
    const onImported = vi.fn();
    render(
      <HotmartImportDialog
        projectId="project-1"
        onImported={onImported}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Importar planilha Hotmart" }),
    );
    fireEvent.change(
      screen.getByLabelText(/Selecionar XLS, XLSX ou CSV da Hotmart/i),
      {
        target: {
          files: [new File(["xlsx"], "hotmart.xls", {
            type: "application/vnd.ms-excel",
          })],
        },
      },
    );

    expect(await screen.findByText("hotmart.xls")).toBeInTheDocument();
    const importButton = screen.getByRole("button", {
      name: "Importar histórico",
    });
    expect(importButton).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: "Validar planilha" }),
    );
    expect(await screen.findByText("1 venda(s) elegível(is)")).toBeInTheDocument();
    expect(runImportMock).toHaveBeenCalledWith(
      "project-1",
      expect.stringContaining("HP-1"),
      true,
    );

    await waitFor(() => expect(importButton).toBeEnabled());
    fireEvent.click(importButton);
    await waitFor(() => {
      expect(runImportMock).toHaveBeenCalledWith(
        "project-1",
        expect.stringContaining("HP-1"),
        false,
      );
      expect(onImported).toHaveBeenCalledTimes(1);
    });
  });
});
