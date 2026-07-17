import type {
  AppNavigationGroup,
  AppNavigationItem,
} from "@/components/app-navigation";
import { isAppNavigationItemActive } from "@/components/app-navigation";
import { cn } from "@/lib/utils";

interface MobileContextNavProps {
  group: AppNavigationGroup;
  pathname: string;
  search: string;
  onNavigate: (item: AppNavigationItem) => void;
}

export function MobileContextNav({
  group,
  pathname,
  search,
  onNavigate,
}: MobileContextNavProps) {
  return (
    <nav
      aria-label={`Navegação de ${group.label}`}
      className="sticky top-14 z-30 overflow-x-auto border-b border-border/60 bg-background/95 backdrop-blur md:hidden"
    >
      <div className="flex min-w-max px-3">
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
                "relative flex min-h-12 items-center gap-2 px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                active
                  ? "text-primary after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
