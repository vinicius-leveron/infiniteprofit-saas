import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SetupOperation from "./SetupOperation";

const { fromMock, invokeMock, rpcMock, readHublaImportFileMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  invokeMock: vi.fn(),
  rpcMock: vi.fn(),
  readHublaImportFileMock: vi.fn(),
}));

const metaAccounts = [
  {
    id: "meta-1",
    account_id: "act_111",
    label: "Conta Alpha",
    last_synced_at: null,
  },
  {
    id: "meta-2",
    account_id: "act_222",
    label: "Conta Beta",
    last_synced_at: null,
  },
];

function createMetaAccountsQuery() {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    then(
      onFulfilled: (value: { data: typeof metaAccounts; error: null }) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) {
      return Promise.resolve({ data: metaAccounts, error: null }).then(onFulfilled, onRejected);
    },
  };
  return query;
}

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" }, loading: false }),
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    currentWorkspace: { id: "workspace-1", name: "Cliente Alpha" },
    workspaces: [{ id: "workspace-1", name: "Cliente Alpha" }],
    loading: false,
    setCurrentWorkspaceId: vi.fn(),
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: fromMock,
    rpc: rpcMock,
    functions: { invoke: invokeMock },
  },
}));

vi.mock("@/lib/hublaImportFile", () => ({
  readHublaImportFile: readHublaImportFileMock,
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

describe("SetupOperation Meta step", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.clearAllMocks();
    fromMock.mockImplementation(() => createMetaAccountsQuery());
    rpcMock.mockImplementation((functionName: string) => ({
      abortSignal: vi.fn().mockResolvedValue({
        data:
          functionName === "list_workspace_meta_accounts_safe"
            ? metaAccounts.map((account, index) => ({
                ...account,
                workspace_id: "workspace-1",
                created_at: `2026-07-17T00:00:0${index}Z`,
                has_access_token: true,
              }))
            : [],
        error: null,
      }),
    }));
    readHublaImportFileMock.mockResolvedValue({
      csv: "ID da fatura;Status da fatura;Data de pagamento;Valor total\nfat-1;Aprovada;01/07/2026;R$ 200,00",
      kind: "csv",
    });
    invokeMock.mockImplementation(async (functionName: string, options?: { body?: Record<string, unknown> }) => {
      if (functionName === "meta-test" && options?.body?.action === "list_accounts") {
        return {
          data: {
            ok: true,
            accounts: [
              {
                id: "act_333",
                account_id: "act_333",
                name: "Conta Gamma",
                account_status: 1,
                currency: "BRL",
                timezone: "America/Sao_Paulo",
              },
              {
                id: "act_444",
                account_id: "act_444",
                name: "Conta Delta",
                account_status: 1,
                currency: "USD",
                timezone: "America/New_York",
              },
            ],
          },
          error: null,
        };
      }
      if (functionName === "hubla-csv-import") {
        return {
          data: {
            ok: true,
            imported: 1,
            skipped: 0,
            dates: ["2026-07-01"],
            warnings: [],
            headers: ["ID da fatura"],
          },
          error: null,
        };
      }
      return { data: { ok: true }, error: null };
    });
  });

  it("uses one token to discover and select multiple Meta accounts", async () => {
    render(
      <MemoryRouter initialEntries={["/setup-operation"]}>
        <SetupOperation />
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Nome"), {
      target: { value: "Funil teste" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fontes opcionais" }));

    expect(await screen.findByText("Conta Alpha")).toBeInTheDocument();
    expect(screen.getByText("Conta Beta")).toBeInTheDocument();

    const selectAllButton = screen.getByRole("button", { name: "Selecionar todas" });
    fireEvent.click(selectAllButton);

    await waitFor(() => {
      expect(screen.getByText("2 de 2 selecionada(s)")).toBeInTheDocument();
    });

    const tokenInput = screen.getByLabelText("Access token Meta");
    fireEvent.change(tokenInput, { target: { value: "token-unico" } });
    expect(screen.getAllByPlaceholderText("Cole o token Meta uma única vez")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Buscar contas" }));

    expect(await screen.findByText("Conta Gamma")).toBeInTheDocument();
    expect(screen.getByText("Conta Delta")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenCalledWith("meta-test", {
      body: {
        action: "list_accounts",
        workspace_id: "workspace-1",
        access_token: "token-unico",
      },
    });

    fireEvent.click(screen.getByText("Conta Gamma"));
    await waitFor(() => {
      expect(screen.getByText("1 de 2 selecionada(s)")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Buscar contas" }));
    await waitFor(() => {
      expect(screen.getByText("1 de 2 selecionada(s)")).toBeInTheDocument();
    });

    fireEvent.change(tokenInput, { target: { value: "token-alterado" } });
    expect(screen.getByText("Conta Gamma")).toBeInTheDocument();
    expect(screen.getByText("1 de 2 selecionada(s)")).toBeInTheDocument();
    expect(screen.getByText(/suas contas continuam marcadas/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Buscar contas" }));
    await waitFor(() => {
      expect(screen.queryByText(/suas contas continuam marcadas/i)).not.toBeInTheDocument();
    });
    const postponeButtons = screen.getAllByRole("button", { name: "Fazer depois" });
    fireEvent.click(postponeButtons[1]);
    fireEvent.click(postponeButtons[2]);
    fireEvent.click(screen.getByRole("button", { name: "Revisão" }));
    expect(screen.getByText("3 conta(s) selecionada(s)")).toBeInTheDocument();
  });

  it("keeps the accounts selected when a new Meta discovery attempt fails", async () => {
    render(
      <MemoryRouter initialEntries={["/setup-operation"]}>
        <SetupOperation />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Fontes opcionais" }));
    fireEvent.change(screen.getByLabelText("Access token Meta"), { target: { value: "token-unico" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar contas" }));
    fireEvent.click(await screen.findByText("Conta Gamma"));
    expect(await screen.findByText("1 de 2 selecionada(s)")).toBeInTheDocument();

    invokeMock.mockResolvedValueOnce({
      data: { ok: false, error: "The access token could not be decrypted" },
      error: null,
    });
    fireEvent.click(screen.getByRole("button", { name: "Buscar contas" }));

    expect(await screen.findByText(/a meta não aceitou este token/i)).toBeInTheDocument();
    expect(screen.getByText("Conta Gamma")).toBeInTheDocument();
    expect(screen.getByText("1 de 2 selecionada(s)")).toBeInTheDocument();
  });

  it("migrates a legacy draft without restoring or persisting its secrets", async () => {
    window.sessionStorage.setItem("infiniteprofit.setupOperationDraft.workspace-1", JSON.stringify({
      step: "meta",
      name: "Funil legado",
      metaAccountId: "123456",
      metaToken: "token-legado",
      metaLabel: "Conta legada",
      vturbKey: "vturb-legado",
      playersText: "",
      hublaSecret: "hubla-legado",
      webhookToken: "webhook-token",
    }));

    render(
      <MemoryRouter initialEntries={["/setup-operation"]}>
        <SetupOperation />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Nome/ }));
    expect(await screen.findByDisplayValue("Funil legado")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fontes opcionais" }));
    expect(screen.getByLabelText("Access token Meta")).toHaveValue("");
    expect(screen.getByLabelText("API key")).toHaveValue("");
    expect(screen.getByLabelText("Token/secret do webhook")).toHaveValue("");

    await waitFor(() => {
      const stored = window.sessionStorage.getItem(
        "infiniteprofit.setupOperationDraft.workspace-1",
      );
      expect(stored).not.toContain("token-legado");
      expect(stored).not.toContain("vturb-legado");
      expect(stored).not.toContain("hubla-legado");
      expect(stored).not.toContain("webhook-token");
      expect(JSON.parse(stored ?? "{}")).toMatchObject({
        version: 2,
        step: "fontes",
        name: "Funil legado",
      });
    });
  });

  it("keeps credentials out of sessionStorage while editing sources", async () => {
    render(
      <MemoryRouter initialEntries={["/setup-operation"]}>
        <SetupOperation />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Fontes opcionais" }));
    fireEvent.change(screen.getByLabelText("Access token Meta"), {
      target: { value: "meta-super-secret" },
    });
    fireEvent.change(screen.getByLabelText("API key"), {
      target: { value: "vturb-super-secret" },
    });
    fireEvent.change(screen.getByLabelText("Token/secret do webhook"), {
      target: { value: "gateway-super-secret" },
    });

    await waitFor(() => {
      const stored =
        window.sessionStorage.getItem(
          "infiniteprofit.setupOperationDraft.workspace-1",
        ) ?? "";
      expect(stored).not.toContain("meta-super-secret");
      expect(stored).not.toContain("vturb-super-secret");
      expect(stored).not.toContain("gateway-super-secret");
    });
  });

  it("opens the neutral activation experience when every source is postponed", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "projects") {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: "project-new" },
                error: null,
              }),
            })),
          })),
        };
      }
      return createMetaAccountsQuery();
    });

    render(
      <MemoryRouter initialEntries={["/setup-operation"]}>
        <Routes>
          <Route path="/setup-operation" element={<SetupOperation />} />
          <Route
            path="/funnels/:funnelId/activation"
            element={<div>Experiência de ativação</div>}
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Nome"), {
      target: { value: "Funil sem fontes" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fontes opcionais" }));
    screen
      .getAllByRole("button", { name: "Fazer depois" })
      .forEach((button) => fireEvent.click(button));
    fireEvent.click(screen.getByRole("button", { name: "Revisão" }));
    fireEvent.click(screen.getByRole("button", { name: "Criar funil" }));

    expect(await screen.findByText("Experiência de ativação")).toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "meta-pull",
      expect.anything(),
    );

    const storedPlan = JSON.parse(
      window.sessionStorage.getItem(
        "infiniteprofit.funnelActivation.project-new",
      ) ?? "{}",
    );
    expect(storedPlan).toMatchObject({
      projectId: "project-new",
      configuredSources: [],
      skippedSources: ["meta", "vturb", "gateway"],
      syncSources: [],
      syncState: "complete",
    });
  });

  it("imports a selected Hubla history after creating the funnel without persisting the file", async () => {
    fromMock.mockImplementation((table: string) => {
      if (table === "projects") {
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn().mockResolvedValue({
                data: { id: "project-hubla" },
                error: null,
              }),
            })),
          })),
        };
      }
      return createMetaAccountsQuery();
    });

    render(
      <MemoryRouter initialEntries={["/setup-operation"]}>
        <Routes>
          <Route path="/setup-operation" element={<SetupOperation />} />
          <Route
            path="/funnels/:funnelId/activation"
            element={<div>Experiência de ativação Hubla</div>}
          />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByLabelText("Nome"), {
      target: { value: "Funil com histórico" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Fontes opcionais" }));
    const postponeButtons = screen.getAllByRole("button", { name: "Fazer depois" });
    fireEvent.click(postponeButtons[0]);
    fireEvent.click(postponeButtons[1]);

    fireEvent.change(screen.getByLabelText(/Selecionar CSV ou XLSX da Hubla/i), {
      target: { files: [new File(["conteúdo sigiloso"], "hubla.csv", { type: "text/csv" })] },
    });

    expect(await screen.findByText("hubla.csv")).toBeInTheDocument();
    await waitFor(() => {
      const draft = window.sessionStorage.getItem(
        "infiniteprofit.setupOperationDraft.workspace-1",
      ) ?? "";
      expect(draft).not.toContain("fat-1");
      expect(draft).not.toContain("conteúdo sigiloso");
    });

    fireEvent.click(screen.getByRole("button", { name: "Revisão" }));
    expect(screen.getByText(/Histórico preparado · hubla.csv/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Criar funil" }));

    expect(await screen.findByText("Experiência de ativação Hubla")).toBeInTheDocument();
    expect(invokeMock).toHaveBeenNthCalledWith(
      1,
      "hubla-csv-import",
      expect.objectContaining({
        body: expect.objectContaining({
          project_id: "project-hubla",
          dry_run: true,
        }),
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      "hubla-csv-import",
      expect.objectContaining({
        body: expect.objectContaining({
          project_id: "project-hubla",
          dry_run: false,
        }),
      }),
    );

    const storedPlan = JSON.parse(
      window.sessionStorage.getItem(
        "infiniteprofit.funnelActivation.project-hubla",
      ) ?? "{}",
    );
    expect(storedPlan).toMatchObject({
      projectId: "project-hubla",
      configuredSources: ["gateway"],
      skippedSources: ["meta", "vturb"],
      syncSources: [],
      syncState: "complete",
    });
  });
});
