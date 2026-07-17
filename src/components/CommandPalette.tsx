import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Calendar, FileSpreadsheet, LogOut, Plus } from "lucide-react";
import {
  createAppNavigation,
  type AppNavigationItem,
  type DashboardTab,
} from "@/components/app-navigation";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useWorkspace } from "@/hooks/useWorkspace";
import { supabase } from "@/integrations/supabase/client";
import type { Period } from "./PeriodFilter";

interface ProjectMini {
  id: string;
  name: string;
  file_name: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectTab?: (tab: DashboardTab) => void;
  onSelectPeriod?: (period: Period) => void;
}

export function CommandPalette({
  open,
  onOpenChange,
  onSelectTab,
  onSelectPeriod,
}: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    currentWorkspaceId,
    isWorkspaceAdmin,
    isOrganizationAdmin,
  } = useWorkspace();
  const [projects, setProjects] = useState<ProjectMini[]>([]);
  const funnelRouteMatch = location.pathname.match(/^\/funnels\/([^/]+)/);
  const clientRouteMatch = location.pathname.match(/^\/clients\/([^/]+)/);
  const funnelId = funnelRouteMatch
    ? decodeURIComponent(funnelRouteMatch[1])
    : new URLSearchParams(location.search).get("project");
  const navigationClientId = clientRouteMatch
    ? decodeURIComponent(clientRouteMatch[1])
    : currentWorkspaceId;
  const navigationGroups = useMemo(
    () =>
      createAppNavigation({
        clientId: navigationClientId,
        funnelId,
        canManageOrganization: isOrganizationAdmin,
        canManageClient: isWorkspaceAdmin,
      }),
    [funnelId, isOrganizationAdmin, isWorkspaceAdmin, navigationClientId],
  );

  useEffect(() => {
    if (!open || !currentWorkspaceId) {
      setProjects([]);
      return;
    }

    void supabase
      .from("projects")
      .select("id, name, file_name")
      .eq("workspace_id", currentWorkspaceId)
      .order("updated_at", { ascending: false })
      .limit(20)
      .then(({ data }) => setProjects(data ?? []));
  }, [currentWorkspaceId, open]);

  const close = () => onOpenChange(false);
  const run = (action: () => void | Promise<void>) => () => {
    void action();
    close();
  };

  const selectNavigationItem = (item: AppNavigationItem) => {
    if (item.dashboardTab && onSelectTab) {
      onSelectTab(item.dashboardTab);
      return;
    }
    navigate(item.href);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Buscar funil, página ou ação..." />
      <CommandList>
        <CommandEmpty>Nada encontrado</CommandEmpty>

        {navigationGroups.map((group, index) => (
          <div key={group.id}>
            {index > 0 && <CommandSeparator />}
            <CommandGroup heading={group.label}>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={item.id}
                    value={`${group.label} ${item.label}`}
                    onSelect={run(() => selectNavigationItem(item))}
                  >
                    <Icon className="mr-2 h-4 w-4" />
                    {item.label}
                    {item.shortcut && (
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {item.shortcut}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </div>
        ))}

        {onSelectPeriod && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Período">
              {[
                ["today", "Hoje"],
                ["yesterday", "Ontem"],
                ["7d", "Últimos 7 dias"],
                ["15d", "Últimos 15 dias"],
                ["30d", "Últimos 30 dias"],
                ["all", "Tudo"],
              ].map(([period, label]) => (
                <CommandItem
                  key={period}
                  onSelect={run(() => onSelectPeriod(period as Period))}
                >
                  <Calendar className="mr-2 h-4 w-4" />
                  {label}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading="Funis">
          {isWorkspaceAdmin && currentWorkspaceId && (
            <CommandItem
              onSelect={run(() =>
                navigate(`/clients/${currentWorkspaceId}/funnels/new`),
              )}
            >
              <Plus className="mr-2 h-4 w-4" />
              Novo funil
            </CommandItem>
          )}
          {projects.map((project) => (
            <CommandItem
              key={project.id}
              value={`funil ${project.name} ${project.file_name ?? ""}`}
              onSelect={run(() => navigate(`/dashboard?project=${project.id}`))}
            >
              <FileSpreadsheet className="mr-2 h-4 w-4" />
              <span className="truncate">{project.name}</span>
              {project.file_name && (
                <span className="ml-auto max-w-[160px] truncate text-[10px] text-muted-foreground">
                  {project.file_name}
                </span>
              )}
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />
        <CommandGroup heading="Conta">
          <CommandItem
            onSelect={run(async () => {
              await supabase.auth.signOut();
              navigate("/auth", { replace: true });
            })}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sair
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
