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

export interface OrganizationAccess {
  id: string;
  name: string;
  role: OrganizationRole;
}

export interface WorkspaceAccess {
  id: string;
  name: string;
  organization_id: string;
  role: WorkspaceRole;
}

interface WorkspaceMemberWithWorkspace {
  role: WorkspaceRole;
  workspaces:
    | {
        id: string;
        name: string;
        organization_id: string;
      }
    | Array<{
        id: string;
        name: string;
        organization_id: string;
      }>
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

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const userId = user?.id ?? null;
  const [loading, setLoading] = useState(true);
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
      setLoading(false);
      return;
    }

    setLoading(true);

    const [{ data: workspaceRows, error: workspaceError }, { data: orgRows, error: orgError }] =
      await Promise.all([
        supabase
          .from("workspace_members")
          .select("role, workspaces(id, name, organization_id)")
          .eq("user_id", userId),
        supabase
          .from("organization_members")
          .select("role, organizations(id, name)")
          .eq("user_id", userId),
      ]);

    if (workspaceError) {
      console.error("workspace access load failed", workspaceError);
      setWorkspaces([]);
    } else {
      const mapped = ((workspaceRows ?? []) as WorkspaceMemberWithWorkspace[])
        .map((row) => {
          const workspace = Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces;
          if (!workspace?.id) return null;
          return {
            id: workspace.id as string,
            name: workspace.name as string,
            organization_id: workspace.organization_id as string,
            role: row.role as WorkspaceRole,
          };
        })
        .filter(Boolean) as WorkspaceAccess[];
      mapped.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      setWorkspaces(mapped);
    }

    if (orgError) {
      console.error("organization access load failed", orgError);
      setOrganizations([]);
    } else {
      const mapped = ((orgRows ?? []) as OrganizationMemberWithOrganization[])
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
      mapped.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      setOrganizations(mapped);
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
      workspaces,
      organizations,
      currentWorkspace,
      currentWorkspaceId,
      currentOrganization,
      currentWorkspaceRole,
      currentOrganizationRole,
      hasWorkspaces: workspaces.length > 0,
      needsOnboarding: !authLoading && !loading && !!userId && workspaces.length === 0,
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
