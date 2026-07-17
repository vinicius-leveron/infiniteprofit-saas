import { LogOut } from "lucide-react";
import type { AppNavigationGroup, AppNavigationItem } from "@/components/app-navigation";
import { isAppNavigationItemActive } from "@/components/app-navigation";
import { ContextSwitcher } from "@/components/ContextSwitcher";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AppSidebarProps {
  groups: AppNavigationGroup[];
  pathname: string;
  search: string;
  onNavigate: (item: AppNavigationItem) => void;
  onSignOut: () => void;
  onContextSelect?: () => void;
  className?: string;
}

export function AppSidebar({
  groups,
  pathname,
  search,
  onNavigate,
  onSignOut,
  onContextSelect,
  className,
}: AppSidebarProps) {
  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-sidebar", className)}>
      <div className="border-b border-border/50 p-3">
        <ContextSwitcher onSelect={onContextSelect} />
      </div>

      <nav aria-label="Navegação principal" className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={group.id} aria-labelledby={`navigation-${group.id}`}>
              <h2
                id={`navigation-${group.id}`}
                className="mb-1.5 px-2.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70"
              >
                {group.label}
              </h2>
              <div className="space-y-1">
                {group.items.map((item) => {
                  const active = isAppNavigationItemActive(item, pathname, search);
                  const Icon = item.icon;

                  return (
                    <button
                      key={item.id}
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
                      <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                      {item.shortcut && (
                        <kbd className="min-w-5 rounded border border-border/60 px-1 py-0.5 text-center font-mono text-[10px] font-normal text-muted-foreground/75">
                          {item.shortcut}
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </nav>

      <div className="border-t border-border/50 p-3">
        <Button
          variant="ghost"
          onClick={onSignOut}
          className="min-h-11 w-full justify-start gap-2.5 rounded-lg px-2.5 text-[13px] text-muted-foreground hover:bg-muted/70 hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </Button>
      </div>
    </div>
  );
}
