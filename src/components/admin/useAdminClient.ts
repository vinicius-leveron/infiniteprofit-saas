import { useEffect, useMemo } from "react";
import { useParams } from "react-router-dom";
import { useWorkspace } from "@/hooks/useWorkspace";

export function useAdminClient() {
  const { clientId } = useParams<{ clientId: string }>();
  const {
    currentWorkspace,
    workspaces,
    organizations,
    currentOrganization,
    setCurrentWorkspaceId,
  } = useWorkspace();

  const client = useMemo(
    () =>
      clientId
        ? workspaces.find((workspace) => workspace.id === clientId) ?? null
        : currentWorkspace,
    [clientId, currentWorkspace, workspaces],
  );

  const organization = useMemo(
    () =>
      organizations.find((entry) => entry.id === client?.organization_id) ??
      currentOrganization,
    [client?.organization_id, currentOrganization, organizations],
  );

  useEffect(() => {
    if (clientId && client?.id === clientId && currentWorkspace?.id !== clientId) {
      setCurrentWorkspaceId(clientId);
    }
  }, [client?.id, clientId, currentWorkspace?.id, setCurrentWorkspaceId]);

  const canManage = Boolean(
    client &&
      (client.role === "owner" ||
        client.role === "admin" ||
        organization?.role === "owner" ||
        organization?.role === "admin"),
  );

  const canInviteOwner = Boolean(
    client && (client.role === "owner" || organization?.role === "owner"),
  );

  return {
    client,
    clientId: clientId ?? client?.id ?? null,
    organization,
    canManage,
    canInviteOwner,
  };
}
