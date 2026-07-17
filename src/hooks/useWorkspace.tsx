import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

const STORAGE_KEY = "infiniteprofit.currentWorkspaceId";

export type OrganizationRole = "owner" | "admin";
export type WorkspaceRole = "owner" | "admin" | "moderator" | "member";
export type EffectiveWorkspaceRole = WorkspaceRole;
export type WorkspaceAccessOrigin = "workspace" | "organization";

export interface OrganizationAccess {
  id: string;
  name: string;
  role: OrganizationRole | null;
}

export interface WorkspaceAccess {
  id: string;
  name: string;
  organization_id: string;
  role: EffectiveWorkspaceRole;
  accessOrigin: WorkspaceAccessOrigin;
}

interface WorkspaceSummary {
  id: string;
  name: string;
  organization_id: string;
  organizations?: { name: string } | Array<{ name: string }> | null;
}

interface WorkspaceMemberWithWorkspace {
  role: WorkspaceRole;
  workspaces:
    | WorkspaceSummary
    | WorkspaceSummary[]
    | null;
}

interface OrganizationMemberWithOrganization {
  role: OrganizationRole;
  organizations:
    | {
        id: string;
        name: string;
      }
    | Array<{
        id: string;
        name: string;
      }>
    | null;
}

interface WorkspaceContextValue {
  loading: boolean;
  error: string | null;
  workspaces: WorkspaceAccess[];
  organizations: OrganizationAccess[];
  currentWorkspace: WorkspaceAccess | null;
  currentWorkspaceId: string | null;
  currentOrganization: OrganizationAccess | null;
  currentWorkspaceRole: WorkspaceRole | null;
  currentOrganizationRole: OrganizationRole | null;
  hasWorkspaces: boolean;
  needsOnboarding: boolean;
  isWorkspaceAdmin: boolean;
  isOrganizationAdmin: boolean;
  setCurrentWorkspaceId: (workspaceId: string | null) => void;
  refreshAccess: () => Promise<void>;
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

const ROLE_WEIGHT: Record<EffectiveWorkspaceRole, number> = {
  owner: 4,
  admin: 3,
  moderator: 2,
  member: 1,
};

function resolveWorkspaceAccess(
  directRole: WorkspaceRole | null,
  organizationRole: OrganizationRole | null,
): Pick<WorkspaceAccess, "role" | "accessOrigin"> | null {
  const inheritedRole: EffectiveWorkspaceRole | null = organizationRole;

  if (!directRole && !inheritedRole) return null;
  if (!inheritedRole || (directRole && ROLE_WEIGHT[directRole] >= ROLE_WEIGHT[inheritedRole])) {
    return {
      role: directRole as EffectiveWorkspaceRole,
      accessOrigin: "workspace",
    };
  }

  return {
    role: inheritedRole,
    accessOrigin: "organization",
  };
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceAccess[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationAccess[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceIdState] = useState<string | null>(null);

  const setCurrentWorkspaceId = useCallback((workspaceId: string | null) => {
    setCurrentWorkspaceIdState(workspaceId);
    if (workspaceId) {
      localStorage.setItem(STORAGE_KEY, workspaceId);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const refreshAccess = useCallback(async () => {
    if (!userId) {
      setWorkspaces([]);
      setOrganizations([]);
      setCurrentWorkspaceId(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const [{ data: workspaceRows, error: workspaceError }, { data: orgRows, error: orgError }] =
      await Promise.all([
        supabase
          .from("workspace_members")
          .select("role, workspaces(id, name, organization_id, organizations(name))")
          .eq("user_id", userId),
        supabase
          .from("organization_members")
          .select("role, organizations(id, name)")
          .eq("user_id", userId),
      ]);

    let mappedOrganizations: OrganizationAccess[] = [];
    if (orgError) {
      console.error("organization access load failed", orgError);
    } else {
      mappedOrganizations = ((orgRows ?? []) as OrganizationMemberWithOrganization[])
        .map((row) => {
          const organization = Array.isArray(row.organizations) ? row.organizations[0] : row.organizations;
          if (!organization?.id) return null;
          return {
            id: organization.id as string,
            name: organization.name as string,
            role: row.role as OrganizationRole,
          };
        })
        .filter(Boolean) as OrganizationAccess[];
    }

    const directMemberships = new Map<
      string,
      { workspace: WorkspaceSummary; role: WorkspaceRole }
    >();
    if (workspaceError) {
      console.error("workspace access load failed", workspaceError);
    } else {
      for (const row of (workspaceRows ?? []) as WorkspaceMemberWithWorkspace[]) {
        const workspace = Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces;
        if (!workspace?.id) continue;
        directMemberships.set(workspace.id, {
          workspace,
          role: row.role as WorkspaceRole,
        });
      }
    }

    for (const { workspace } of directMemberships.values()) {
      if (mappedOrganizations.some((organization) => organization.id === workspace.organization_id)) {
        continue;
      }
      const relation = Array.isArray(workspace.organizations)
        ? workspace.organizations[0]
        : workspace.organizations;
      if (!relation?.name) continue;
      mappedOrganizations.push({
        id: workspace.organization_id,
        name: relation.name,
        role: null,
      });
    }
    mappedOrganizations.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
    setOrganizations(mappedOrganizations);

    const organizationRoleById = new Map(
      mappedOrganizations.map((organization) => [organization.id, organization.role]),
    );
    let inheritedWorkspaceRows: Array<{
      id: string;
      name: string;
      organization_id: string;
    }> = [];

    const administeredOrganizations = mappedOrganizations.filter(
      (organization): organization is OrganizationAccess & { role: OrganizationRole } =>
        organization.role !== null,
    );
    if (administeredOrganizations.length > 0) {
      const { data, error: inheritedError } = await supabase
        .from("workspaces")
        .select("id, name, organization_id")
        .in(
          "organization_id",
          administeredOrganizations.map((organization) => organization.id),
        );

      if (inheritedError) {
        console.error("inherited workspace access load failed", inheritedError);
        setError("Não foi possível carregar todos os clientes disponíveis.");
      } else {
        inheritedWorkspaceRows = (data ?? []) as typeof inheritedWorkspaceRows;
      }
    }

    const accessibleWorkspaces = new Map<string, WorkspaceAccess>();
    for (const { workspace, role } of directMemberships.values()) {
      const resolved = resolveWorkspaceAccess(
        role,
        organizationRoleById.get(workspace.organization_id) ?? null,
      );
      if (!resolved) continue;
      accessibleWorkspaces.set(workspace.id, {
        id: workspace.id,
        name: workspace.name,
        organization_id: workspace.organization_id,
        ...resolved,
      });
    }

    for (const workspace of inheritedWorkspaceRows) {
      const directRole = directMemberships.get(workspace.id)?.role ?? null;
      const resolved = resolveWorkspaceAccess(
        directRole,
        organizationRoleById.get(workspace.organization_id) ?? null,
      );
      if (!resolved) continue;
      accessibleWorkspaces.set(workspace.id, {
        ...workspace,
        ...resolved,
      });
    }

    const mappedWorkspaces = Array.from(accessibleWorkspaces.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "pt-BR"),
    );
    setWorkspaces(mappedWorkspaces);

    if (workspaceError || orgError) {
      setError("Não foi possível carregar todos os seus acessos.");
    }
    setLoading(false);
  }, [setCurrentWorkspaceId, userId]);

  useEffect(() => {
    if (authLoading) return;
    void refreshAccess();
  }, [authLoading, refreshAccess]);

  useEffect(() => {
    if (!workspaces.length) {
      if (!loading) setCurrentWorkspaceId(null);
      return;
    }

    const stored = localStorage.getItem(STORAGE_KEY);
    const target =
      workspaces.find((workspace) => workspace.id === currentWorkspaceId) ??
      workspaces.find((workspace) => workspace.id === stored) ??
      workspaces[0];

    if (target && target.id !== currentWorkspaceId) {
      setCurrentWorkspaceId(target.id);
    }
  }, [currentWorkspaceId, loading, setCurrentWorkspaceId, workspaces]);

  const currentWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? null,
    [currentWorkspaceId, workspaces],
  );

  const currentOrganization = useMemo(() => {
    if (!currentWorkspace) return organizations[0] ?? null;
    return (
      organizations.find((organization) => organization.id === currentWorkspace.organization_id) ??
      null
    );
  }, [currentWorkspace, organizations]);

  const value = useMemo<WorkspaceContextValue>(() => {
    const currentWorkspaceRole = currentWorkspace?.role ?? null;
    const currentOrganizationRole = currentOrganization?.role ?? null;

    return {
      loading: authLoading || loading,
      error,
      workspaces,
      organizations,
      currentWorkspace,
      currentWorkspaceId,
      currentOrganization,
      currentWorkspaceRole,
      currentOrganizationRole,
      hasWorkspaces: workspaces.length > 0,
      needsOnboarding:
        !authLoading &&
        !loading &&
        !!userId &&
        organizations.length === 0 &&
        workspaces.length === 0,
      isWorkspaceAdmin: currentWorkspaceRole === "owner" || currentWorkspaceRole === "admin",
      isOrganizationAdmin:
        currentOrganizationRole === "owner" || currentOrganizationRole === "admin",
      setCurrentWorkspaceId,
      refreshAccess,
    };
  }, [
    authLoading,
    currentOrganization,
    currentWorkspace,
    currentWorkspaceId,
    error,
    loading,
    organizations,
    refreshAccess,
    setCurrentWorkspaceId,
    userId,
    workspaces,
  ]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }
  return context;
}
