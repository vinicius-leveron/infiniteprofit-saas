import { Menu, Search } from "lucide-react";
import { AccountMenu } from "@/components/AccountMenu";
import { ContextSwitcher } from "@/components/ContextSwitcher";
import { FunnelActionsMenu } from "@/components/FunnelActionsMenu";
import { FunnelSwitcher } from "@/components/FunnelSwitcher";
import type { NavigationScope } from "@/components/app-navigation";
import { Button } from "@/components/ui/button";

interface AppTopbarProps {
  scope: NavigationScope;
  clientId: string | null;
  clientName: string | null;
  funnelId: string | null;
  canManageOrganization: boolean;
  canManageClient: boolean;
  onOpenMobileNavigation: () => void;
  onOpenCommand: () => void;
  onHome: () => void;
}

export function AppTopbar({
  scope,
  clientId,
  clientName,
  funnelId,
  canManageOrganization,
  canManageClient,
  onOpenMobileNavigation,
  onOpenCommand,
  onHome,
}: AppTopbarProps) {
  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border/70 bg-background/95 backdrop-blur">
      <div className="flex h-full items-center gap-2 px-2 md:hidden">
        {scope === "dashboard" ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onOpenMobileNavigation}
            className="h-11 w-11 shrink-0"
            aria-label="Abrir navegação do Dashboard"
          >
            <Menu className="h-5 w-5" />
          </Button>
        ) : (
          <button
            type="button"
            onClick={onHome}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Ir para o início"
          >
            <img src="/favicon.svg" alt="" className="h-8 w-8" />
          </button>
        )}

        <ContextSwitcher compact className="h-10 flex-1 border-0 bg-transparent px-1.5" />
        <FunnelSwitcher
          compact
          clientId={clientId}
          funnelId={funnelId}
          canManageClient={canManageClient}
        />
        <FunnelActionsMenu
          clientId={clientId}
          funnelId={funnelId}
          canManageOrganization={canManageOrganization}
          canManageClient={canManageClient}
        />
        <AccountMenu
          variant="mobile"
          clientId={clientId}
          clientName={clientName}
          funnelId={funnelId}
          canManageOrganization={canManageOrganization}
          canManageClient={canManageClient}
          onOpenCommand={onOpenCommand}
        />
      </div>

      <div className="hidden h-full items-center gap-2 px-4 md:flex lg:px-6">
        <ContextSwitcher compact className="w-[280px]" />
        <FunnelSwitcher
          clientId={clientId}
          funnelId={funnelId}
          canManageClient={canManageClient}
        />
        <FunnelActionsMenu
          clientId={clientId}
          funnelId={funnelId}
          canManageOrganization={canManageOrganization}
          canManageClient={canManageClient}
        />
        <div className="flex-1" />
        <button
          type="button"
          onClick={onOpenCommand}
          className="flex h-10 min-w-[180px] items-center gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/55 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Search className="h-4 w-4" />
          <span>Buscar…</span>
          <kbd className="ml-auto text-[10px]">⌘K</kbd>
        </button>
      </div>
    </header>
  );
}
