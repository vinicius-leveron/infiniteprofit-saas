import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AcceptInvite from "./AcceptInvite";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  refreshAccess: vi.fn(),
  setCurrentWorkspaceId: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: {
      invoke: mocks.invoke,
    },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "user-1", email: "member@example.com" },
    loading: false,
  }),
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    refreshAccess: mocks.refreshAccess,
    setCurrentWorkspaceId: mocks.setCurrentWorkspaceId,
  }),
}));

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}</p>;
}

describe("AcceptInvite", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.refreshAccess.mockReset();
    mocks.setCurrentWorkspaceId.mockReset();
    mocks.refreshAccess.mockResolvedValue(undefined);
    mocks.invoke.mockImplementation(
      async (_name: string, options: { body: { action: "preview" | "accept" } }) => {
        if (options.body.action === "preview") {
          return {
            data: {
              invite: {
                targetId: "client-1",
                targetName: "Cliente Aurora",
                organizationId: "org-1",
                organizationName: "Agência Atlas",
                email: "member@example.com",
                role: "member",
                expiresAt: "2027-07-17T12:00:00.000Z",
              },
            },
            error: null,
          };
        }
        return { data: { id: "client-1" }, error: null };
      },
    );
  });

  it("previews the invitation and waits for explicit acceptance", async () => {
    render(
      <MemoryRouter initialEntries={["/accept-invite?kind=workspace&token=invite-token"]}>
        <Routes>
          <Route path="/accept-invite" element={<AcceptInvite />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Cliente Aurora")).toBeInTheDocument();
    expect(screen.getByText("Agência Atlas")).toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(mocks.invoke).toHaveBeenLastCalledWith("accept-invite", {
      body: {
        action: "preview",
        kind: "workspace",
        token: "invite-token",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Aceitar convite" }));

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    expect(mocks.refreshAccess).toHaveBeenCalledOnce();
    expect(mocks.setCurrentWorkspaceId).toHaveBeenCalledWith("client-1");
    expect(screen.getByTestId("location")).toHaveTextContent("/clients/client-1/funnels");
  });
});
