import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AcceptInvite from "./AcceptInvite";
import { readPendingInviteAuth } from "@/lib/authRedirect";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  refreshAccess: vi.fn(),
  setCurrentWorkspaceId: vi.fn(),
  auth: {
    user: { id: "user-1", email: "member@example.com" } as {
      id: string;
      email: string;
    } | null,
    loading: false,
  },
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
    user: mocks.auth.user,
    loading: mocks.auth.loading,
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
  return <p data-testid="location">{location.pathname}{location.search}</p>;
}

describe("AcceptInvite", () => {
  beforeEach(() => {
    sessionStorage.clear();
    mocks.invoke.mockReset();
    mocks.refreshAccess.mockReset();
    mocks.setCurrentWorkspaceId.mockReset();
    mocks.auth.user = { id: "user-1", email: "member@example.com" };
    mocks.auth.loading = false;
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

  it("opens account creation with the invited email for unauthenticated users", async () => {
    mocks.auth.user = null;
    sessionStorage.setItem(
      "infiniteprofit.pendingEmailConfirmation",
      JSON.stringify({ email: "stale@example.com", nextPath: "/clients" }),
    );

    render(
      <MemoryRouter initialEntries={["/accept-invite?kind=workspace&token=invite-token"]}>
        <Routes>
          <Route path="/accept-invite" element={<AcceptInvite />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/auth?next=%2Faccept-invite%3Fkind%3Dworkspace%26token%3Dinvite-token&mode=signup",
      );
    });
    expect(readPendingInviteAuth()).toEqual({
      email: "member@example.com",
      nextPath: "/accept-invite?kind=workspace&token=invite-token",
    });
    expect(
      sessionStorage.getItem("infiniteprofit.pendingEmailConfirmation"),
    ).toBeNull();
    expect(mocks.invoke).toHaveBeenCalledOnce();
  });
});
