import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SetupOperation from "./SetupOperation";

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
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
  useWorkspace: () => ({ currentWorkspace: { id: "workspace-1" } }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => createMetaAccountsQuery()),
    functions: { invoke: invokeMock },
  },
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
      return { data: { ok: true }, error: null };
    });
  });

  it("uses one token to discover and select multiple Meta accounts", async () => {
    render(
      <MemoryRouter initialEntries={["/setup-operation"]}>
        <SetupOperation />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Meta" }));

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

    fireEvent.click(screen.getByRole("button", { name: "Revisão" }));
    expect(screen.getByText("3 conta(s) selecionada(s)")).toBeInTheDocument();
  });

  it("migrates the previous single-account draft without losing its credentials", async () => {
    window.sessionStorage.setItem("infiniteprofit.setupOperationDraft.workspace-1", JSON.stringify({
      step: "meta",
      name: "Funil legado",
      metaAccountId: "123456",
      metaToken: "token-legado",
      metaLabel: "Conta legada",
      vturbKey: "",
      playersText: "",
      hublaSecret: "",
      webhookToken: "webhook-token",
    }));

    render(
      <MemoryRouter initialEntries={["/setup-operation"]}>
        <SetupOperation />
      </MemoryRouter>,
    );

    expect(await screen.findByDisplayValue("token-legado")).toBeInTheDocument();
    expect(screen.getByText("Conta legada")).toBeInTheDocument();
    expect(screen.getByText("act_123456")).toBeInTheDocument();
    expect(screen.getByText("1 de 1 selecionada(s)")).toBeInTheDocument();
  });
});
