import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface ContextSwitcherProps {
  compact?: boolean;
  onSelect?: () => void;
}

export function ContextSwitcher({ compact = false, onSelect }: ContextSwitcherProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    organizations,
    workspaces,
    currentOrganization,
    currentWorkspace,
    currentWorkspaceId,
    setCurrentWorkspaceId,
  } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string | null>(
    currentOrganization?.id ?? organizations[0]?.id ?? null,
  );

  useEffect(() => {
    if (currentOrganization?.id) setSelectedOrganizationId(currentOrganization.id);
  }, [currentOrganization?.id]);

  const selectedOrganization =
    organizations.find((organization) => organization.id === selectedOrganizationId) ??
    currentOrganization ??
    organizations[0] ??
    null;

  const visibleClients = useMemo(
    () =>
      selectedOrganization
        ? workspaces.filter(
            (workspace) => workspace.organization_id === selectedOrganization.id,
          )
        : workspaces,
    [selectedOrganization, workspaces],
  );

  const selectClient = (clientId: string) => {
    const changedClient = clientId !== currentWorkspaceId;
    setCurrentWorkspaceId(clientId);
    setOpen(false);
    onSelect?.();

    if (
      changedClient &&
      (location.pathname === "/dashboard" ||
        location.pathname.startsWith("/funnels/") ||
        location.pathname === "/connections" ||
        location.pathname === "/diagnostics")
    ) {
      navigate(`/clients/${clientId}/funnels`);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex w-full min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-muted/30 text-left transition-colors hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            compact ? "h-10 px-2.5" : "h-12 px-3",
          )}
          aria-label="Trocar organização ou cliente"
        >
          <span
            className={cn(
              "flex shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary",
              compact ? "h-7 w-7" : "h-8 w-8",
            )}
          >
            <Building2 className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11px] leading-4 text-muted-foreground">
              {currentOrganization?.name ?? "Organização"}
            </span>
            <span className="block truncate text-sm font-semibold leading-4 text-foreground">
              {currentWorkspace?.name ?? "Selecionar cliente"}
            </span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={8}
        collisionPadding={16}
        className="w-[calc(100vw-32px)] overflow-hidden rounded-xl border-border/80 bg-popover p-0 shadow-2xl sm:w-[520px]"
      >
        <div className="grid max-h-[min(520px,70vh)] sm:grid-cols-[220px_minmax(0,1fr)]">
          <section className="border-b border-border/60 sm:border-b-0 sm:border-r">
            <div className="border-b border-border/60 px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Organização
            </div>
            <div className="max-h-48 overflow-y-auto p-2 sm:max-h-[440px]">
              {organizations.map((organization) => {
                const selected = organization.id === selectedOrganization?.id;
                return (
                  <button
                    key={organization.id}
                    type="button"
                    onClick={() => setSelectedOrganizationId(organization.id)}
                    aria-pressed={selected}
                    className={cn(
                      "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors",
                      selected
                        ? "bg-primary/10 font-medium text-foreground"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{organization.name}</span>
                    {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          </section>

          <section>
            <div className="border-b border-border/60 px-4 py-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Cliente
            </div>
            <div className="max-h-64 overflow-y-auto p-2 sm:max-h-[440px]">
              {visibleClients.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  Nenhum cliente nesta organização.
                </p>
              ) : (
                visibleClients.map((client) => {
                  const active = client.id === currentWorkspaceId;
                  return (
                    <button
                      key={client.id}
                      type="button"
                      onClick={() => selectClient(client.id)}
                      aria-current={active ? "true" : undefined}
                      className={cn(
                        "flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm transition-colors",
                        active
                          ? "bg-primary/10 font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{client.name}</span>
                      {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </button>
                  );
                })
              )}
            </div>
          </section>
        </div>
      </PopoverContent>
    </Popover>
  );
}
