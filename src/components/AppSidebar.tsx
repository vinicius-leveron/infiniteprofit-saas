import type {
  AppNavigationGroup,
  AppNavigationItem,
} from "@/components/app-navigation";
import { isAppNavigationItemActive } from "@/components/app-navigation";
import { AccountMenu } from "@/components/AccountMenu";
import { cn } from "@/lib/utils";

interface AppSidebarProps {
  group: AppNavigationGroup | null;
  pathname: string;
  search: string;
  clientId: string | null;
  clientName: string | null;
  funnelId: string | null;
  canManageOrganization: boolean;
  canManageClient: boolean;
  onNavigate: (item: AppNavigationItem) => void;
  onHome: () => void;
  onOpenCommand: () => void;
  onAfterAccountNavigate?: () => void;
  showBrand?: boolean;
  showAccount?: boolean;
  className?: string;
}

export function AppSidebar({
  group,
  pathname,
  search,
  clientId,
  clientName,
  funnelId,
  canManageOrganization,
  canManageClient,
  onNavigate,
  onHome,
  onOpenCommand,
  onAfterAccountNavigate,
  showBrand = true,
  showAccount = true,
  className,
}: AppSidebarProps) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-sidebar", className)}>
      {showBrand && (
        <div className="border-b border-border/50 px-4 py-3">
          <button
            type="button"
            onClick={onHome}
            className="flex min-h-11 w-full items-center gap-3 rounded-lg px-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Ir para o início"
          >
            <img src="/favicon.svg" alt="" className="h-8 w-8 shrink-0" />
            <span className="truncate text-base font-extrabold tracking-tight gradient-text-brand">
              Infinite Profit
            </span>
          </button>
        </div>
      )}

      <nav
        aria-label={group ? `Navegação de ${group.label}` : "Navegação contextual"}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4"
      >
        {group && (
          <section aria-labelledby={`navigation-${group.id}`}>
            <h2
              id={`navigation-${group.id}`}
              className="mb-2 px-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"
            >
              {group.label}
            </h2>
            <div className="space-y-1">
              {group.items.map((item) => {
                const active = isAppNavigationItemActive(item, pathname, search);
                const Icon = item.icon;
                const isBackAction = item.id === "funnel-dashboard";

                return (
                  <div
                    key={item.id}
                    className={cn(isBackAction && "mt-4 border-t border-border/50 pt-4")}
                  >
                    <button
                      type="button"
                      onClick={() => onNavigate(item)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "bg-primary/10 text-primary shadow-[inset_2px_0_0_hsl(var(--primary))]"
                          : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                      )}
                    >
                      <Icon
                        className={cn(
                          "h-4 w-4 shrink-0",
                          active
                            ? "text-primary"
                            : "text-muted-foreground/80 group-hover:text-foreground",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate text-left">
                        {item.label}
                      </span>
                      {item.shortcut && (
                        <kbd className="min-w-5 rounded border border-border/60 px-1 py-0.5 text-center font-mono text-[10px] font-normal text-muted-foreground/75">
                          {item.shortcut}
                        </kbd>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </nav>

      {showAccount && (
        <div className="border-t border-border/50 p-3">
          <AccountMenu
            variant="sidebar"
            clientId={clientId}
            clientName={clientName}
            funnelId={funnelId}
            canManageOrganization={canManageOrganization}
            canManageClient={canManageClient}
            onOpenCommand={onOpenCommand}
            onNavigate={onAfterAccountNavigate}
          />
        </div>
      )}
    </div>
  );
}
