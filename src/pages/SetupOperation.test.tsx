import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SetupOperation from "./SetupOperation";

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
    functions: { invoke: vi.fn() },
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
  });

  it("selects existing workspace accounts and supports multiple new accounts", async () => {
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

    expect(screen.getAllByPlaceholderText("act_123 ou 123")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Adicionar conta" }));
    expect(screen.getAllByPlaceholderText("act_123 ou 123")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Revisão" }));
    expect(screen.getByText("2 conta(s) selecionada(s)")).toBeInTheDocument();
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

    expect(await screen.findByDisplayValue("123456")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Conta legada")).toBeInTheDocument();
    expect(screen.getByDisplayValue("token-legado")).toBeInTheDocument();
  });
});
