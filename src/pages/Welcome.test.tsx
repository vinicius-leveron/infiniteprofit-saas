import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Welcome from "./Welcome";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  refreshAccess: vi.fn(),
  setCurrentWorkspaceId: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: mocks.rpc,
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "vinicius@example.com" },
  }),
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    organizations: [],
    hasWorkspaces: false,
    loading: false,
    refreshAccess: mocks.refreshAccess,
    setCurrentWorkspaceId: mocks.setCurrentWorkspaceId,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
  },
}));

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}</p>;
}

describe("Welcome", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.refreshAccess.mockReset();
    mocks.setCurrentWorkspaceId.mockReset();
    mocks.refreshAccess.mockResolvedValue(undefined);
  });

  it("bootstraps organization and client atomically before opening the first funnel", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ organization_id: "org-1", workspace_id: "client-1" }],
      error: null,
    });

    render(
      <MemoryRouter initialEntries={["/welcome"]}>
        <Routes>
          <Route path="/welcome" element={<Welcome />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(screen.getByLabelText("Nome da sua empresa ou agência")).toHaveValue(
        "Organização Vinicius",
      ),
    );
    fireEvent.change(screen.getByLabelText("Nome do primeiro cliente"), {
      target: { value: "Cliente Aurora" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Criar cliente e continuar" }));

    await waitFor(() =>
      expect(mocks.rpc).toHaveBeenCalledWith("bootstrap_account", {
        _organization_name: "Organização Vinicius",
        _workspace_name: "Cliente Aurora",
        _organization_id: null,
      }),
    );
    expect(mocks.refreshAccess).toHaveBeenCalledOnce();
    expect(mocks.setCurrentWorkspaceId).toHaveBeenCalledWith("client-1");
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/clients/client-1/funnels/new",
    );
  });
});
