import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceProvider, useWorkspace } from "./useWorkspace";

const mocks = vi.hoisted(() => ({
  user: { id: "user-1", email: "owner@example.com" } as { id: string; email: string } | null,
  workspaceMemberships: [] as unknown[],
  organizationMemberships: [] as unknown[],
  inheritedWorkspaces: [] as unknown[],
}));

vi.mock("./useAuth", () => ({
  useAuth: () => ({
    user: mocks.user,
    loading: false,
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => {
        if (table === "workspaces") {
          return {
            in: vi.fn().mockImplementation(async () => ({
              data: mocks.inheritedWorkspaces,
              error: null,
            })),
          };
        }

        return {
          eq: vi.fn().mockImplementation(async () => ({
            data:
              table === "workspace_members"
                ? mocks.workspaceMemberships
                : mocks.organizationMemberships,
            error: null,
          })),
        };
      }),
    })),
  },
}));

function Probe() {
  const access = useWorkspace();
  if (access.loading) return <p>loading</p>;

  return (
    <>
      <p data-testid="onboarding">{String(access.needsOnboarding)}</p>
      <p data-testid="admin">{String(access.isWorkspaceAdmin)}</p>
      <pre data-testid="organizations">{JSON.stringify(access.organizations)}</pre>
      <pre data-testid="workspaces">{JSON.stringify(access.workspaces)}</pre>
    </>
  );
}

describe("WorkspaceProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.user = { id: "user-1", email: "owner@example.com" };
    mocks.workspaceMemberships = [];
    mocks.organizationMemberships = [];
    mocks.inheritedWorkspaces = [];
  });

  it("inherits every client from an organization and resolves the strongest role", async () => {
    mocks.organizationMemberships = [
      {
        role: "owner",
        organizations: { id: "org-1", name: "Agência Atlas" },
      },
    ];
    mocks.workspaceMemberships = [
      {
        role: "member",
        workspaces: {
          id: "client-1",
          name: "Cliente Um",
          organization_id: "org-1",
        },
      },
    ];
    mocks.inheritedWorkspaces = [
      { id: "client-1", name: "Cliente Um", organization_id: "org-1" },
      { id: "client-2", name: "Cliente Dois", organization_id: "org-1" },
    ];

    render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("admin")).toHaveTextContent("true"));
    const workspaces = JSON.parse(screen.getByTestId("workspaces").textContent ?? "[]");

    expect(workspaces).toEqual([
      expect.objectContaining({
        id: "client-2",
        role: "owner",
        accessOrigin: "organization",
      }),
      expect.objectContaining({
        id: "client-1",
        role: "owner",
        accessOrigin: "organization",
      }),
    ]);
  });

  it("keeps an explicit owner role when it is stronger than inherited admin access", async () => {
    mocks.organizationMemberships = [
      {
        role: "admin",
        organizations: { id: "org-1", name: "Agência Atlas" },
      },
    ];
    mocks.workspaceMemberships = [
      {
        role: "owner",
        workspaces: {
          id: "client-1",
          name: "Cliente Um",
          organization_id: "org-1",
        },
      },
    ];
    mocks.inheritedWorkspaces = [
      { id: "client-1", name: "Cliente Um", organization_id: "org-1" },
    ];

    render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("admin")).toHaveTextContent("true"));
    expect(JSON.parse(screen.getByTestId("workspaces").textContent ?? "[]")).toEqual([
      expect.objectContaining({
        role: "owner",
        accessOrigin: "workspace",
      }),
    ]);
  });

  it("keeps the organization context visible for a client-only member", async () => {
    mocks.workspaceMemberships = [
      {
        role: "member",
        workspaces: {
          id: "client-1",
          name: "Cliente Um",
          organization_id: "org-1",
          organizations: { name: "Agência Atlas" },
        },
      },
    ];

    render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("onboarding")).toHaveTextContent("false"));
    expect(JSON.parse(screen.getByTestId("organizations").textContent ?? "[]")).toEqual([
      {
        id: "org-1",
        name: "Agência Atlas",
        role: null,
      },
    ]);
    expect(JSON.parse(screen.getByTestId("workspaces").textContent ?? "[]")).toEqual([
      expect.objectContaining({
        id: "client-1",
        role: "member",
        accessOrigin: "workspace",
      }),
    ]);
  });

  it("requires onboarding only when the user has neither organization nor client", async () => {
    const { rerender } = render(
      <WorkspaceProvider>
        <Probe />
      </WorkspaceProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("onboarding")).toHaveTextContent("true"));

    mocks.organizationMemberships = [
      {
        role: "owner",
        organizations: { id: "org-1", name: "Agência Atlas" },
      },
    ];

    rerender(
      <WorkspaceProvider key="with-organization">
        <Probe />
      </WorkspaceProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("onboarding")).toHaveTextContent("false"));
  });
});
